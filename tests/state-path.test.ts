import assert from 'node:assert/strict';
import test from 'node:test';
import { isLedgerStatePath } from '../src/state-path.ts';

test('reserved state namespace matches platform aliases without claiming unrelated paths', () => {
    for (const name of [
        '.ai-commit-attribution/state.json',
        '.AI-COMMIT-ATTRIBUTION/state.json',
        '.ai-commit-attribution. /state.json',
        '.ai-commit-attribution:stream',
        'AI-COM~1/state.json',
        '.ai-com~22/state.json',
    ])
        assert.equal(isLedgerStatePath(Buffer.from(name), 'win32'), true, name);
    for (const name of [
        '.ai-commit-attribution-other/file',
        'dir/.ai-commit-attribution/state.json',
        'AI-COM~x/file',
        'ordinary',
        '',
    ])
        assert.equal(isLedgerStatePath(Buffer.from(name), 'win32'), false, name);
    for (const platform of ['linux', 'darwin'] as const) {
        assert.equal(isLedgerStatePath(Buffer.from('.ai-commit-attribution/state.json'), platform), true);
        assert.equal(
            isLedgerStatePath(Buffer.from('.AI-COMMIT-ATTRIBUTION/state.json'), platform),
            platform === 'darwin',
        );
        assert.equal(isLedgerStatePath(Buffer.from('AI-COM~1/state.json'), platform), false);
    }
});
