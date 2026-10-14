import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { cp, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { checkFreshRouting, scanPolicy } from '../src/policy.ts';
import { LIMITS } from '../src/policy-contract.ts';
import { EvidenceSearch } from '../src/policy-evidence.ts';
import { markdownReferenceTargets } from '../src/policy-markdown.ts';
import { resolveTrustedGit } from '../src/safe-git.ts';

async function fixture() {
    const scratch = await realpath(await mkdtemp(path.join(os.tmpdir(), 'policy-navigation-')));
    const root = path.join(scratch, 'business');
    await mkdir(root);
    const executable = await resolveTrustedGit([scratch]);
    const env = Object.fromEntries(
        Object.entries(process.env).filter(([key]) => !/^(?:GIT_|NODE_OPTIONS$|NODE_PATH$)/i.test(key)),
    );
    const git = (args: string[]) =>
        execFileSync(executable, ['-c', 'core.fsmonitor=false', ...args], {
            cwd: root,
            env,
            encoding: 'utf8',
            windowsHide: true,
        }).trim();
    git(['init', '--quiet', '--initial-branch=main']);
    const operation = {
        schemaVersion: 1,
        id: 'navigation',
        repository: root,
        worktree: root,
        commonGitDir: await realpath(path.join(root, '.git')),
        kind: 'commit',
        paths: ['planned.txt'],
        targets: [],
    };
    const context = {
        schemaVersion: 1,
        phase: 'prepare',
        selection: 'planned-paths',
        invocation: { kind: 'agent-context', reference: 'navigation fixture', effectiveDirectory: root },
    };
    const put = async (name: string, text: string | Buffer) => {
        await mkdir(path.dirname(path.join(root, name)), { recursive: true });
        await writeFile(path.join(root, name), text);
    };
    const state = async () => ({
        head: await readFile(path.join(root, '.git/HEAD')),
        config: await readFile(path.join(root, '.git/config')),
        index: await readFile(path.join(root, '.git/index')).catch(() => null),
        refs: git(['for-each-ref', '--format=%(refname):%(objectname)']),
        status: git(['status', '--porcelain=v1']),
        selected: await readFile(path.join(root, 'planned.txt')).catch(() => null),
    });
    return {
        scratch,
        root,
        env,
        git,
        operation,
        context,
        put,
        state,
        dispose: () => rm(scratch, { recursive: true, force: true }),
    };
}
function decision(scan: Awaited<ReturnType<typeof scanPolicy>>) {
    return {
        schemaVersion: 1,
        artifact: 'policy-decision',
        operation: scan.operation,
        binding: scan.binding,
        branch: 'skill-default',
        assessments: scan.candidates.map((item) => ({
            candidateId: item.id,
            classification: 'unrelated',
            rationale: 'Explicit synthetic semantic assessment.',
        })),
        selectedCandidateIds: [],
        issueIds: scan.issues.map((item) => item.id),
        rationale: 'Complete fixture review.',
        decisionSource: { kind: 'agent-semantic', reference: 'fixture' },
    };
}
async function graph(f: Awaited<ReturnType<typeof fixture>>) {
    await f.put('AGENTS.md', '[contribution](CONTRIBUTING.md)\n');
    await f.put('CONTRIBUTING.md', '[instructions](AGENTS.md) [policy](docs/policy.md)\n');
    await f.put('docs/policy.md', '[messages](messages.md)\n');
    await f.put('docs/messages.md', '[policy](policy.md)\n');
    await f.put('docs/README.md', '[acceptance](acceptance.md)\n');
    await f.put(
        'docs/acceptance.md',
        '[corpus](corpus.json)\n```text\n[literal](missing-fence.md)\n```\n<!--\n- comment example\n  -->\n\n    [literal](missing-comment-indent.md)\n',
    );
    await f.put('docs/corpus.json', '{"example":"[synthetic](missing-corpus.md)"}\n');
}

test('source repository-shaped navigation preserves cycles, raw structured evidence and freshness', async () => {
    const f = await fixture();
    try {
        await graph(f);
        const before = await f.state();
        const scan = await scanPolicy(f);
        assert.equal(scan.exitCode, 0, JSON.stringify(scan.issues));
        assert.equal(new Set(scan.candidates.map((item) => item.locator)).size, scan.candidates.length);
        for (const [a, b] of [
            ['AGENTS.md', 'CONTRIBUTING.md'],
            ['docs/policy.md', 'docs/messages.md'],
        ] as const) {
            const left = scan.candidates.find((item) => item.locator === path.join(f.root, a));
            const right = scan.candidates.find((item) => item.locator === path.join(f.root, b));
            assert.ok(left && right);
            assert.ok(left.referenceIds.includes(right.id));
            assert.ok(right.referenceIds.includes(left.id));
        }
        assert.ok(scan.candidates.some((item) => item.locator.endsWith('corpus.json') && item.sha256.length === 64));
        assert.ok(!scan.checkedLocations.some((item) => /missing-(?:corpus|fence|comment-indent)/.test(item.locator)));
        assert.equal((await checkFreshRouting({ ...f, decision: decision(scan) })).freshness, 'current');
        assert.deepEqual(await f.state(), before);
        for (const name of ['AGENTS.md', 'CONTRIBUTING.md', 'docs/corpus.json']) {
            const current = await scanPolicy(f);
            await f.put(name, `${await readFile(path.join(f.root, name), 'utf8')}\n`);
            assert.equal((await checkFreshRouting({ ...f, decision: decision(current) })).exitCode, 20);
        }
    } finally {
        await f.dispose();
    }
});

test('source prose masks lexical literals while preserving quotes, lists and code labels', async () => {
    const f = await fixture();
    try {
        await f.put('policy.md', 'Rule.\n');
        const text = [
            '[prose](policy.md "title")',
            '> [quote](policy.md)',
            '[`code label`](policy.md)',
            '- item',
            '    [list continuation](policy.md)',
            '    ```',
            '    [list fence](missing-list.md)',
            '    ```',
            'Standalone prose ends the list.',
            '    [indented](missing-indent.md)',
            '\t[tab](missing-tab.md)',
            '`[inline](missing-inline.md)` ``[multi](missing-multi.md)``',
            '```[triple](missing-triple.md)```',
            '``multiline',
            '[line span](missing-multiline.md)',
            '``',
            '<!--',
            '` [comment](missing-comment.md)',
            '-->',
            '>[quote after comment](policy.md)',
            '> ```',
            '> [quoted fence](missing-quote.md)',
            '> ```',
            '>     [quoted indent](missing-quoted-indent.md)',
            '~~~',
            '[tilde](missing-tilde.md)',
            '~~',
            '[short closer](missing-short.md)',
            '```',
            '[wrong marker](missing-wrong-marker.md)',
            '~~~',
            '`` unmatched [real](policy.md)',
            '```',
            '[unclosed](missing-unclosed.md)',
        ].join('\r\n');
        await f.put('README.md', text);
        const scan = await scanPolicy(f);
        assert.equal(scan.exitCode, 0, JSON.stringify(scan.issues));
        assert.ok(!scan.checkedLocations.some((item) => /missing-/.test(item.locator)));
        const readme = scan.candidates.find((item) => item.locator.endsWith('README.md'));
        const policy = scan.candidates.find((item) => item.locator === path.join(f.root, 'policy.md'));
        assert.ok(readme && policy && readme.referenceIds.includes(policy.id));
        await f.put('README.md', `${text}\r\n\`\`\`\r\n[real missing](missing-real.md)\r\n`);
        const missing = await scanPolicy(f);
        assert.equal(missing.exitCode, 20);
        assert.ok(
            missing.issues.some(
                (item) => item.code === 'missing-reference' && item.locator?.endsWith('missing-real.md'),
            ),
        );
    } finally {
        await f.dispose();
    }
});

test('source unmatched backticks cannot consume a real link before a later code block', async () => {
    const f = await fixture();
    try {
        await f.put('README.md', '`punctuation [required](missing-real.md)\n~~~\n`\n~~~\n');
        const scan = await scanPolicy(f);
        assert.equal(scan.exitCode, 20);
        assert.ok(scan.issues.some((item) => item.code === 'missing-reference'));
    } finally {
        await f.dispose();
    }
});

test('source continuation fences cannot hide preceding required prose links', async (t) => {
    const f = await fixture();
    try {
        for (const { name, source } of [
            {
                name: 'supplied unordered list',
                source: '- `punctuation [required](missing-list-before-fence.md)\n    ~~~\n    `\n    ~~~\n',
            },
            {
                name: 'ordered list',
                source: '12. `punctuation [required](missing-list-before-fence.md)\n      ~~~\n      `\n      ~~~\n',
            },
            {
                name: 'quoted list',
                source: '> - `punctuation [required](missing-list-before-fence.md)\n>     ~~~\n>     `\n>     ~~~\n',
            },
            {
                name: 'backtick fence',
                source: '- `punctuation [required](missing-list-before-fence.md)\n    ```\n    `\n    ```\n',
            },
            {
                name: 'one continuation space',
                source: '- `punctuation [required](missing-list-before-fence.md)\n   ~~~\n   `\n   ~~~\n',
            },
            {
                name: 'three continuation spaces',
                source: '- `punctuation [required](missing-list-before-fence.md)\n     ~~~\n     `\n     ~~~\n',
            },
            {
                name: 'ordinary indented block',
                source: '`punctuation [required](missing-list-before-fence.md)\n    code `\n',
            },
        ]) {
            await t.test(name, async () => {
                await f.put('README.md', source);
                const scan = await scanPolicy(f);
                assert.equal(scan.exitCode, 20, JSON.stringify(scan.issues));
                assert.ok(
                    scan.issues.some(
                        (item) =>
                            item.code === 'missing-reference' &&
                            item.locator === path.join(f.root, 'missing-list-before-fence.md'),
                    ),
                );
                assert.deepEqual(markdownReferenceTargets(source), ['missing-list-before-fence.md']);
            });
        }
    } finally {
        await f.dispose();
    }
});

test('source list continuation remains prose across a blank line', async () => {
    const f = await fixture();
    try {
        await f.put('README.md', '- item\n\n    [required](missing-list-prose.md)\n');
        const scan = await scanPolicy(f);
        assert.equal(scan.exitCode, 20);
        assert.ok(scan.issues.some((item) => item.code === 'missing-reference'));
    } finally {
        await f.dispose();
    }
});

test('source literal list markers cannot change later indented-code classification', async () => {
    const f = await fixture();
    try {
        for (const literal of [
            '<!--\n- example inside a comment\n  -->\n',
            '~~~\n- example inside a fence\n  ~~~\n',
            '``multiline span\n- example inside a span\n  ``\n',
        ]) {
            await f.put('README.md', `${literal}\n    [literal](missing-comment-indent.md)\n`);
            const scan = await scanPolicy(f);
            assert.equal(scan.exitCode, 0, JSON.stringify(scan.issues));
            assert.ok(!scan.checkedLocations.some((item) => item.locator.endsWith('missing-comment-indent.md')));
        }
    } finally {
        await f.dispose();
    }
});

test('source multiline spans in list continuation remain literal before real prose', async () => {
    const f = await fixture();
    try {
        await f.put('README.md', '- item ``multiline\n    [literal](missing-list-span.md)\n    ``\n');
        const scan = await scanPolicy(f);
        assert.equal(scan.exitCode, 0, JSON.stringify(scan.issues));
        assert.ok(!scan.checkedLocations.some((item) => item.locator.endsWith('missing-list-span.md')));
        await f.put(
            'README.md',
            '- item ``multiline\n    [literal](missing-list-span.md)\n    ``\n\n    [required](missing-list-rule.md)\n',
        );
        const missing = await scanPolicy(f);
        assert.equal(missing.exitCode, 20);
        assert.ok(missing.issues.some((item) => item.locator?.endsWith('missing-list-rule.md')));
        assert.ok(!missing.checkedLocations.some((item) => item.locator.endsWith('missing-list-span.md')));
    } finally {
        await f.dispose();
    }
});

test('source format and source-kind profile retains text/template links and excludes script strings', async () => {
    const f = await fixture();
    try {
        for (const name of ['corpus.json', 'rules.yaml', 'source.ts', 'source.js', 'script'])
            await f.put(name, `${name === 'script' ? '#!/bin/sh\n' : ''}[literal](missing-literal.md)\n`);
        await f.put(
            'README.md',
            '[json](corpus.json) [yaml](rules.yaml) [ts](source.ts) [js](source.js) [script](script)\n',
        );
        await f.put('.git/hooks/commit-msg', '#!/bin/sh\n[hook](missing-hook.md)\n');
        assert.equal((await scanPolicy(f)).exitCode, 0);
        for (const name of ['CONTRIBUTING.txt', 'template', 'template.txt', 'template.md', 'template.tmpl']) {
            await f.put(name, '[required](missing-required.md)\n');
            if (name.startsWith('template')) f.git(['config', 'commit.template', name]);
            const scan = await scanPolicy(f);
            assert.equal(scan.exitCode, 20, name);
            assert.ok(scan.issues.some((item) => item.code === 'missing-reference'));
            await f.put(name, 'Text.\n');
        }
        await f.put('template.json', '{"example":"[literal](missing-template.md)"}\n');
        f.git(['config', 'commit.template', 'template.json']);
        assert.equal((await scanPolicy(f)).exitCode, 0);
        await f.put('AGENTS.md', '[template](rules.tmpl)\n');
        await f.put('rules.tmpl', '[required](missing-cached-template.md)\n');
        f.git(['config', 'commit.template', 'rules.tmpl']);
        const promoted = await scanPolicy(f);
        assert.equal(promoted.exitCode, 20);
        assert.ok(promoted.issues.some((item) => item.locator?.endsWith('missing-cached-template.md')));
        assert.equal(promoted.candidates.filter((item) => item.locator.endsWith('rules.tmpl')).length, 1);
        await f.put('rules.tmpl', 'Text.\n');
        const external = path.join(f.scratch, 'external-policy');
        await writeFile(external, '[required](external-missing.md)\n');
        assert.equal(
            (await scanPolicy({ ...f, context: { ...f.context, additionalCandidatePaths: [external] } })).exitCode,
            20,
        );
        await f.put('source.ts', Buffer.from([0xc0, 0xaf]));
        assert.equal((await scanPolicy(f)).exitCode, 20);
    } finally {
        await f.dispose();
    }
});

test('source directory reentry widens narrow discovery and completes late sibling edges', async () => {
    const f = await fixture();
    try {
        await f.put('docs/README.md', '[directory](./) [empty](empty/)\n');
        await f.put('docs/z-extra.md', 'Adopted child excluded by narrow discovery.\n');
        await mkdir(path.join(f.root, 'docs/empty'));
        const scan = await scanPolicy(f);
        assert.equal(scan.exitCode, 0, JSON.stringify(scan.issues));
        const readme = scan.candidates.find((item) => item.locator.endsWith(path.join('docs', 'README.md')));
        const late = scan.candidates.find((item) => item.locator.endsWith('z-extra.md'));
        assert.ok(readme && late && readme.referenceIds.includes(late.id));
        const search = new EvidenceSearch();
        search.repository = f.root;
        await search.docs(path.join(f.root, 'docs'));
        assert.equal(search.directories.get(path.join(f.root, 'docs')), 'adopted');
        await f.put('docs/z-extra.md', 'Changed.\n');
        assert.equal((await checkFreshRouting({ ...f, decision: decision(scan) })).exitCode, 20);
        const current = await scanPolicy(f);
        await f.put('docs/empty/new.md', 'New inventory.\n');
        assert.equal((await checkFreshRouting({ ...f, decision: decision(current) })).exitCode, 20);
    } finally {
        await f.dispose();
    }
});

test('source self and cached ninth-hop edges reuse candidates while distinct depth and visit limits remain closed', async () => {
    const f = await fixture();
    try {
        await f.put('self.md', '[self](self.md)\n');
        const search = new EvidenceSearch();
        await search.read(path.join(f.root, 'self.md'), 'explicit-candidate', 'fixture', true, LIMITS.referenceHops);
        assert.deepEqual(search.issues, []);
        assert.equal(search.candidates.length, 1);
        assert.deepEqual(search.candidates[0]?.referenceIds, [search.candidates[0]?.id]);
        for (let i = 0; i <= 9; i++) await f.put(`chain-${i}.md`, i === 9 ? 'End.' : `[next](chain-${i + 1}.md)`);
        const chain = new EvidenceSearch();
        await chain.read(path.join(f.root, 'chain-0.md'), 'explicit-candidate', 'fixture', true);
        assert.ok(chain.issues.some((item) => item.code === 'reference-budget'));
        await f.put('network.md', '[unfetched](https://example.invalid/policy)');
        const network = new EvidenceSearch();
        await network.read(
            path.join(f.root, 'network.md'),
            'explicit-candidate',
            'fixture',
            true,
            LIMITS.referenceHops,
        );
        assert.ok(network.issues.some((item) => item.code === 'reference-budget'));
        await f.put('repeated.md', '[self](repeated.md)\n'.repeat(LIMITS.entries + 1));
        const repeated = new EvidenceSearch();
        await repeated.read(path.join(f.root, 'repeated.md'), 'explicit-candidate', 'fixture', true);
        assert.ok(repeated.issues.length);
        assert.equal(repeated.files, 1);
    } finally {
        await f.dispose();
    }
});

test('copied generated CLI handles prose navigation and rejects stale structured bytes and genuine missing prose', async () => {
    const f = await fixture();
    try {
        await graph(f);
        const payload = path.join(f.scratch, 'payload');
        await cp(new URL('../skills/ai-commit-attribution/', import.meta.url), payload, { recursive: true });
        const op = path.join(f.scratch, 'operation.json'),
            ctx = path.join(f.scratch, 'context.json'),
            dec = path.join(f.scratch, 'decision.json');
        await writeFile(op, JSON.stringify(f.operation));
        await writeFile(ctx, JSON.stringify(f.context));
        const run = (withDecision = false) =>
            spawnSync(
                process.execPath,
                [
                    path.join(payload, 'scripts/attribution.mjs'),
                    'policy',
                    'scan',
                    '--operation',
                    op,
                    '--context',
                    ctx,
                    ...(withDecision ? ['--decision', dec] : []),
                ],
                { cwd: f.root, env: f.env, encoding: 'utf8', windowsHide: true },
            );
        const before = await f.state();
        const result = run();
        assert.equal(result.status, 0, result.stdout + result.stderr);
        const scan = JSON.parse(result.stdout) as Awaited<ReturnType<typeof scanPolicy>>;
        await writeFile(dec, JSON.stringify(decision(scan)));
        assert.equal(run(true).status, 0);
        assert.equal(existsSync(path.join(f.scratch, 'node_modules')), false);
        assert.deepEqual(await f.state(), before);
        await f.put('docs/corpus.json', '{"changed":true}\n');
        assert.equal(run(true).status, 20);
        await f.put('README.md', '- `punctuation [required](missing-list-before-fence.md)\n    ~~~\n    `\n    ~~~\n');
        const missing = run();
        assert.equal(missing.status, 20);
        assert.ok(
            JSON.parse(missing.stdout).issues.some(
                (item: { code: string; locator?: string }) =>
                    item.code === 'missing-reference' &&
                    item.locator === path.join(f.root, 'missing-list-before-fence.md'),
            ),
        );
    } finally {
        await f.dispose();
    }
});
