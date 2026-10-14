import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readdir, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { checkFreshRouting, scanPolicy } from '../src/policy.ts';
import { LIMITS, parseContext } from '../src/policy-contract.ts';
import { EvidenceSearch } from '../src/policy-evidence.ts';
import { resolveTrustedGit, SafeGit } from '../src/safe-git.ts';

async function fixture() {
    const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'policy-fix-')));
    const executable = await resolveTrustedGit([root]);
    const env = Object.fromEntries(
        Object.entries(process.env).filter(([key]) => !/^(?:GIT_|NODE_OPTIONS$|NODE_PATH$)/i.test(key)),
    );
    const git = (args: string[]) =>
        execFileSync(
            executable,
            [
                '-c',
                'core.autocrlf=false',
                '-c',
                'core.fsmonitor=false',
                '-c',
                'user.name=Fixture',
                '-c',
                'user.email=fixture@example.invalid',
                ...args,
            ],
            { cwd: root, env, encoding: 'utf8', windowsHide: true },
        ).trim();
    git(['init', '--quiet', '--initial-branch=main']);
    const operation = {
        schemaVersion: 1,
        id: 'same-operation',
        repository: root,
        worktree: root,
        commonGitDir: await realpath(path.join(root, '.git')),
        kind: 'commit',
        paths: ['planned.txt'],
        targets: [] as { role: string; objectId: string }[],
    };
    const context = {
        schemaVersion: 1,
        phase: 'prepare',
        selection: 'planned-paths',
        invocation: { kind: 'agent-context', reference: 'review fixture', effectiveDirectory: root },
    };
    const commit = async (file: string, bytes: string) => {
        await mkdir(path.dirname(path.join(root, file)), { recursive: true });
        await writeFile(path.join(root, file), bytes);
        git(['add', '--', file]);
        git(['commit', '--quiet', '-m', 'fixture']);
        return git(['rev-parse', 'HEAD']);
    };
    const snapshot = async () => ({
        head: await readFile(path.join(root, '.git/HEAD')),
        refs: git(['for-each-ref', '--format=%(refname):%(objectname)']),
        config: await readFile(path.join(root, '.git/config')),
        index: await readFile(path.join(root, '.git/index')).catch(() => null),
        status: git(['status', '--porcelain=v1']),
    });
    return {
        root,
        executable,
        env,
        git,
        operation,
        context,
        commit,
        snapshot,
        dispose: () => rm(root, { recursive: true, force: true }),
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
            rationale: 'Fixture semantic assessment, never a scanner heuristic.',
        })),
        selectedCandidateIds: [],
        issueIds: scan.issues.map((item) => item.id),
        rationale: 'Explicit complete fixture assessment.',
        decisionSource: { kind: 'agent-semantic', reference: 'fixture' },
    };
}
async function instrumented(
    f: Awaited<ReturnType<typeof fixture>>,
    options: { disappear?: string; installed?: boolean } = {},
) {
    const scratch = await realpath(await mkdtemp(path.join(os.tmpdir(), 'policy-fix-observe-')));
    const entry = fileURLToPath(new URL('../src/attribution.ts', import.meta.url));
    const evidence = new URL('../tooling/file-evidence.ts', import.meta.url).href;
    const wrapper = path.join(scratch, 'read-observer.mjs');
    const log = path.join(scratch, 'reads.jsonl');
    await writeFile(
        wrapper,
        `import {appendFileSync,unlinkSync} from 'node:fs';\nimport {readRegularFile as original} from ${JSON.stringify(`${evidence}?original`)};\nexport {samePhysicalPath} from ${JSON.stringify(`${evidence}?original`)};\nexport async function readRegularFile(file,io){appendFileSync(${JSON.stringify(log)},JSON.stringify({file,maximumBytes:io?.maximumBytes})+'\\n');if(file===${JSON.stringify(options.disappear ?? '')}){unlinkSync(file);throw Object.assign(new Error('injected disappearance'),{code:'ENOENT'});}return original(file,io);}\n`,
    );
    const loader = path.join(scratch, 'observe-loader.mjs');
    await writeFile(
        loader,
        `import {registerHooks} from 'node:module';\nregisterHooks({resolve(specifier,context,next){const result=next(specifier,context);return result.url===${JSON.stringify(evidence)}?{url:${JSON.stringify(pathToFileURL(wrapper).href)},shortCircuit:true}:result;}});\n`,
    );
    return {
        scratch,
        log,
        run: async (operation: unknown, context: unknown, policyDecision?: unknown) => {
            const op = path.join(scratch, 'operation.json'),
                ctx = path.join(scratch, 'context.json');
            await writeFile(op, JSON.stringify(operation));
            await writeFile(ctx, JSON.stringify(context));
            const assessment = path.join(scratch, 'decision.json');
            if (policyDecision !== undefined) await writeFile(assessment, JSON.stringify(policyDecision));
            let cli = entry;
            if (options.installed) {
                const payload = path.join(scratch, 'payload');
                await cp(new URL('../skills/ai-commit-attribution/', import.meta.url), payload, { recursive: true });
                cli = path.join(payload, 'scripts/attribution.mjs');
            }
            return spawnSync(
                process.execPath,
                [
                    ...(options.installed ? [] : ['--import', pathToFileURL(loader).href]),
                    cli,
                    'policy',
                    'scan',
                    '--operation',
                    op,
                    '--context',
                    ctx,
                    ...(policyDecision === undefined ? [] : ['--decision', assessment]),
                ],
                { cwd: f.root, env: f.env, encoding: 'utf8', windowsHide: true },
            );
        },
        dispose: () => rm(scratch, { recursive: true, force: true }),
    };
}

