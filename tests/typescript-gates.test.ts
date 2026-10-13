import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

test('native TypeScript executes from any cwd while the independent compiler rejects type errors', async () => {
    const root = fileURLToPath(new URL('../', import.meta.url));
    const temporary = await mkdtemp(path.join(os.tmpdir(), 'dct-typescript-'));
    try {
        const fixture = path.join(temporary, 'fixture.ts');
        const config = path.join(temporary, 'tsconfig.json');
        await writeFile(
            config,
            JSON.stringify({
                extends: path.join(root, 'tsconfig.json'),
                compilerOptions: { typeRoots: [path.join(root, 'node_modules/@types')] },
                include: [fixture],
            }),
        );
        await writeFile(fixture, 'const value: number = 42; console.log(value);\n');
        const native = spawnSync(process.execPath, [fixture], {
            cwd: os.tmpdir(),
            encoding: 'utf8',
            windowsHide: true,
            shell: false,
        });
        assert.equal(native.status, 0, native.stderr);
        assert.equal(native.stdout.trim(), '42');
        const compiler = (source: string) =>
            spawnSync(process.execPath, [path.join(root, 'node_modules/typescript/bin/tsc'), '--project', source], {
                cwd: os.tmpdir(),
                encoding: 'utf8',
                windowsHide: true,
                shell: false,
            });
        const valid = compiler(config);
        assert.equal(valid.status, 0, valid.stdout + valid.stderr);
        await writeFile(fixture, 'const value: number = "not a number";\n');
        const invalid = compiler(config);
        assert.notEqual(invalid.status, 0);
        assert.match(invalid.stdout, /TS2322/);
        await writeFile(fixture, 'enum Unsupported { Value }\n');
        const transformed = compiler(config);
        assert.notEqual(transformed.status, 0);
        assert.match(transformed.stdout, /erasableSyntaxOnly/);
    } finally {
        await rm(temporary, { recursive: true });
    }
});
