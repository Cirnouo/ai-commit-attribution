import { readFile } from 'node:fs/promises';
import { isMainModule } from './cli-entry.ts';
import { isRecord } from './errors.ts';
import { createGitHubIssueRequest, IssueAutomationError, type IssueRequest } from './issue-github.ts';
import { createIssuePolicy, ISSUE_INVALID_LABEL, type IssueBodyResult, type IssueFormSources } from './issue-policy.ts';

const FEEDBACK_MARKER = '<!-- ai-commit-attribution:issue-form-feedback:v1 -->';
// Public GitHub identity: https://api.github.com/users/github-actions%5Bbot%5D
const ACTIONS_BOT_ID = 41898282;
const ACTIONS_BOT_LOGIN = 'github-actions[bot]';
const ACTIONS = ['opened', 'edited', 'reopened', 'labeled', 'unlabeled'];

export interface IssueFeedbackContext {
    repository: string;
    number: number;
    id: number;
    nodeId: string;
    ignore: boolean;
}

export interface IssueFeedbackResult {
    status: 'valid' | 'invalid' | 'skipped' | 'stale' | 'closed' | 'ignored';
    feedback: 'unchanged' | 'published';
}

interface IssueSnapshot {
    title: string;
    body: string | null;
    state: 'open' | 'closed';
    updatedAt: string;
    labels: string[];
}

interface OwnedComment {
    id: number;
    body: string;
}

function fail(message: string): never {
    throw new IssueAutomationError(message);
}