test('review I1 message-only amend captures replaced affected paths and policy freshness', async () => {
    const f = await fixture();
    try {
        const head = await f.commit('area/a.txt', 'committed\n');
        await writeFile(path.join(f.root, 'area/AGENTS.md'), 'AI disclosure policy.\n');
        const operation = { ...f.operation, kind: 'amend', paths: [], targets: [{ role: 'replaced', objectId: head }] };
        const context = { ...f.context, phase: 'edit-message', selection: 'index' };
        const before = await f.snapshot();
        const scan = await scanPolicy({ operation, context });
        assert.equal(scan.exitCode, 0, JSON.stringify(scan.issues));
        assert.ok(scan.candidates.some((item) => item.locator === path.join(f.root, 'area/AGENTS.md')));
        assert.deepEqual(await f.snapshot(), before);
        await writeFile(path.join(f.root, 'area/AGENTS.md'), 'A different disclosure policy.\n');
        assert.equal((await checkFreshRouting({ operation, context, decision: decision(scan) })).freshness, 'stale');
    } finally {
        await f.dispose();
    }
});

async function lateDirectoryAdoption(f: Awaited<ReturnType<typeof fixture>>) {
    await mkdir(path.join(f.root, 'docs/team'), { recursive: true });
    await writeFile(path.join(f.root, 'docs/rules.md'), 'AI contributions must disclose their provenance.\n');
    await writeFile(path.join(f.root, 'docs/team/rules.txt'), 'Nested AI contribution requirements.\n');
    const navigation = path.join(f.root, 'navigation.md');
    await writeFile(navigation, '[commit rules](docs/)\n');
    return { ...f.context, additionalCandidatePaths: [navigation] };
}

test('review R1 late explicit directory adoption widens previously narrow discovery and binds bytes', async () => {
    const f = await fixture();
    try {
        const context = await lateDirectoryAdoption(f);
        const before = await f.snapshot();
        const scan = await scanPolicy({ ...f, context });
        assert.equal(scan.exitCode, 0, JSON.stringify(scan.issues));
        assert.ok(scan.candidates.some((item) => item.locator === path.join(f.root, 'docs/rules.md')));
        assert.ok(scan.candidates.some((item) => item.locator === path.join(f.root, 'docs/team/rules.txt')));
        assert.deepEqual((await scanPolicy({ ...f, context })).binding, scan.binding);
        const accepted = decision(scan);
        assert.equal((await checkFreshRouting({ ...f, context, decision: accepted })).exitCode, 0);
        await writeFile(path.join(f.root, 'docs/rules.md'), 'Changed AI contributions policy.\n');
        assert.equal((await checkFreshRouting({ ...f, context, decision: accepted })).exitCode, 20);
        assert.deepEqual(await f.snapshot(), before);
    } finally {
        await f.dispose();
    }
});

