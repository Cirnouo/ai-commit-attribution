import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMainModule } from './cli-entry.ts';
import { errorMessage, isRecord } from './errors.ts';
import { parseOwnedYaml } from './owned-yaml.ts';
import { isReleaseVersion, isStableVersion, validateVersionAgreement } from './version-policy.ts';

export interface ReleaseInput {
    repository: string;
    tag: string;
    sha: string;
    tagObject: string;
}

export interface ReleaseIO {
    git(args: readonly string[]): string;
    readFile(file: string): Promise<string>;
    request(method: 'GET' | 'POST' | 'PATCH', endpoint: string, body?: Record<string, unknown>): Promise<unknown>;
}

export class GitHubApiError extends Error {
    readonly status: number;

    constructor(status: number, message: string) {
        super(message);
        this.name = 'GitHubApiError';
        this.status = status;
    }
}

function isObjectId(value: unknown): value is string {
    return typeof value === 'string' && value.length === 40 && /^[a-f0-9]{40}$/.test(value) && value !== '0'.repeat(40);
}

function validateInput(input: ReleaseInput) {
    const names = input.repository.split('/');
    if (
        names.length !== 2 ||
        names.some((name) => !/^[A-Za-z0-9_.-]+$/.test(name) || name === '.' || name === '..') ||
        !isObjectId(input.sha) ||
        !isObjectId(input.tagObject)
    ) {
        throw new Error('Invalid release repository, commit or annotated tag object identity.');
    }
    parseReleaseTag(input.tag);
}

export function parseReleaseTag(tag: string) {
    const version = tag.startsWith('v') ? tag.slice(1) : '';
    if (!isReleaseVersion(version))
        throw new Error(
            'Release tag must be exact v<SemVer>, optionally with prerelease identifiers, without build metadata.',
        );
    return version;
}

export function releaseContext(environment: NodeJS.ProcessEnv, event: unknown): ReleaseInput {
    if (
        environment.GITHUB_EVENT_NAME !== 'push' ||
        environment.GITHUB_REF_TYPE !== 'tag' ||
        !isRecord(event) ||
        event.created !== true ||
        event.deleted !== false ||
        event.forced !== false ||
        event.ref !== environment.GITHUB_REF ||
        event.ref !== `refs/tags/${environment.GITHUB_REF_NAME}`
    ) {
        throw new Error('Release requires a matching, newly created, non-forced tag push.');
    }
    const input = {
        repository: environment.GITHUB_REPOSITORY ?? '',
        tag: environment.GITHUB_REF_NAME ?? '',
        sha: environment.GITHUB_SHA ?? '',
        tagObject: typeof event.after === 'string' ? event.after : '',
    };
    validateInput(input);
    return input;
}

interface MarkdownLine {
    text: string;
    plain: boolean;
    heading?: { level: number; text: string };
}

