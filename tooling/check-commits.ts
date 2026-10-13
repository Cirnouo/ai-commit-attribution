import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { isRecord } from './errors.ts';
import { validateBranchName, validateCommitMessage } from './governance.ts';
import { validatePullRequestBody } from './pull-request-policy.ts';

type EventRequest = { eventName?: string | undefined; event?: unknown; currentBranch?: string | undefined };
interface CommitRecord {
    sha: string;
    message: string;
    parentCount: number;
}

const zeroSha = /^0{40}$/;

export function buildCommitCheckRequest({ eventName, event, currentBranch }: EventRequest) {
    if (eventName === 'pull_request') {
        if (
            !isRecord(event) ||
            !isRecord(event.pull_request) ||
            !isRecord(event.pull_request.head) ||
            !isRecord(event.pull_request.base)
        )
            throw new Error('Invalid pull request event.');
        const number = event.number;
        if (typeof number !== 'number' || !Number.isSafeInteger(number) || number <= 0) {
            throw new Error('Invalid pull request number: expected a positive safe integer at the event root.');
        }
        const pr = event.pull_request;
        const head = event.pull_request.head;
        const base = event.pull_request.base;
        if (
            typeof head.ref !== 'string' ||
            typeof head.sha !== 'string' ||
            typeof base.sha !== 'string' ||
            typeof pr.title !== 'string' ||
            (typeof pr.body !== 'string' && pr.body !== null)
        )
            throw new Error('Invalid pull request identity.');
        if (pr.title.trimEnd().endsWith(`(#${number})`)) {
            throw new Error(
                `Remove (#${number}) from the pull request title; GitHub appends this number when squashing.`,
            );
        }
        const squashTitle = `${pr.title} (#${number})`;
        return {
            branches: [head.ref],
            directMessages: [
                {
                    label: 'pull request title',
                    message: pr.title,
                },
                {
                    label: 'pull request squash message',
                    message: pr.body ? `${squashTitle}\n\n${pr.body}` : squashTitle,
                },
            ],
            range: `${event.pull_request.base.sha}..${event.pull_request.head.sha}`,
            includeAncestors: false,
        };
    }
    if (eventName === 'push') {
        if (
            !isRecord(event) ||
            typeof event.ref !== 'string' ||
            typeof event.before !== 'string' ||
            typeof event.after !== 'string'
        )
            throw new Error('Invalid push event.');
        const branch = event.ref.startsWith('refs/heads/') ? event.ref.slice('refs/heads/'.length) : null;
        const isFirstPush = zeroSha.test(event.before);
        const isDeletion = zeroSha.test(event.after);
        return {
            branches: branch ? [branch] : [],
            directMessages: [],
            range: isDeletion ? null : isFirstPush ? event.after : `${event.before}..${event.after}`,
            includeAncestors: isFirstPush && !isDeletion,
        };
    }
    if (!currentBranch) throw new Error('A current branch identity is required.');
    return {
        branches: [currentBranch],
        directMessages: [],
        range: 'HEAD',
        includeAncestors: true,
    };
}

export function validateCommitRecords(records: CommitRecord[]) {
    const errors = [];
    for (const record of records) {
        const recordErrors = validateCommitMessage(record.message, {
            isMerge: record.parentCount > 1,
        });
        errors.push(...recordErrors.map((error) => `${record.sha}: ${error}`));
    }
    return errors;
}

export function resolveAuditBranch({
    eventName,
    event,
    environment,
    localBranch,
}: {
    eventName?: string | undefined;
    event?: unknown;
    environment: NodeJS.ProcessEnv;
    localBranch?: string | undefined;
}) {
    if (eventName === 'pull_request' || eventName === 'push') {
        return undefined;
    }
    if (eventName !== 'workflow_dispatch' && eventName !== 'schedule') {
        return localBranch;
    }
    const refType = environment.GITHUB_REF_TYPE;
    if (refType !== undefined && refType !== 'branch') return undefined;
    const branches: string[] = [];
    let branchProof = refType === 'branch';
    const githubRef = environment.GITHUB_REF;
    if (githubRef !== undefined) {
        if (!githubRef.startsWith('refs/heads/')) return undefined;
        branches.push(githubRef.slice('refs/heads/'.length));
        branchProof = true;
    }
    if (environment.GITHUB_REF_NAME !== undefined) branches.push(environment.GITHUB_REF_NAME);
    const eventRef = isRecord(event) ? event.ref : undefined;
    if (eventRef !== undefined) {
        if (typeof eventRef !== 'string' || eventRef.length === 0) return undefined;
        if (eventRef.startsWith('refs/heads/')) {
            branches.push(eventRef.slice('refs/heads/'.length));
            branchProof = true;
        } else {
            if (eventRef.startsWith('refs/')) return undefined;
            branches.push(eventRef);
            if (eventName === 'workflow_dispatch') branchProof = true;
        }
    }
    return branchProof && branches.every((branch) => branch.length > 0) && new Set(branches).size === 1
        ? branches[0]
        : undefined;
}