test('review R1 actual external installed late adoption includes policy hashes and rejects stale bytes', async () => {
    const f = await fixture();
    const installed = await instrumented(f, { installed: true });
    try {
        const context = await lateDirectoryAdoption(f);
        const before = await f.snapshot();
        const result = await installed.run(f.operation, context);
        assert.equal(result.status, 0, result.stderr + result.stdout);
        const scan = JSON.parse(result.stdout);
        assert.ok(
            scan.candidates.some(
                (item: { locator: string; sha256: string }) =>
                    item.locator === path.join(f.root, 'docs/rules.md') && /^[a-f0-9]{64}$/.test(item.sha256),
            ),
        );
        const accepted = decision(scan);
        assert.equal((await installed.run(f.operation, context, accepted)).status, 0);
        await writeFile(path.join(f.root, 'docs/rules.md'), 'Changed installed policy evidence.\n');
        assert.equal((await installed.run(f.operation, context, accepted)).status, 20);
        assert.deepEqual(await f.snapshot(), before);
    } finally {
        await installed.dispose();
        await f.dispose();
    }
});

test('review R1 completed directory modes widen children once, preserve broad coverage, and share the cap', async () => {
    const f = await fixture();
    try {
        await lateDirectoryAdoption(f);
        const directory = path.join(f.root, 'docs');
        const narrow = new EvidenceSearch();
        narrow.repository = f.root;
        await narrow.docs(directory);
        assert.equal(narrow.candidates.length, 0);
        await narrow.docs(directory, 0, 1);
        assert.equal(narrow.candidates.length, 2);
        assert.equal(narrow.directories.get(path.join(directory, 'team')), 'adopted');
        const bytes = narrow.bytes;
        await narrow.docs(directory, 0, 1);
        await narrow.docs(directory);
        assert.equal(narrow.bytes, bytes);
        assert.equal(new Set(narrow.candidates.map((item) => item.id)).size, 2);
        const broad = new EvidenceSearch();
        broad.repository = f.root;
        await broad.docs(directory, 0, 1);
        await broad.docs(directory);
        assert.deepEqual(
            broad.candidates.map((item) => item.sha256),
            narrow.candidates.map((item) => item.sha256),
        );
        const bounded = new EvidenceSearch();
        bounded.repository = f.root;
        await bounded.docs(directory);
        bounded.entries = LIMITS.entries - 1;
        await bounded.docs(directory, 0, 1);
        assert.ok(bounded.issues.some((item) => item.code === 'directory-observation'));
        assert.equal(bounded.candidates.length, 0);
        assert.equal(bounded.directories.get(directory), 'narrow');
    } finally {
        await f.dispose();
    }
});

test('review I1 actual multi-commit merge includes early range and resolution-only paths', async () => {
    const f = await fixture();
    try {
        await f.commit('base.txt', 'base\n');
        f.git(['checkout', '--quiet', '-b', 'source']);
        await f.commit('area/a.txt', 'early source\n');
        const source = await f.commit('other/b.txt', 'tip source\n');
        f.git(['checkout', '--quiet', 'main']);
        const head = await f.commit('main.txt', 'main\n');
        f.git(['merge', '--quiet', '--no-commit', 'source']);
        await mkdir(path.join(f.root, 'resolution'));
        await writeFile(path.join(f.root, 'resolution/only.txt'), 'resolution\n');
        f.git(['add', 'resolution/only.txt']);
        for (const directory of ['area', 'resolution'])
            await writeFile(path.join(f.root, directory, 'AGENTS.md'), `${directory} AI policy.\n`);
        const operation = {
            ...f.operation,
            kind: 'merge',
            paths: [],
            targets: [
                { role: 'head', objectId: head },
                { role: 'source', objectId: source },
            ],
        };
        const context = { ...f.context, phase: 'edit-message', selection: 'operation-targets' };
        const before = await f.snapshot();
        const scan = await scanPolicy({ operation, context });
        assert.equal(scan.exitCode, 0, JSON.stringify(scan.issues));
        for (const directory of ['area', 'resolution'])
            assert.ok(
                scan.candidates.some((item) => item.locator === path.join(f.root, directory, 'AGENTS.md')),
                directory,
            );
        assert.deepEqual(await f.snapshot(), before);
        await writeFile(path.join(f.root, 'area/AGENTS.md'), 'Changed early policy.\n');
        assert.equal((await checkFreshRouting({ operation, context, decision: decision(scan) })).freshness, 'stale');
    } finally {
        await f.dispose();
    }
});

