import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

test('pre-push verification clears repository routing before creating independent Git fixtures', async () => {
    const folder = await mkdtemp(path.join(os.tmpdir(), 'attribution-hook-isolation-'));
    const cleanEnvironment = Object.fromEntries(
        Object.entries(process.env).filter(([name]) => !name.toUpperCase().startsWith('GIT_')),
    );
    const git = (args: string[], cwd = folder) =>
        execFileSync('git', args, { cwd, encoding: 'utf8', windowsHide: true, env: cleanEnvironment }).trim();
    try {
        const sentinel = path.join(folder, 'sentinel');
        git(['init', '--quiet', sentinel]);
        const sentinelGit = path.join(sentinel, '.git');
        const before = await readFile(path.join(sentinelGit, 'config'), 'utf8');
        const bin = path.join(folder, 'bin');
        await mkdir(bin);
        const pnpm = path.join(bin, 'pnpm');
        await writeFile(pnpm, '#!/bin/sh\nnode "$ATTRIBUTION_TEST_HOOK_PROBE" "$@"\n', 'utf8');
        await chmod(pnpm, 0o755);
        const probe = path.join(folder, 'probe.ts');
        await writeFile(
            probe,
            `
            import assert from 'node:assert/strict';
            import { execFileSync } from 'node:child_process';
            assert.deepEqual(process.argv.slice(2), ['verify:push']);
            const local = execFileSync('git', ['rev-parse', '--local-env-vars'], { encoding: 'utf8' }).trim().split(/\\s+/);
            for (const name of local) assert.equal(process.env[name], undefined, name + ' must not route nested fixtures');
            execFileSync('git', ['init', '--quiet', '--bare', process.env.ATTRIBUTION_TEST_BARE_FIXTURE], { windowsHide: true });
            console.log('independent verification fixture passed');
        `,
            'utf8',
        );
        const execPath = git(['--exec-path']);
        const shell = process.platform === 'win32' ? path.resolve(execPath, '../../..', 'usr/bin/sh.exe') : 'sh';
        const result = spawnSync(shell, ['-e', fileURLToPath(new URL('../.husky/pre-push', import.meta.url))], {
            cwd: folder,
            encoding: 'utf8',
            windowsHide: true,
            env: {
                ...cleanEnvironment,
                PATH: bin + path.delimiter + (cleanEnvironment.PATH ?? cleanEnvironment.Path ?? ''),
                GIT_DIR: sentinelGit,
                GIT_WORK_TREE: sentinel,
                GIT_INDEX_FILE: path.join(sentinelGit, 'index'),
                GIT_COMMON_DIR: sentinelGit,
                ATTRIBUTION_TEST_HOOK_PROBE: probe,
                ATTRIBUTION_TEST_BARE_FIXTURE: path.join(folder, 'bare-fixture'),
            },
        });
        assert.equal(result.status, 0, result.stdout + result.stderr);
        assert.match(result.stdout, /independent verification fixture passed/);
        assert.equal(await readFile(path.join(sentinelGit, 'config'), 'utf8'), before);
        assert.equal(git(['--git-dir', path.join(folder, 'bare-fixture'), 'config', 'core.bare']), 'true');
    } finally {
        assert.equal(path.dirname(path.resolve(folder)), path.resolve(os.tmpdir()));
        assert.ok(path.basename(folder).startsWith('attribution-hook-isolation-'));
        await rm(folder, { recursive: true, force: true });
    }
});

