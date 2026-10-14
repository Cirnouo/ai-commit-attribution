import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { realpath } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { resolveTrustedGit } from '../src/safe-git.ts';

const windows = { skip: process.platform !== 'win32' };
async function host() {
    const executable = await resolveTrustedGit([]);
    return { executable, root: path.dirname(path.dirname(path.dirname(executable))) };
}

test('Windows copied bootstrap environments preserve host root key case semantics', windows, async (t) => {
    const { executable, root } = await host();
    for (const key of [
        'ProgramFiles',
        'PROGRAMFILES',
        'pRoGrAmFiLeS',
        'ProgramFiles(x86)',
        'PROGRAMFILES(X86)',
        'pRoGrAmFiLeS(x86)',
    ])
        await t.test(key, async () => {
            const copied = { [key]: root };
            assert.equal(await resolveTrustedGit([], copied), executable);
        });
    assert.equal(await resolveTrustedGit([], { ProgramFiles: root, PROGRAMFILES: root }), executable);
});

test('Windows conflicting copied root keys fail closed without PATH or cwd fallback', windows, async (t) => {
    const { executable, root } = await host();
    const different = path.parse(root).root;
    for (const environment of [
        { ProgramFiles: root, PROGRAMFILES: different },
        { PROGRAMFILES: different, ProgramFiles: root },
        { 'ProgramFiles(x86)': root, 'PROGRAMFILES(X86)': different },
    ])
        await t.test(JSON.stringify(Object.keys(environment)), async () => {
            await assert.rejects(resolveTrustedGit([], environment), /conflict|ambiguous/i);
        });
    await assert.rejects(resolveTrustedGit([], { PATH: path.dirname(executable) }), /unavailable/);
    await assert.rejects(resolveTrustedGit([], { PROGRAMFILES: 'relative' }), /unavailable/);
    await assert.rejects(resolveTrustedGit([path.parse(root).root], { PROGRAMFILES: root }), /unavailable/);
});

async function bashTest(file: string, pattern: string) {
    const { executable } = await host();
    const shell = await realpath(path.join(path.dirname(path.dirname(executable)), 'bin/sh.exe'));
    const result = spawnSync(
        shell,
        [
            '-c',
            'exec "$1" --test --test-name-pattern="$2" "$3"',
            'trusted-git-environment-fixture',
            process.execPath,
            pattern,
            fileURLToPath(new URL(file, import.meta.url)),
        ],
        {
            cwd: fileURLToPath(new URL('..', import.meta.url)),
            env: Object.fromEntries(
                Object.entries(process.env).filter(([key]) => !/^NODE_(?:TEST_|OPTIONS$|PATH$)/i.test(key)),
            ),
            encoding: 'utf8',
            windowsHide: true,
        },
    );
    assert.equal(result.status, 0, result.stderr + result.stdout);
    assert.match(result.stdout, /pass 1/);
}

test(
    'actual Windows Git Bash child isolates hostile trailer config from copied host environment',
    windows,
    async () => {
        await bashTest(
            './message-attribution.test.ts',
            '^real isolated trailer parsing and insertion ignore hostile config',
        );
    },
);

test('actual Windows Git Bash child executes copied installed message commands', windows, async () => {
    await bashTest('./message-distribution.test.ts', '^installed render/validate execute actual default');
});