test('review I2 optional missing instruction is promoted by adopted and additional references', async () => {
    const f = await fixture();
    try {
        for (const use of ['link', 'additional']) {
            await writeFile(
                path.join(f.root, 'README.md'),
                use === 'link' ? 'Before committing read [instructions](AGENTS.md).\n' : 'Contribution guide.\n',
            );
            const context = {
                ...f.context,
                ...(use === 'additional' ? { additionalCandidatePaths: [path.join(f.root, 'AGENTS.md')] } : {}),
            };
            const before = await f.snapshot();
            const scan = await scanPolicy({ operation: f.operation, context });
            assert.equal(scan.exitCode, 20, use);
            assert.ok(
                scan.issues.some(
                    (item) => item.code === 'missing-reference' && item.locator === path.join(f.root, 'AGENTS.md'),
                ),
            );
            assert.equal(
                (await checkFreshRouting({ operation: f.operation, context, decision: decision(scan) })).exitCode,
                20,
            );
            assert.deepEqual(await f.snapshot(), before);
        }
    } finally {
        await f.dispose();
    }
});

test('review I3 adopted repository directory navigation discovers and binds contents outside fixed roots', async () => {
    const f = await fixture();
    try {
        await mkdir(path.join(f.root, 'contribution'));
        await writeFile(path.join(f.root, 'README.md'), '[commit policy](contribution/)\n');
        const empty = await scanPolicy(f);
        assert.equal(empty.exitCode, 0);
        await writeFile(path.join(f.root, 'contribution/commit-policy.md'), 'No AI disclosure.\n');
        const scan = await scanPolicy(f);
        assert.equal(scan.exitCode, 0, JSON.stringify(scan.issues));
        assert.ok(scan.candidates.some((item) => item.locator === path.join(f.root, 'contribution/commit-policy.md')));
        assert.equal((await checkFreshRouting({ ...f, decision: decision(empty) })).freshness, 'stale');
        await writeFile(path.join(f.root, 'contribution/commit-policy.md'), 'Use a body statement.\n');
        assert.equal((await checkFreshRouting({ ...f, decision: decision(scan) })).freshness, 'stale');
    } finally {
        await f.dispose();
    }
});

test('review I4 selected traversal counts more than 4096 empty directories and preserves state', async () => {
    const f = await fixture();
    try {
        await mkdir(path.join(f.root, 'tree'));
        for (let offset = 0; offset < 4100; offset += 100)
            await Promise.all(
                Array.from({ length: 100 }, (_, index) =>
                    mkdir(path.join(f.root, 'tree', `empty-${String(offset + index).padStart(4, '0')}`)),
                ),
            );
        const before = await f.snapshot();
        const scan = await scanPolicy({ operation: { ...f.operation, paths: ['tree'] }, context: f.context });
        assert.equal(scan.exitCode, 20);
        assert.match(JSON.stringify(scan.issues), /budget/);
        assert.equal((await readdir(path.join(f.root, 'tree'))).length, 4100);
        assert.deepEqual(await f.snapshot(), before);
    } finally {
        await f.dispose();
    }
});

test('review I4 raw leaf reads occur once within the aggregate path byte budget', async () => {
    const f = await fixture();
    const observer = await instrumented(f);
    try {
        await mkdir(path.join(f.root, 'data'));
        for (const [file, bytes] of [
            ['a.bin', 3 * 1024 * 1024],
            ['b.bin', 3 * 1024 * 1024],
            ['c.bin', 1],
        ] as const)
            await writeFile(path.join(f.root, 'data', file), Buffer.alloc(bytes, 65));
        const before = await f.snapshot();
        const files = ['a.bin', 'b.bin', 'c.bin'].map((name) => path.join(f.root, 'data', name));
        const beforeBytes = await Promise.all(files.map((file) => readFile(file)));
        const result = await observer.run({ ...f.operation, paths: ['data'] }, f.context);
        assert.equal(result.status, 20, result.stderr);
        const reads = (await readFile(observer.log, 'utf8'))
            .trim()
            .split('\n')
            .map((line) => JSON.parse(line))
            .filter((item) => item.file.startsWith(path.join(f.root, 'data') + path.sep));
        assert.deepEqual(
            reads.map((item) => path.basename(item.file)),
            ['a.bin', 'b.bin'],
        );
        assert.equal(reads[0]?.maximumBytes, 4 * 1024 * 1024);
        assert.equal(reads[1]?.maximumBytes, 1024 * 1024);
        assert.deepEqual(await Promise.all(files.map((file) => readFile(file))), beforeBytes);
        assert.deepEqual(await f.snapshot(), before);
    } finally {
        await observer.dispose();
        await f.dispose();
    }
});