function markdownLines(source: string): MarkdownLine[] {
    let fence: { character: string; length: number } | undefined;
    return source.split(/\r?\n/).map((text): MarkdownLine => {
        if (fence) {
            if (new RegExp(`^ {0,3}${fence.character}{${fence.length},}\\s*$`).test(text)) fence = undefined;
            return { text, plain: false };
        }
        const opening = text.match(/^ {0,3}(`{3,}|~{3,})/);
        if (opening?.[1]) {
            fence = { character: opening[1].charAt(0), length: opening[1].length };
            return { text, plain: false };
        }
        const heading = text.match(/^ {0,3}(#{1,6})(?:[ \t]+|$)(.*)$/);
        return {
            text,
            plain: true,
            ...(heading?.[1] && heading[2] !== undefined
                ? { heading: { level: heading[1].length, text: heading[2].replace(/\s+#+\s*$/, '').trim() } }
                : {}),
        };
    });
}

function sectionEnd(lines: MarkdownLine[], start: number) {
    const next = lines.findIndex((line, index) => index > start && line.heading?.level === 2);
    return next < 0 ? lines.length : next;
}

export function extractChangelog(source: string, version: string) {
    const lines = markdownLines(source);
    const matches = lines.flatMap((line, index) => {
        const match = line.heading?.level === 2 ? line.heading.text.match(/^\[([^\]]+)\](.*)$/) : null;
        return match?.[1] === version ? [{ index, suffix: match[2] ?? '' }] : [];
    });
    const entry = matches[0];
    if (matches.length !== 1 || !entry)
        throw new Error('Changelog requires exactly one entry for the release version.');
    const date = entry.suffix.match(/^ - (\d{4}-\d{2}-\d{2})$/)?.[1];
    const timestamp = date ? Date.parse(`${date}T00:00:00Z`) : Number.NaN;
    if (
        !date ||
        lines[entry.index]?.text !== `## [${version}] - ${date}` ||
        !Number.isFinite(timestamp) ||
        new Date(timestamp).toISOString().slice(0, 10) !== date
    ) {
        throw new Error('Changelog release entry requires a valid ISO calendar date.');
    }
    const contents = lines.slice(entry.index + 1, sectionEnd(lines, entry.index));
    if (!contents.some((line) => line.plain && /^\s*[-*+]\s+\S/.test(line.text))) {
        throw new Error('Changelog release entry must contain nonempty changes.');
    }
    return contents
        .map((line) => line.text)
        .join('\n')
        .trim();
}

function newContributors(source: string) {
    const lines = markdownLines(source);
    const start = lines.findIndex((line) => line.heading?.level === 2 && line.heading.text === 'New Contributors');
    if (start < 0) return '';
    const contents = lines.slice(start + 1, sectionEnd(lines, start));
    const fullChangelog = contents.findIndex((line) => line.plain && /^\*\*Full Changelog\*\*:/.test(line.text));
    const contributors = fullChangelog < 0 ? contents : contents.slice(0, fullChangelog);
    if (!contributors.some((line) => line.plain && /^\s*[-*+]\s+@\S+/.test(line.text))) return '';
    return contributors
        .map((line) => line.text)
        .join('\n')
        .trim();
}

export function buildReleaseBody(
    changes: string,
    tag: string,
    generated: string,
    repository: string,
    previousTag?: string,
) {
    const contributors = newContributors(generated);
    const current = encodeURIComponent(tag);
    const history = previousTag
        ? `https://github.com/${repository}/compare/${encodeURIComponent(previousTag)}...${current}`
        : `https://github.com/${repository}/commits/${current}`;
    const sections = [
        `## What's Changed\n\n${changes}`,
        ...(contributors ? [`## New Contributors\n\n${contributors}`] : []),
        `**Full Changelog**: ${history}`,
    ];
    return `${sections.join('\n\n')}\n`;
}

export function verifyTagIdentity(tag: string, expectedSha: string, expectedObject: string, git: ReleaseIO['git']) {
    parseReleaseTag(tag);
    if (git(['cat-file', '-t', `refs/tags/${tag}`]) !== 'tag') throw new Error('Release requires an annotated tag.');
    const commit = git(['rev-parse', '--verify', `refs/tags/${tag}^{commit}`]);
    if (commit !== expectedSha || git(['rev-parse', '--verify', 'HEAD']) !== expectedSha) {
        throw new Error('Release tag, event and checked-out commit must agree.');
    }
    try {
        git(['merge-base', '--is-ancestor', commit, 'refs/remotes/origin/main']);
    } catch {
        throw new Error('Release tag commit must already be merged into origin/main.');
    }
    const object = git(['rev-parse', '--verify', `refs/tags/${tag}`]);
    if (!isObjectId(object) || object !== expectedObject)
        throw new Error('Annotated tag object identity must match the original push.');
    return object;
}

interface ReleaseRecord {
    id: number;
    tag_name: string;
    draft: boolean;
    prerelease: boolean;
    html_url: string;
}

function releaseRecord(value: unknown): ReleaseRecord {
    if (
        !isRecord(value) ||
        typeof value.id !== 'number' ||
        !Number.isSafeInteger(value.id) ||
        value.id <= 0 ||
        typeof value.tag_name !== 'string' ||
        typeof value.draft !== 'boolean' ||
        typeof value.prerelease !== 'boolean' ||
        typeof value.html_url !== 'string' ||
        !value.html_url.startsWith('https://github.com/')
    ) {
        throw new Error('Malformed GitHub release response.');
    }
    return {
        id: value.id,
        tag_name: value.tag_name,
        draft: value.draft,
        prerelease: value.prerelease,
        html_url: value.html_url,
    };
}

async function optionalRelease(io: ReleaseIO, endpoint: string) {
    try {
        return releaseRecord(await io.request('GET', endpoint));
    } catch (error) {
        if (error instanceof GitHubApiError && error.status === 404) return undefined;
        throw error;
    }
}

async function findExistingRelease(io: ReleaseIO, base: string, tag: string) {
    const published = await optionalRelease(io, `${base}/releases/tags/${encodeURIComponent(tag)}`);
    if (published) return published;
    // The tag endpoint only finds published releases. Authenticated listings include drafts.
    let matching: ReleaseRecord | undefined;
    for (let page = 1; ; page++) {
        const values = await io.request('GET', `${base}/releases?per_page=100&page=${page}`);
        if (!Array.isArray(values) || values.length > 100) throw new Error('Malformed GitHub release-list response.');
        const matches = values.map(releaseRecord).filter((release) => release.tag_name === tag);
        if (matches.length > 1 || (matching && matches.length))
            throw new Error('Multiple GitHub releases have the requested tag.');
        if (matches[0]) matching = matches[0];
        if (values.length < 100) return matching;
    }
}

async function verifyRemoteTag(io: ReleaseIO, base: string, tag: string, object: string) {
    const ref = await io.request('GET', `${base}/git/ref/tags/${encodeURIComponent(tag)}`);
    if (!isRecord(ref) || !isRecord(ref.object) || ref.object.type !== 'tag' || ref.object.sha !== object) {
        throw new Error('Remote tag identity no longer matches the verified annotated tag.');
    }
}

export async function runRelease(input: ReleaseInput, io: ReleaseIO) {
    validateInput(input);
    const version = parseReleaseTag(input.tag);
    const prerelease = !isStableVersion(version);
    const object = verifyTagIdentity(input.tag, input.sha, input.tagObject, io.git);
    async function readMetadata(file: string): Promise<unknown> {
        const source = await io.readFile(file);
        const value: unknown = JSON.parse(source);
        parseOwnedYaml(source, { name: file, documents: 'single' });
        return value;
    }
    const packageData = await readMetadata('package.json');
    // The final generated payload is absent until the feature PRs. Absence is a hard failure.
    const skill = await io.readFile('skills/ai-commit-attribution/SKILL.md');
    const header = skill.match(/^---\n([\s\S]*?)\n---(?:\n|$)/)?.[1];
    if (!header) throw new Error('Malformed generated Skill frontmatter.');
    const [frontmatter] = parseOwnedYaml(header, { name: 'generated Skill frontmatter', documents: 'single' });
    if (!isRecord(packageData) || !isRecord(frontmatter) || !isRecord(frontmatter.metadata))
        throw new Error('Malformed release version metadata.');
    const errors = validateVersionAgreement(packageData.version, frontmatter.metadata.version);
    if (errors.length || packageData.version !== version)
        throw new Error('Release tag, root package and generated Skill metadata versions must agree.');
    const changes = extractChangelog(await io.readFile('CHANGELOG.md'), version);
    const base = `/repos/${input.repository}`;
    const existing = await findExistingRelease(io, base, input.tag);
    if (existing && existing.tag_name !== input.tag) throw new Error('Existing release tag identity does not match.');
    if (existing && !existing.draft) {
        if (existing.prerelease !== prerelease)
            throw new Error('Published release classification does not match the requested version.');
        await verifyRemoteTag(io, base, input.tag, object);
        return { status: 'skipped', url: existing.html_url };
    }
    const latest = await optionalRelease(io, `${base}/releases/latest`);
    if (
        latest &&
        (latest.draft ||
            latest.prerelease ||
            latest.tag_name === input.tag ||
            !latest.tag_name.startsWith('v') ||
            !isStableVersion(latest.tag_name.slice(1)))
    ) {
        throw new Error('Invalid previous published release identity.');
    }
    const generated = await io.request('POST', `${base}/releases/generate-notes`, {
        tag_name: input.tag,
        ...(latest ? { previous_tag_name: latest.tag_name } : {}),
    });
    if (!isRecord(generated) || typeof generated.body !== 'string')
        throw new Error('Malformed generated release notes.');
    const body = buildReleaseBody(changes, input.tag, generated.body, input.repository, latest?.tag_name);
    // The existing, verified tag owns the target. A historical target_commitish can require Workflows: write.
    const fields = { tag_name: input.tag, name: input.tag, body, prerelease };
    await verifyRemoteTag(io, base, input.tag, object);
    const draft = releaseRecord(
        existing
            ? await io.request('PATCH', `${base}/releases/${existing.id}`, { ...fields, draft: true })
            : await io.request('POST', `${base}/releases`, { ...fields, draft: true }),
    );
    if (existing && draft.id !== existing.id) throw new Error('Recovered draft identity does not match.');
    if (!draft.draft || draft.tag_name !== input.tag || draft.prerelease !== prerelease)
        throw new Error('GitHub did not return the matching release draft.');
    await verifyRemoteTag(io, base, input.tag, object);
    const published = releaseRecord(
        await io.request('PATCH', `${base}/releases/${draft.id}`, {
            ...fields,
            draft: false,
            make_latest: prerelease ? 'false' : 'legacy',
        }),
    );
    if (published.id !== draft.id) throw new Error('Published release identity does not match the verified draft.');
    if (published.draft || published.tag_name !== input.tag || published.prerelease !== prerelease) {
        throw new Error('GitHub did not confirm publication of the matching release classification.');
    }
    return { status: 'published', url: published.html_url };
}

/** Fixed public REST boundary. Status is retained; token-bearing causes never escape. */
export function createGitHubReleaseRequest(token: string, fetcher: typeof fetch = fetch): ReleaseIO['request'] {
    if (!token.trim()) throw new Error('Release tooling requires the built-in GitHub token.');
    return async (method, endpoint, body) => {
        const url = new URL(endpoint, 'https://api.github.com');
        if (
            !endpoint.startsWith('/repos/') ||
            url.origin !== 'https://api.github.com' ||
            url.username ||
            url.password ||
            url.hash
        )
            throw new Error('Invalid Release API endpoint.');
        let response: Response;
        try {
            response = await fetcher(url.href, {
                method,
                headers: {
                    Accept: 'application/vnd.github+json',
                    Authorization: `Bearer ${token}`,
                    'X-GitHub-Api-Version': '2026-03-10',
                    ...(body ? { 'Content-Type': 'application/json' } : {}),
                },
                ...(body ? { body: JSON.stringify(body) } : {}),
                signal: AbortSignal.timeout(30_000),
                redirect: 'error',
            });
        } catch {
            throw new Error('GitHub Release transport failed.');
        }
        if (!response.ok)
            throw new GitHubApiError(response.status, `GitHub Release request failed (${response.status}).`);
        try {
            const value: unknown = await response.json();
            return value;
        } catch {
            throw new Error('GitHub Release returned malformed JSON.');
        }
    };
}

async function main() {
    if (process.argv.length !== 2 || !process.env.GITHUB_EVENT_PATH || !process.env.GH_TOKEN) {
        throw new Error('Release tooling requires a GitHub tag-push event and its built-in token.');
    }
    const event: unknown = JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH, 'utf8'));
    const input = releaseContext(process.env, event);
    const root = fileURLToPath(new URL('..', import.meta.url));
    const token = process.env.GH_TOKEN;
    const result = await runRelease(input, {
        git: (args) =>
            execFileSync('git', [...args], { cwd: root, encoding: 'utf8', windowsHide: true, timeout: 30_000 }).trim(),
        readFile: (file) => readFile(path.join(root, file), 'utf8'),
        request: createGitHubReleaseRequest(token),
    });
    console.log(`Release ${result.status}: ${result.url}`);
}

if (isMainModule(import.meta)) {
    main().catch((error: unknown) => {
        console.error(errorMessage(error));
        process.exitCode = 1;
    });
}