test('pre-commit batches every staged file below the launcher capacity while preserving default protection', async () => {
    const folder = await realpath(await mkdtemp(path.join(os.tmpdir(), 'attribution-hook-batching-')));
    const cleanEnvironment = Object.fromEntries(
        Object.entries(process.env).filter(([name]) => !name.toUpperCase().startsWith('GIT_')),
    );
    const git = (args: string[]) =>
        execFileSync('git', args, {
            cwd: folder,
            encoding: 'utf8',
            windowsHide: true,
            env: cleanEnvironment,
        });
    try {
        git(['init', '--quiet']);
        git(['config', 'core.autocrlf', 'false']);
        git([
            '-c',
            'user.name=Fixture',
            '-c',
            'user.email=fixture@example.invalid',
            'commit',
            '--quiet',
            '--allow-empty',
            '-m',
            'fixture',
        ]);
        const bin = path.join(folder, 'bin');
        await mkdir(bin);
        const cli = fileURLToPath(new URL('../node_modules/lint-staged/bin/lint-staged.js', import.meta.url));
        const pnpm = path.join(bin, 'pnpm');
        await writeFile(pnpm, '#!/bin/sh\nshift\nshift\nnode "$ATTRIBUTION_TEST_LINT_STAGED" "$@"\n');
        await chmod(pnpm, 0o755);
        const probe = path.join(folder, 'probe.ts');
        await writeFile(
            probe,
            `
            import { appendFileSync } from 'node:fs';
            const files = process.argv.slice(2);
            if (files.map(file => JSON.stringify(file)).join(' ').length > 6000) {
                throw new Error('launcher command capacity exceeded');
            }
            appendFileSync(process.env.ATTRIBUTION_TEST_BATCH_LOG, JSON.stringify(files) + '\\n');
        `,
        );
        await writeFile(
            path.join(folder, 'package.json'),
            JSON.stringify({
                type: 'module',
                'lint-staged': { '*.ts': 'node probe.ts' },
            }),
        );
        const files: string[] = [];
        for (let index = 0; index < 45; index++) {
            const file = `staged-${String(index).padStart(3, '0')}-${'x'.repeat(95)}.ts`;
            files.push(path.join(folder, file));
            await writeFile(path.join(folder, file), 'export {};\n');
        }
        git(['add', '--', ...files]);
        const partiallyStaged = files[0];
        assert.ok(partiallyStaged);
        await writeFile(partiallyStaged, 'export {};\n// preserve unstaged work\n');
        const shell =
            process.platform === 'win32'
                ? path.resolve(git(['--exec-path']).trim(), '../../..', 'usr/bin/sh.exe')
                : 'sh';
        const log = path.join(folder, 'batches.jsonl');
        const result = spawnSync(shell, ['-e', fileURLToPath(new URL('../.husky/pre-commit', import.meta.url))], {
            cwd: folder,
            encoding: 'utf8',
            windowsHide: true,
            timeout: 60_000,
            env: {
                ...cleanEnvironment,
                PATH: bin + path.delimiter + (cleanEnvironment.PATH ?? cleanEnvironment.Path ?? ''),
                ATTRIBUTION_TEST_LINT_STAGED: cli,
                ATTRIBUTION_TEST_BATCH_LOG: log,
            },
        });
        assert.equal(result.status, 0, result.stdout + result.stderr);
        const batches: unknown[] = (await readFile(log, 'utf8'))
            .trim()
            .split('\n')
            .map((line) => JSON.parse(line));
        const checked: string[] = [];
        for (const batch of batches) {
            assert.ok(Array.isArray(batch) && batch.every((file) => typeof file === 'string'));
            checked.push(...batch.map((file) => path.resolve(file)));
        }
        assert.deepEqual(checked.sort(), files.sort());
        assert.equal(await readFile(partiallyStaged, 'utf8'), 'export {};\n// preserve unstaged work\n');
        assert.equal(git(['show', `:${path.basename(partiallyStaged)}`]), 'export {};\n');
        assert.equal(git(['diff', '--cached', '--name-only']).trim().split('\n').length, files.length);
    } finally {
        assert.ok(path.basename(folder).startsWith('attribution-hook-batching-'));
        await rm(folder, { recursive: true, force: true });
    }
});