test('review I5 dangling discovery and intermediate links are unsafe rather than ordinary absence', async () => {
    const f = await fixture();
    try {
        await symlink(
            path.join(f.root, 'missing-target'),
            path.join(f.root, 'docs'),
            process.platform === 'win32' ? 'junction' : 'dir',
        );
        const before = await f.snapshot();
        const discovery = await scanPolicy(f);
        assert.equal(discovery.exitCode, 20);
        assert.deepEqual(await f.snapshot(), before);
        await rm(path.join(f.root, 'docs'));
        await symlink(
            path.join(f.root, 'missing-target'),
            path.join(f.root, 'broken'),
            process.platform === 'win32' ? 'junction' : 'dir',
        );
        const intermediate = await scanPolicy({
            operation: { ...f.operation, paths: ['broken/absent.txt'] },
            context: f.context,
        });
        assert.equal(intermediate.exitCode, 20);
        const externalCandidate = await scanPolicy({
            ...f,
            context: { ...f.context, additionalCandidatePaths: [path.join(f.root, 'broken/absent.md')] },
        });
        assert.equal(externalCandidate.exitCode, 20);
    } finally {
        await f.dispose();
    }
});

test('review I5 disappearance after observed presence is a race, using a real deterministic read boundary', async () => {
    const f = await fixture();
    const target = path.join(f.root, 'race.txt');
    const observer = await instrumented(f, { disappear: target });
    try {
        await writeFile(target, 'present before observation\n');
        const head = await readFile(path.join(f.root, '.git/HEAD')),
            config = await readFile(path.join(f.root, '.git/config'));
        const result = await observer.run({ ...f.operation, paths: ['race.txt'] }, f.context);
        assert.equal(result.status, 20, result.stderr + result.stdout);
        assert.deepEqual(await readFile(path.join(f.root, '.git/HEAD')), head);
        assert.deepEqual(await readFile(path.join(f.root, '.git/config')), config);
    } finally {
        await observer.dispose();
        await f.dispose();
    }
});

test('review M1 raw absolute locators retain filename whitespace and path records lose only terminators', async () => {
    const f = await fixture();
    try {
        const locator = path.join(f.root, 'policy.md ');
        const parsed = parseContext({
            ...f.context,
            additionalCandidatePaths: [locator],
            invocation: { ...f.context.invocation, effectiveDirectory: `${f.root} ` },
        });
        assert.equal(parsed.additionalCandidatePaths?.[0], locator);
        assert.equal(parsed.invocation.effectiveDirectory, `${f.root} `);
        const records = new SafeGit(f.executable, f.root);
        records.run = async () => Buffer.from('/exact/physical/path \r\n');
        assert.equal(await records.text('rev-parse', ['--show-toplevel']), '/exact/physical/path ');
        if (process.platform === 'win32') {
            const namespaced = path.toNamespacedPath(locator);
            await writeFile(namespaced, 'Exact namespaced trailing-space rule.\n');
            await writeFile(path.join(f.root, 'policy.md'), 'Different ordinary rule.\n');
            const scan = await scanPolicy({ ...f, context: { ...f.context, additionalCandidatePaths: [namespaced] } });
            assert.equal(
                scan.candidates.find((item) => item.locator === namespaced)?.text,
                'Exact namespaced trailing-space rule.\n',
                JSON.stringify(scan.issues),
            );
        }
        if (process.platform !== 'win32') {
            await writeFile(locator, 'Exact trailing-space policy.\n');
            await writeFile(path.join(f.root, 'policy.md'), 'Different rule.\n');
            const scan = await scanPolicy({ ...f, context: { ...f.context, additionalCandidatePaths: [locator] } });
            assert.equal(
                scan.candidates.find((item) => item.locator === locator)?.text,
                'Exact trailing-space policy.\n',
            );
            const worktree = path.join(f.root, 'trailing-worktree ');
            await mkdir(worktree);
            execFileSync(f.executable, ['init', '--quiet', worktree], { env: f.env, windowsHide: true });
            const operation = {
                ...f.operation,
                repository: worktree,
                worktree,
                commonGitDir: path.join(worktree, '.git'),
            };
            const result = await scanPolicy({
                operation,
                context: { ...f.context, invocation: { ...f.context.invocation, effectiveDirectory: worktree } },
            });
            assert.equal(result.exitCode, 0, JSON.stringify(result.issues));
        }
    } finally {
        await f.dispose();
    }
});