function git(root: string, arguments_: string[]) {
    return execFileSync('git', arguments_, { cwd: root, encoding: 'utf8' }).trim();
}

function commitRecords(root: string, range: string | null): CommitRecord[] {
    if (!range) {
        return [];
    }
    const output = execFileSync('git', ['log', '--format=%H%x00%P%x00%B%x00%x1e', range], {
        cwd: root,
        encoding: 'utf8',
    });
    return output
        .split('\x1e')
        .map((record) => record.replace(/^\r?\n/, ''))
        .filter(Boolean)
        .map((record) => {
            const framedRecord = record.endsWith('\0') ? record.slice(0, -1) : record;
            const firstSeparator = framedRecord.indexOf('\0');
            const secondSeparator = framedRecord.indexOf('\0', firstSeparator + 1);
            if (firstSeparator < 0 || secondSeparator < 0) {
                throw new Error('Git returned a malformed commit record.');
            }
            const sha = framedRecord.slice(0, firstSeparator);
            const parents = framedRecord.slice(firstSeparator + 1, secondSeparator);
            const message = framedRecord.slice(secondSeparator + 1);
            return {
                sha,
                message,
                parentCount: parents ? parents.split(' ').filter(Boolean).length : 0,
            };
        });
}

function run() {
    const root = process.cwd();
    const eventName = process.env.GITHUB_EVENT_NAME;
    let event: unknown;
    if (process.env.GITHUB_EVENT_PATH) {
        event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
    }
    const localBranch = eventName ? undefined : git(root, ['branch', '--show-current']);
    const currentBranch = resolveAuditBranch({
        environment: process.env,
        event,
        eventName,
        localBranch,
    });
    if ((eventName === 'workflow_dispatch' || eventName === 'schedule') && !currentBranch) {
        console.error(
            `- ${eventName}: an explicit branch ref is required; detached checkout state is not a branch identity.`,
        );
        process.exitCode = 1;
        return;
    }
    const request = buildCommitCheckRequest({
        event,
        eventName,
        currentBranch,
    });
    if (
        eventName === 'push' &&
        isRecord(event) &&
        event.forced === true &&
        typeof event.before === 'string' &&
        !zeroSha.test(event.before) &&
        typeof event.after === 'string' &&
        !zeroSha.test(event.after)
    ) {
        const base = spawnSync('git', ['cat-file', '-e', `${event.before}^{commit}`], {
            cwd: root,
            encoding: 'utf8',
            windowsHide: true,
        });
        if (base.error) throw base.error;
        if (base.status !== 0) {
            // A fresh checkout cannot fetch an unreachable, replaced commit. Audit
            // every current ancestor instead of skipping messages or changing history.
            if (git(root, ['rev-parse', '--is-shallow-repository']) !== 'false')
                throw new Error('Complete history is required to audit a forced push with a missing base.');
            request.range = event.after;
            request.includeAncestors = true;
        }
    }
    if (request.includeAncestors && git(root, ['rev-parse', '--is-shallow-repository']) !== 'false') {
        throw new Error('Complete history is required to audit all commit ancestors.');
    }
    const errors = [];
    if (eventName === 'pull_request' && isRecord(event) && isRecord(event.pull_request)) {
        // The request builder has already checked event identity and preserved
        // the complete raw description for ordinary squash-message validation.
        const body = event.pull_request.body;
        if (typeof body !== 'string' && body !== null) throw new Error('Invalid pull request body.');
        const template = readFileSync(new URL('../.github/PULL_REQUEST_TEMPLATE.md', import.meta.url), 'utf8');
        errors.push(...validatePullRequestBody(body, template));
    }
    for (const branch of request.branches) {
        errors.push(...validateBranchName(branch).map((error) => `${branch}: ${error}`));
    }
    for (const direct of request.directMessages) {
        errors.push(...validateCommitMessage(direct.message).map((error) => `${direct.label}: ${error}`));
    }
    errors.push(...validateCommitRecords(commitRecords(root, request.range)));
    if (errors.length > 0) {
        console.error(errors.map((error) => `- ${error}`).join('\n'));
        process.exitCode = 1;
        return;
    }
    console.log('Commit and branch audit passed.');
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (fileURLToPath(import.meta.url) === invokedPath) {
    run();
}