test('real Git commit and local push invoke generated Husky hooks and protect partial staging', async () => {
    const root = fileURLToPath(new URL('../', import.meta.url));
    const directory = await realpath(await mkdtemp(path.join(os.tmpdir(), 'attribution-real-hooks-')));
    const environment = Object.fromEntries(
        Object.entries(process.env).filter(([name]) => !name.toUpperCase().startsWith('GIT_')),
    );
    const git = (args: string[]) =>
        spawnSync('git', args, { cwd: directory, encoding: 'utf8', windowsHide: true, env: environment });
    const check = (result: ReturnType<typeof git>) => assert.equal(result.status, 0, result.stdout + result.stderr);
    try {
        check(git(['init', '--quiet', '--initial-branch=main']));
        check(git(['config', 'core.autocrlf', 'false']));
        check(
            git([
                '-c',
                'user.name=Fixture',
                '-c',
                'user.email=fixture@example.invalid',
                'commit',
                '--quiet',
                '--allow-empty',
                '-m',
                'fixture',
            ]),
        );
        await mkdir(path.join(directory, '.husky'));
        for (const name of ['pre-commit', 'commit-msg', 'pre-push'])
            await writeFile(path.join(directory, '.husky', name), await readFile(path.join(root, '.husky', name)));
        const installed = spawnSync(process.execPath, [path.join(root, 'node_modules/husky/bin.js')], {
            cwd: directory,
            encoding: 'utf8',
            windowsHide: true,
            env: environment,
        });
        check(installed);
        assert.equal(git(['config', '--get', 'core.hooksPath']).stdout.trim(), '.husky/_');
        await mkdir(path.join(directory, 'tooling'));
        await writeFile(
            path.join(directory, 'tooling/check-commit-message.ts'),
            `await import(${JSON.stringify(new URL('../tooling/check-commit-message.ts', import.meta.url).href)});\n`,
        );
        await writeFile(
            path.join(directory, 'package.json'),
            JSON.stringify({
                type: 'module',
                'lint-staged': { '*.{md,yaml,yml}': `node "${path.join(root, 'tooling/check-text-style.ts')}"` },
            }),
        );
        const bin = path.join(directory, 'bin');
        await mkdir(bin);
        const proxy = path.join(bin, 'pnpm');
        await writeFile(proxy, '#!/bin/sh\nnode "$ATTRIBUTION_TEST_PROXY" "$@"\n');
        await chmod(proxy, 0o755);
        const proxyModule = path.join(directory, 'proxy.ts');
        await writeFile(
            proxyModule,
            `import assert from 'node:assert/strict';\nimport {spawnSync,execFileSync} from 'node:child_process';\nimport {appendFileSync} from 'node:fs';\nconst args=process.argv.slice(2);\nif(args[0]==='exec'){const result=spawnSync(process.execPath,[process.env.ATTRIBUTION_TEST_STAGED,...args.slice(2)],{stdio:'inherit',windowsHide:true});process.exit(result.status??1);}\nassert.deepEqual(args,['verify:push']);\nfor(const name of execFileSync('git',['rev-parse','--local-env-vars'],{encoding:'utf8'}).trim().split(/\\s+/))assert.equal(process.env[name],undefined,name);\nappendFileSync(process.env.ATTRIBUTION_TEST_HOOK_LOG,'pre-push invoked\\n');\n`,
        );
        Object.assign(environment, {
            PATH: bin + path.delimiter + (environment.PATH ?? environment.Path ?? ''),
            ATTRIBUTION_TEST_PROXY: proxyModule,
            ATTRIBUTION_TEST_STAGED: path.join(root, 'node_modules/lint-staged/bin/lint-staged.js'),
            ATTRIBUTION_TEST_HOOK_LOG: path.join(directory, 'hook-log.txt'),
        });
        const selected = path.join(directory, 'partial.md');
        await writeFile(selected, 'Staged text.\n');
        check(git(['add', 'partial.md']));
        await writeFile(selected, 'Staged text.\nUnstaged text.\n');
        const invalid = git([
            '-c',
            'user.name=Fixture',
            '-c',
            'user.email=fixture@example.invalid',
            'commit',
            '--quiet',
            '-m',
            'invalid message',
        ]);
        assert.equal(invalid.status, 1, invalid.stdout + invalid.stderr);
        assert.equal(git(['show', ':partial.md']).stdout, 'Staged text.\n');
        assert.equal(await readFile(selected, 'utf8'), 'Staged text.\nUnstaged text.\n');
        check(
            git([
                '-c',
                'user.name=Fixture',
                '-c',
                'user.email=fixture@example.invalid',
                'commit',
                '--quiet',
                '-m',
                'test(governance): verify real hooks',
            ]),
        );
        assert.equal(git(['show', 'HEAD:partial.md']).stdout, 'Staged text.\n');
        assert.equal(await readFile(selected, 'utf8'), 'Staged text.\nUnstaged text.\n');
        await writeFile(path.join(directory, 'invalid.yml'), 'value: true\n');
        check(git(['add', 'invalid.yml']));
        const yaml = git([
            '-c',
            'user.name=Fixture',
            '-c',
            'user.email=fixture@example.invalid',
            'commit',
            '--quiet',
            '-m',
            'test(governance): reject invalid yaml',
        ]);
        assert.equal(yaml.status, 1, yaml.stdout + yaml.stderr);
        assert.match(yaml.stdout + yaml.stderr, /\.yaml/);
        check(git(['reset', '--quiet', 'HEAD', 'invalid.yml']));
        check(git(['init', '--quiet', '--bare', path.join(directory, 'remote.git')]));
        check(git(['push', '--quiet', path.join(directory, 'remote.git'), 'HEAD:refs/heads/main']));
        assert.equal(await readFile(path.join(directory, 'hook-log.txt'), 'utf8'), 'pre-push invoked\n');
    } finally {
        assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
        await rm(directory, { recursive: true, force: true });
    }
});