test('review I3 external directory references close without enumerating private descendants', async () => {
    const f = await fixture();
    const external = await realpath(await mkdtemp(path.join(os.tmpdir(), 'policy-private-')));
    try {
        await writeFile(path.join(external, 'commit-policy.md'), 'PRIVATE-UNADOPTED-CONTENT\n');
        await writeFile(path.join(f.root, 'README.md'), `[rules](${external.replaceAll('\\', '/')}/)\n`);
        const before = await f.snapshot();
        const scan = await scanPolicy(f);
        assert.equal(scan.exitCode, 20);
        assert.ok(scan.issues.some((item) => item.code === 'external-directory-reference'));
        assert.ok(!scan.candidates.some((item) => item.locator.startsWith(external)));
        assert.doesNotMatch(JSON.stringify(scan), /PRIVATE-UNADOPTED-CONTENT/);
        assert.deepEqual(await f.snapshot(), before);
    } finally {
        await f.dispose();
        await rm(external, { recursive: true, force: true });
    }
});

test('review fixes are present in actual external installed amend/navigation/missing-reference business paths', async () => {
    const f = await fixture();
    const installed = await instrumented(f, { installed: true });
    try {
        const head = await f.commit('area/file.txt', 'amend target\n');
        await writeFile(path.join(f.root, 'area/AGENTS.md'), 'No disclosure.\n');
        await mkdir(path.join(f.root, 'contribution'));
        await writeFile(path.join(f.root, 'contribution/commit-policy.md'), 'Use repository policy.\n');
        await writeFile(path.join(f.root, 'README.md'), '[rules](contribution/)\n');
        const operation = { ...f.operation, kind: 'amend', paths: [], targets: [{ role: 'replaced', objectId: head }] };
        const context = { ...f.context, phase: 'edit-message', selection: 'index' };
        const before = await f.snapshot();
        const result = await installed.run(operation, context);
        assert.equal(result.status, 0, result.stderr + result.stdout);
        const scan = JSON.parse(result.stdout);
        assert.ok(
            scan.candidates.some((item: { locator: string }) => item.locator === path.join(f.root, 'area/AGENTS.md')),
        );
        assert.ok(
            scan.candidates.some(
                (item: { locator: string }) => item.locator === path.join(f.root, 'contribution/commit-policy.md'),
            ),
        );
        assert.deepEqual(await f.snapshot(), before);
        await writeFile(path.join(f.root, 'README.md'), '[required](AGENTS.md)\n');
        assert.equal((await installed.run(operation, context)).status, 20);
        await writeFile(path.join(f.root, 'README.md'), 'Ordinary contribution guide.\n');
        await symlink(
            path.join(f.root, 'missing'),
            path.join(f.root, 'docs'),
            process.platform === 'win32' ? 'junction' : 'dir',
        );
        assert.equal((await installed.run(operation, context)).status, 20);
    } finally {
        await installed.dispose();
        await f.dispose();
    }
});

test('review M2 exported safe runner rejects symbolic-ref writing/deleting forms before subprocess launch', async () => {
    const f = await fixture();
    try {
        // Rejecting executable is the safe RED control: a launch produces a different error, without writing a Git ref.
        const control = new SafeGit(process.execPath, f.root);
        await assert.rejects(
            control.run('symbolic-ref', ['HEAD', 'refs/heads/changed']),
            /Unsupported read-only Git argv/,
        );
        const runner = new SafeGit(f.executable, f.root);
        const before = await f.snapshot();
        for (const args of [
            ['HEAD', 'refs/heads/changed'],
            ['--delete', 'HEAD'],
            ['-m', 'write', 'HEAD', 'refs/heads/changed'],
        ])
            await assert.rejects(runner.run('symbolic-ref', args), /Unsupported read-only Git argv/);
        assert.equal(await runner.text('symbolic-ref', ['--quiet', 'HEAD']), 'refs/heads/main');
        assert.deepEqual(await f.snapshot(), before);
    } finally {
        await f.dispose();
    }
});