function positiveId(value: unknown): value is number {
    return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

export function issueFeedbackContext(environment: NodeJS.ProcessEnv, event: unknown): IssueFeedbackContext {
    const repository = environment.GITHUB_REPOSITORY ?? '';
    const names = repository.split('/');
    if (
        environment.GITHUB_EVENT_NAME !== 'issues' ||
        names.length !== 2 ||
        names.some((name) => !/^[A-Za-z0-9_.-]+$/u.test(name) || name === '.' || name === '..') ||
        environment.GITHUB_REF_TYPE !== 'branch' ||
        !/^[a-f0-9]{40}$/u.test(environment.GITHUB_SHA ?? '') ||
        environment.GITHUB_SHA === '0'.repeat(40) ||
        !isRecord(event) ||
        typeof event.action !== 'string' ||
        !ACTIONS.includes(event.action) ||
        !isRecord(event.repository) ||
        !positiveId(event.repository.id) ||
        event.repository.full_name !== repository ||
        event.repository.name !== names[1] ||
        !isRecord(event.repository.owner) ||
        event.repository.owner.login !== names[0] ||
        typeof event.repository.default_branch !== 'string' ||
        !event.repository.default_branch ||
        environment.GITHUB_REF !== `refs/heads/${event.repository.default_branch}` ||
        !isRecord(event.issue) ||
        Object.hasOwn(event.issue, 'pull_request') ||
        !positiveId(event.issue.number) ||
        !positiveId(event.issue.id) ||
        typeof event.issue.node_id !== 'string' ||
        !event.issue.node_id
    ) {
        fail('Issue feedback requires a matching Issue event and trusted default-branch identity.');
    }
    let ignore = false;
    if (event.action === 'labeled' || event.action === 'unlabeled') {
        if (!isRecord(event.label) || typeof event.label.name !== 'string' || !event.label.name)
            fail('Issue label event has malformed label identity.');
        ignore = event.label.name === ISSUE_INVALID_LABEL;
    }
    return { repository, number: event.issue.number, id: event.issue.id, nodeId: event.issue.node_id, ignore };
}

function repositoryPath(context: IssueFeedbackContext): string {
    return `/repos/${context.repository.split('/').map(encodeURIComponent).join('/')}`;
}

function labelNames(value: unknown): string[] {
    if (!Array.isArray(value)) fail('GitHub Issue labels are malformed.');
    const labels = value.map((label: unknown) => {
        if (!isRecord(label) || typeof label.name !== 'string' || !label.name) fail('GitHub Issue label is malformed.');
        return label.name;
    });
    if (new Set(labels).size !== labels.length) fail('GitHub Issue labels contain duplicate identities.');
    return labels.sort();
}

function snapshot(value: unknown, context: IssueFeedbackContext): IssueSnapshot {
    const base = repositoryPath(context);
    if (
        !isRecord(value) ||
        Object.hasOwn(value, 'pull_request') ||
        value.id !== context.id ||
        value.node_id !== context.nodeId ||
        value.number !== context.number ||
        value.url !== `https://api.github.com${base}/issues/${context.number}` ||
        value.repository_url !== `https://api.github.com${base}` ||
        typeof value.title !== 'string' ||
        (value.body !== null && typeof value.body !== 'string') ||
        (value.state !== 'open' && value.state !== 'closed') ||
        typeof value.updated_at !== 'string' ||
        !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/u.test(value.updated_at) ||
        !Number.isFinite(Date.parse(value.updated_at))
    ) {
        fail('GitHub returned a malformed or mismatched Issue identity.');
    }
    return {
        title: value.title,
        body: value.body,
        state: value.state,
        updatedAt: value.updated_at,
        labels: labelNames(value.labels),
    };
}

function sameSnapshot(expected: IssueSnapshot, current: IssueSnapshot, knownLabelMutation = false): boolean {
    return (
        expected.title === current.title &&
        expected.body === current.body &&
        expected.state === current.state &&
        (knownLabelMutation || expected.updatedAt === current.updatedAt) &&
        JSON.stringify(expected.labels) === JSON.stringify(current.labels)
    );
}

function ownedComment(value: unknown, context: IssueFeedbackContext): OwnedComment | null {
    if (
        !isRecord(value) ||
        !positiveId(value.id) ||
        (typeof value.body !== 'string' && value.body !== null) ||
        value.issue_url !== `https://api.github.com${repositoryPath(context)}/issues/${context.number}` ||
        (value.user !== null && !isRecord(value.user))
    ) {
        fail('GitHub returned a malformed or mismatched Issue comment.');
    }
    if (
        isRecord(value.user) &&
        (!positiveId(value.user.id) ||
            typeof value.user.login !== 'string' ||
            !value.user.login ||
            (value.user.type !== 'User' && value.user.type !== 'Bot' && value.user.type !== 'Organization'))
    ) {
        fail('GitHub returned a malformed Issue comment author.');
    }
    if (
        isRecord(value.user) &&
        value.user.id === ACTIONS_BOT_ID &&
        value.user.login === ACTIONS_BOT_LOGIN &&
        value.user.type === 'Bot' &&
        typeof value.body === 'string' &&
        value.body.startsWith(`${FEEDBACK_MARKER}\n`)
    ) {
        return { id: value.id, body: value.body };
    }
    return null;
}

async function findOwnedComment(request: IssueRequest, context: IssueFeedbackContext): Promise<OwnedComment | null> {
    let selected: OwnedComment | null = null;
    const seen = new Set<number>();
    for (let page = 1; ; page += 1) {
        const values = await request(
            'GET',
            `${repositoryPath(context)}/issues/${context.number}/comments?per_page=100&page=${page}`,
        );
        if (!Array.isArray(values) || values.length > 100) fail('GitHub returned a malformed Issue comment page.');
        for (const value of values) {
            const owned = ownedComment(value, context);
            if (!isRecord(value) || !positiveId(value.id) || seen.has(value.id))
                fail('GitHub Issue comment pagination repeated an identity.');
            seen.add(value.id);
            if (owned && (!selected || owned.id < selected.id)) selected = owned;
        }
        if (values.length < 100) return selected;
    }
}

function feedbackBody(result: IssueBodyResult, context: IssueFeedbackContext): string {
    const policy = `https://github.com/${context.repository}/blob/HEAD/docs/policies/commits-and-scope.md#typed-issue-submissions`;
    if (result.status === 'invalid') {
        return `${FEEDBACK_MARKER}\nThe typed Issue form needs repair:\n\n${result.diagnostics.map((diagnostic) => `- ${diagnostic}`).join('\n')}\n\nKeep the current form's H3 fields, answer required fields, and use the exact dropdown choice. Choose one corresponding form label. See the [typed Issue policy](${policy}). Editing the body or its classification label reruns validation.\n`;
    }
    return result.status === 'valid'
        ? `${FEEDBACK_MARKER}\nResolved: this Issue now satisfies the current typed form policy. The diagnostic label has been removed.\n`
        : `${FEEDBACK_MARKER}\nResolved: this is now an ordinary freeform Issue and is exempt from typed form validation. The diagnostic label has been removed.\n`;
}

/** CI publisher only. Pure body policy supplies diagnostics; external effects use REST. */
export async function runIssueFeedback(
    context: IssueFeedbackContext,
    forms: IssueFormSources,
    request: IssueRequest,
): Promise<IssueFeedbackResult> {
    if (context.ignore) return { status: 'ignored', feedback: 'unchanged' };
    const base = repositoryPath(context);
    const issue = `${base}/issues/${context.number}`;
    const readLatest = async () => snapshot(await request('GET', issue), context);
    let expected = await readLatest();
    if (expected.state === 'closed') return { status: 'closed', feedback: 'unchanged' };
    const policy = createIssuePolicy(forms);
    for (const name of [...policy.classificationLabels, ISSUE_INVALID_LABEL]) {
        const label = await request('GET', `${base}/labels/${encodeURIComponent(name)}`);
        if (!isRecord(label) || label.name !== name)
            fail('A provisioned current Issue form label is missing or malformed.');
    }
    const result = policy.validate(expected.body, expected.labels);
    const comment = await findOwnedComment(request, context);
    const invalid = result.status === 'invalid';
    const hasLabel = expected.labels.includes(ISSUE_INVALID_LABEL);
    const changeLabel = invalid !== hasLabel;
    const body = feedbackBody(result, context);
    const changeComment = invalid ? !comment || comment.body !== body : comment !== null && comment.body !== body;
    // Compare the fetched source, labels and update identity before any effect.
    if (!sameSnapshot(expected, await readLatest())) return { status: 'stale', feedback: 'unchanged' };
    if (!changeLabel && !changeComment) return { status: result.status, feedback: 'unchanged' };
    if (changeLabel) {
        const labels = invalid
            ? await request('POST', `${issue}/labels`, { labels: [ISSUE_INVALID_LABEL] })
            : await request('DELETE', `${issue}/labels/${encodeURIComponent(ISSUE_INVALID_LABEL)}`);
        if (labels !== null && labelNames(labels).includes(ISSUE_INVALID_LABEL) !== invalid)
            fail('GitHub did not confirm the Issue diagnostic label change.');
        expected = {
            ...expected,
            labels: invalid
                ? [...expected.labels, ISSUE_INVALID_LABEL].sort()
                : expected.labels.filter((label) => label !== ISSUE_INVALID_LABEL),
        };
        const current = await readLatest();
        // Only this confirmed mutation can advance updated_at; source and label
        // identities must still match. There is no server-side compare-and-set.
        if (!sameSnapshot(expected, current, true)) return { status: 'stale', feedback: 'published' };
        expected = current;
    }
    if (changeComment) {
        if (!sameSnapshot(expected, await readLatest()))
            return { status: 'stale', feedback: changeLabel ? 'published' : 'unchanged' };
        const value = comment
            ? await request('PATCH', `${base}/issues/comments/${comment.id}`, { body })
            : await request('POST', `${issue}/comments`, { body });
        const confirmed = ownedComment(value, context);
        if (!confirmed || confirmed.body !== body || (comment && confirmed.id !== comment.id))
            fail('GitHub did not confirm the owned Issue feedback comment.');
    }
    return { status: result.status, feedback: 'published' };
}

async function main() {
    if (process.argv.length !== 2 || !process.env.GITHUB_EVENT_PATH || !process.env.GH_TOKEN)
        fail('Issue feedback requires its GitHub Actions event and built-in token.');
    const event: unknown = JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH, 'utf8'));
    const context = issueFeedbackContext(process.env, event);
    const forms = {
        bugReport: await readFile(new URL('../.github/ISSUE_TEMPLATE/bug_report.yaml', import.meta.url), 'utf8'),
        featureRequest: await readFile(
            new URL('../.github/ISSUE_TEMPLATE/feature_request.yaml', import.meta.url),
            'utf8',
        ),
    };
    const result = await runIssueFeedback(context, forms, createGitHubIssueRequest(process.env.GH_TOKEN));
    console.log(`Issue form validation: ${result.status}; feedback: ${result.feedback}.`);
    // Invalid contributor content fails the workflow only after feedback completes.
    if (result.status === 'invalid') process.exitCode = 1;
}

if (isMainModule(import.meta)) {
    main().catch((error: unknown) => {
        console.error(
            `Issue feedback automation failed: ${error instanceof IssueAutomationError ? error.message : 'Configuration or unexpected processing failure.'}`,
        );
        process.exitCode = 1;
    });
}
