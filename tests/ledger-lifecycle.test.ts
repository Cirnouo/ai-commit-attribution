import assert from 'node:assert/strict';
import test from 'node:test';
import {
    abandonLedger,
    addIdentities,
    blockLedger,
    createLedger,
    pauseLedger,
    removeIdentities,
    reopenLedger,
    replaceLedgers,
    resumeLedger,
    selectedLedgerSnapshot,
    selectLedger,
    unblockLedger,
} from '../src/ledger.ts';
import type { WorktreeState } from '../src/ledger-contract.ts';
import type { Operation, Registry } from '../src/records.ts';

const contextId = '11111111-1111-1111-1111-111111111111';
const first = '22222222-2222-2222-2222-222222222222';
const second = '33333333-3333-3333-3333-333333333333';
const third = '44444444-4444-4444-4444-444444444444';
const registry: Registry = {
    schemaVersion: 1,
    hosts: [{ name: 'Synthetic Agent', aliases: ['Alias'], family: 'fixture' }],
    ambiguousAliases: [],
    familyAliases: {},
};
const a = { agent: 'Alias', model: 'model-a' };
const b = { agent: 'Synthetic Agent', model: 'model-b', reasoning: 'none' };
const c = { agent: 'Synthetic Agent', model: 'model-c' };
function fixture(): WorktreeState {
    return {
        schemaVersion: 1,
        contextId,
        locator: { worktree: '/fixture/worktree', gitDirectory: '/fixture/git', commonGitDir: '/fixture/common' },
        stateVersion: 0,
        current: null,
        ledgers: [],
        preparations: [],
        transfers: [],
        imports: [],
    };
}
const operation: Operation = {
    schemaVersion: 1,
    id: 'action-one',
    repository: '/fixture/worktree',
    worktree: '/fixture/worktree',
    commonGitDir: '/fixture/common',
    kind: 'commit',
    paths: [],
    targets: [],
};

test('creation is independent from operation; tuple recording canonicalizes and never clears blockers', () => {
    const state = fixture();
    createLedger(state, { ledgerId: first, select: true });
    blockLedger(state, first, { id: 'required-gap', reason: 'Confirm actual model' });
    addIdentities(state, first, [a, a, { ...a, reasoning: 'none' }, b], registry);
    assert.deepEqual(state.ledgers[0]?.identities, [
        { agent: 'Synthetic Agent', model: 'model-a' },
        { agent: 'Synthetic Agent', model: 'model-a', reasoning: 'none' },
        b,
    ]);
    assert.equal(state.ledgers[0]?.blockers.length, 1);
    removeIdentities(state, first, [a], registry);
    assert.deepEqual(state.ledgers[0]?.identities, [
        { agent: 'Synthetic Agent', model: 'model-a', reasoning: 'none' },
        b,
    ]);
    unblockLedger(state, first, 'required-gap');
    assert.deepEqual(state.ledgers[0]?.blockers, []);
    assert.equal(state.ledgers[0]?.revision, 5);
});

test('pause retains ID, resume requires exact ID, explicit inspection works and late children cannot redirect', () => {
    const state = fixture();
    assert.throws(() => selectedLedgerSnapshot(state, operation, undefined, true), /current/i);
    createLedger(state, { ledgerId: first, select: true });
    pauseLedger(state, first);
    assert.deepEqual(state.current, { ledgerId: first, paused: true });
    assert.throws(() => selectedLedgerSnapshot(state, operation, undefined, true), /paused/i);
    assert.equal(selectedLedgerSnapshot(state, operation, first).ledgerId, first);
    assert.throws(() => resumeLedger(state, second), /current|select/i);
    createLedger(state, { ledgerId: second, select: true });
    assert.throws(() => addIdentities(state, first, [a], registry), /current|select/i);
    assert.throws(() => selectedLedgerSnapshot(state, operation, first, true), /current|select/i);
    assert.equal(state.ledgers[0]?.revision, 1);
    selectLedger(state, first);
    assert.deepEqual(state.current, { ledgerId: first, paused: false });
    assert.throws(
        () => selectedLedgerSnapshot(state, { ...operation, commonGitDir: '/other' }, first),
        /scope|context/i,
    );
});

test('split explicitly preserves AB and AC overlap; abandoning one successor never changes the other', () => {
    const state = fixture();
    createLedger(state, { ledgerId: first, select: true });
    addIdentities(state, first, [a, b, c], registry);
    replaceLedgers(
        state,
        [first],
        [
            { ledgerId: second, identities: [a, b, a], blockers: [] },
            { ledgerId: third, identities: [a, c], blockers: [{ id: 'gap', reason: 'Confirm source' }] },
        ],
        registry,
    );
    assert.equal(state.ledgers[0]?.state, 'abandoned');
    assert.deepEqual(state.ledgers[0]?.successorIds, [second, third]);
    assert.deepEqual(
        state.ledgers[1]?.identities.map((item) => item.model),
        ['model-a', 'model-b'],
    );
    assert.deepEqual(
        state.ledgers[2]?.identities.map((item) => item.model),
        ['model-a', 'model-c'],
    );
    const untouched = structuredClone(state.ledgers[2]);
    abandonLedger(state, second);
    assert.deepEqual(state.ledgers[2], untouched);
});

test('terminal and exported ledgers cannot thaw; prepared reopen needs reviewed no-result declaration', () => {
    const state = fixture();
    createLedger(state, { ledgerId: first, select: true });
    const ledger = state.ledgers[0];
    assert.ok(ledger);
    ledger.state = 'prepared';
    assert.throws(() => reopenLedger(state, first, { reviewedNoResult: false }), /review|result/i);
    reopenLedger(state, first, { reviewedNoResult: true });
    assert.equal(ledger.state, 'open');
    ledger.ownership = { kind: 'exported', transferId: second };
    assert.throws(() => addIdentities(state, first, [a], registry), /ownership|local/i);
    assert.throws(() => reopenLedger(state, first, { reviewedNoResult: true }), /ownership|local/i);
    ledger.ownership = { kind: 'local' };
    ledger.state = 'sealed';
    assert.throws(() => reopenLedger(state, first, { reviewedNoResult: true }), /sealed/i);
    assert.throws(() => abandonLedger(state, first), /sealed/i);
});
