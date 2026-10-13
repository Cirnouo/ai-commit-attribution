import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { readLockInventory } from '../tooling/security/audit-policy.ts';

test('installer evidence rejects changed original notices and bundled bytes without executing CLI', async () => {
    assert.ok(
        existsSync(new URL('../tooling/security/installer-evidence.ts', import.meta.url)),
        'installer evidence verifier must exist',
    );
    const { verifyInstallerEvidence } = await import('../tooling/security/installer-evidence.ts');
    const root = fileURLToPath(new URL('../', import.meta.url));
    const inventory = readLockInventory(await readFile(path.join(root, 'pnpm-lock.yaml'), 'utf8'));
    const temporary = await mkdtemp(path.join(os.tmpdir(), 'attribution-installer-'));
    try {
        await cp(path.join(root, 'node_modules/skills'), path.join(temporary, 'skills'), {
            recursive: true,
            dereference: true,
            filter: (name) =>
                !path.relative(path.join(root, 'node_modules/skills'), name).split(path.sep).includes('node_modules'),
        });
        const evidence = JSON.parse(
            await readFile(path.join(root, 'tooling/security/installer-evidence.json'), 'utf8'),
        ) as unknown;
        await verifyInstallerEvidence(path.join(temporary, 'skills'), inventory, evidence);
        const notice = path.join(temporary, 'skills/ThirdPartyNoticeText.txt');
        await writeFile(notice, 'fabricated notices\n');
        await assert.rejects(
            verifyInstallerEvidence(path.join(temporary, 'skills'), inventory, evidence),
            /digest|fingerprint|bytes/,
        );
    } finally {
        assert.equal(path.dirname(path.resolve(temporary)), path.resolve(os.tmpdir()));
        await rm(temporary, { recursive: true, force: true });
    }
});
