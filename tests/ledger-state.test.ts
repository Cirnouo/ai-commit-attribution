import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import { existsSync, renameSync, writeFileSync } from 'node:fs';
import {
    cp,
    link,
    mkdir,
    mkdtemp,
    readdir,
    readFile,
    realpath,
    rename,
    rm,
    symlink,
    writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import { createLedger } from '../src/ledger.ts';
import { parseWorktreeState, STATE_BYTES } from '../src/ledger-contract.ts';
import { initializeState, readState, resolveLedgerContext, transactState } from '../src/ledger-store.ts';
import { gitEnvironment, resolveTrustedGit } from '../src/safe-git.ts';

async function fixture() {
    const directory = await realpath(await mkdtemp(path.join(os.tmpdir(), 'ledger-state-')));
    const repository = path.join(directory, 'repository');
    await mkdir(repository);
    const executable = await resolveTrustedGit([directory]);
    const git = (args: string[], cwd = repository) =>
        execFileSync(executable, args, {
            cwd,
            env: gitEnvironment(),
            encoding: 'utf8',
            windowsHide: true,
        }).trim();
    git(['init', '--quiet', '--initial-branch=main']);
    const context = await resolveLedgerContext(repository);
    const dispose = async () => {
        assert.equal(path.dirname(directory), await realpath(os.tmpdir()));
        await rm(directory, { recursive: true, force: true });
    };
    return { directory, repository, git, context, dispose };
}

test('Windows case aliases cannot force-stage the authoritative state namespace', {
    skip: process.platform !== 'win32',
}, async () => {
    const f = await fixture();
    try {
        await initializeState(f.context);
        const alias = path.join(f.repository, '.AI-COMMIT-ATTRIBUTION');
        await rename(f.context.stateDirectory, alias);
        f.git(['add', '-f', '--', '.AI-COMMIT-ATTRIBUTION/state.json']);
        assert.match(f.git(['ls-files', '--cached']), /\.AI-COMMIT-ATTRIBUTION\/state\.json/);
        await assert.rejects(readState(f.context), /tracked|staged/i);
        await assert.rejects(
            transactState(f.context, 0, () => {}),
            /tracked|staged/i,
        );
        const retained = JSON.parse(await readFile(path.join(alias, 'state.json'), 'utf8'));
        assert.equal(retained.stateVersion, 0);
    } finally {
        await f.dispose();
    }
});

test('initialization discovers actual scope, preserves exclude bytes and never modifies Git identity or index', async () => {
    const f = await fixture();
    try {
        const prefix = Buffer.from('# synthetic fixture\r\nexisting-entry');
        await writeFile(f.context.excludeFile, prefix);
        const config = await readFile(path.join(f.context.locator.commonGitDir, 'config'));
        const state = await initializeState(f.context);
        assert.equal(state.stateVersion, 0);
        assert.equal(state.current, null);
        assert.deepEqual(state.ledgers, []);
        assert.deepEqual(
            await readFile(f.context.excludeFile),
            Buffer.concat([prefix, Buffer.from('\r\n/.ai-commit-attribution/\r\n')]),
        );
        assert.deepEqual(await initializeState(f.context), state);
        assert.deepEqual(await readFile(path.join(f.context.locator.commonGitDir, 'config')), config);
        assert.equal(existsSync(path.join(f.context.locator.gitDirectory, 'index')), false);
        const child = path.join(f.repository, 'child');
        await mkdir(child);
        assert.deepEqual((await resolveLedgerContext(child)).locator, f.context.locator);
    } finally {
        await f.dispose();
    }
});

test('concurrent same-version transactions publish at most one complete state and reject stale versions', async () => {
    const f = await fixture();
    try {
        await initializeState(f.context);
        const results = await Promise.allSettled([
            transactState(f.context, 0, () => {}),
            transactState(f.context, 0, () => {}),
        ]);
        assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
        assert.equal((await readState(f.context)).stateVersion, 1);
        await assert.rejects(
            transactState(f.context, 0, () => {}),
            /version|changed/i,
        );
        const before = await readFile(f.context.stateFile);
        await assert.rejects(
            transactState(f.context, 1, (draft) => {
                draft.stateVersion = 7;
            }),
            /version/i,
        );
        assert.deepEqual(await readFile(f.context.stateFile), before);
    } finally {
        await f.dispose();
    }
});

test('linked worktrees initialize concurrently with separate contexts and one preserved shared exclude entry', async () => {
    const f = await fixture();
    try {
        f.git([
            '-c',
            'user.name=Synthetic Fixture',
            '-c',
            'user.email=fixture@example.invalid',
            'commit',
            '--quiet',
            '--allow-empty',
            '-m',
            'fixture',
        ]);
        const linked = path.join(f.directory, 'linked');
        f.git(['worktree', 'add', '--quiet', '-b', 'fixture-linked', linked]);
        const other = await resolveLedgerContext(linked);
        const [left, right] = await Promise.all([initializeState(f.context), initializeState(other)]);
        assert.notEqual(left.contextId, right.contextId);
        assert.notEqual(left.locator.gitDirectory, right.locator.gitDirectory);
        assert.equal(left.locator.commonGitDir, right.locator.commonGitDir);
        assert.equal((await readFile(f.context.excludeFile, 'utf8')).split('/.ai-commit-attribution/').length, 2);
        assert.equal((await readState(other)).stateVersion, 0);
    } finally {
        await f.dispose();
    }
});

test('unknown occupancy, effective ignore overrides and force-staged state never get overwritten', async () => {
    for (const conflict of ['unknown', 'override', 'tracked'] as const) {
        const f = await fixture();
        try {
            if (conflict === 'override')
                await writeFile(path.join(f.repository, '.gitignore'), '!/.ai-commit-attribution/\n');
            else {
                await mkdir(f.context.stateDirectory);
                await writeFile(
                    path.join(f.context.stateDirectory, conflict === 'tracked' ? 'state.json' : 'unknown'),
                    'preserve',
                );
                if (conflict === 'tracked') f.git(['add', '-f', '--', '.ai-commit-attribution/state.json']);
            }
            await assert.rejects(initializeState(f.context), /occup|ignore|track|state/i);
            if (conflict !== 'override')
                assert.equal(
                    await readFile(
                        path.join(f.context.stateDirectory, conflict === 'tracked' ? 'state.json' : 'unknown'),
                        'utf8',
                    ),
                    'preserve',
                );
            else assert.equal(existsSync(f.context.stateFile), false);
        } finally {
            await f.dispose();
        }
    }
});

test('missing state, clone copies, linked directories and hardlinked state fail closed', async () => {
    const f = await fixture();
    try {
        await assert.rejects(readState(f.context));
        assert.equal(existsSync(f.context.stateDirectory), false);
        await initializeState(f.context);
        const copy = path.join(f.directory, 'copy');
        await cp(f.repository, copy, { recursive: true });
        await assert.rejects(readState(await resolveLedgerContext(copy)), /locator|context/i);
        const alias = path.join(f.directory, 'state-alias');
        await link(f.context.stateFile, alias);
        await assert.rejects(readState(f.context), /link/i);
        await rm(alias);
        const linked = path.join(f.directory, 'linked-state');
        await mkdir(linked);
        await rm(f.context.stateDirectory, { recursive: true });
        await symlink(linked, f.context.stateDirectory, process.platform === 'win32' ? 'junction' : 'dir');
        await assert.rejects(initializeState(f.context), /link|physical/i);
    } finally {
        await f.dispose();
    }
});

test('residual locks are preserved, invalid UTF8 and oversized state never become authority', async () => {
    const f = await fixture();
    try {
        await initializeState(f.context);
        const lock = path.join(f.context.stateDirectory, 'state.lock');
        await writeFile(lock, 'unknown-owner');
        const before = await readFile(f.context.stateFile);
        await assert.rejects(
            transactState(f.context, 0, () => {}),
            /lock/i,
        );
        assert.equal(await readFile(lock, 'utf8'), 'unknown-owner');
        assert.deepEqual(await readFile(f.context.stateFile), before);
        await rm(lock);
        await writeFile(f.context.stateFile, Buffer.from([0xff]));
        await assert.rejects(readState(f.context), /UTF|JSON/i);
        await writeFile(f.context.stateFile, Buffer.alloc(STATE_BYTES + 1, 0x20));
        await assert.rejects(readState(f.context), /budget|limit|size/i);
    } finally {
        await f.dispose();
    }
});

test('state parser rejects dangling references, unknown receipts, case aliases and unsafe integer versions', async () => {
    const f = await fixture();
    try {
        const state = await initializeState(f.context);
        for (const invalid of [
            { ...state, stateVersion: Number.MAX_SAFE_INTEGER + 1 },
            { ...state, current: { ledgerId: '11111111-1111-1111-1111-111111111111', paused: false } },
            { ...state, contextId: state.contextId.toUpperCase() },
            { ...state, preparations: [{}] },
            { ...state, transfers: [{}] },
            { ...state, imports: [{}] },
            { ...state, surprise: true },
        ])
            assert.throws(() => parseWorktreeState(invalid));
    } finally {
        await f.dispose();
    }
});

test('short writes complete; replacement failure retains complete candidate and original authority', async () => {
    const f = await fixture();
    try {
        await initializeState(f.context);
        const state = await transactState(
            f.context,
            0,
            (draft) => {
                createLedger(draft);
            },
            {
                write: async (handle, bytes, offset) =>
                    (await handle.write(bytes, offset, Math.min(7, bytes.length - offset), offset)).bytesWritten,
            },
        );
        assert.equal(state.ledgers.length, 1);
        const before = await readFile(f.context.stateFile);
        await assert.rejects(
            transactState(f.context, 1, () => {}, {
                rename: async () => {
                    throw new Error('synthetic replacement failure');
                },
            }),
            /replacement failure/,
        );
        assert.deepEqual(await readFile(f.context.stateFile), before);
        assert.equal((await readState(f.context)).stateVersion, 1);
        const candidates = (await readdir(f.context.stateDirectory)).filter((name) =>
            name.startsWith('state.candidate-'),
        );
        assert.equal(candidates.length, 1);
        assert.equal(
            JSON.parse(await readFile(path.join(f.context.stateDirectory, candidates[0] ?? ''), 'utf8')).stateVersion,
            2,
        );
    } finally {
        await f.dispose();
    }
});

test('same-version byte changes and replaced lock owners fail without deleting unknown artifacts', async () => {
    const f = await fixture();
    try {
        await initializeState(f.context);
        const before = await readFile(f.context.stateFile);
        await assert.rejects(
            transactState(f.context, 0, () => {
                writeFileSync(f.context.stateFile, Buffer.concat([before, Buffer.from(' ')]));
            }),
            /changed/i,
        );
        assert.deepEqual(await readFile(f.context.stateFile), Buffer.concat([before, Buffer.from(' ')]));
        const lock = path.join(f.context.stateDirectory, 'state.lock');
        await assert.rejects(
            transactState(f.context, 0, () => {
                renameSync(lock, path.join(f.directory, 'old-lock'));
                writeFileSync(lock, 'unknown replacement');
            }),
            /lock|budget/i,
        );
        assert.equal(await readFile(lock, 'utf8'), 'unknown replacement');
        assert.equal((await readState(f.context)).stateVersion, 0);
    } finally {
        await f.dispose();
    }
});

test('16MiB state read is independent from input limit and oversized publication preserves authority', async () => {
    const f = await fixture();
    try {
        const state = await initializeState(f.context);
        const initial = Buffer.from(JSON.stringify(state));
        await writeFile(
            f.context.stateFile,
            Buffer.concat([initial, Buffer.alloc(STATE_BYTES - initial.length, 0x20)]),
        );
        assert.equal((await readState(f.context)).stateVersion, 0);
        const before = await readFile(f.context.stateFile);
        await assert.rejects(
            transactState(f.context, 0, (draft) => {
                createLedger(draft, { note: '字'.repeat(Math.ceil(STATE_BYTES / 3)) });
            }),
            /budget/i,
        );
        assert.deepEqual(await readFile(f.context.stateFile), before);
    } finally {
        await f.dispose();
    }
});

test('transactions cannot silently delete ledgers or bypass content revisions', async () => {
    const f = await fixture();
    try {
        await initializeState(f.context);
        await transactState(f.context, 0, (draft) => {
            createLedger(draft, { select: true });
        });
        for (const transform of [
            (draft: Awaited<ReturnType<typeof readState>>) => {
                draft.ledgers = [];
                draft.current = null;
            },
            (draft: Awaited<ReturnType<typeof readState>>) => {
                const ledger = draft.ledgers[0];
                if (ledger) ledger.identities = [{ agent: 'Synthetic Agent', model: 'formal-model' }];
            },
        ])
            await assert.rejects(transactState(f.context, 1, transform), /delete|revision/i);
        assert.equal((await readState(f.context)).stateVersion, 1);
    } finally {
        await f.dispose();
    }
});

test('independent processes compete on one version without overwriting each other', async () => {
    const f = await fixture();
    try {
        await initializeState(f.context);
        const script = `import {resolveLedgerContext,transactState} from ${JSON.stringify(new URL('../src/ledger-store.ts', import.meta.url).href)};
            const context=await resolveLedgerContext(process.argv[1]);
            try { await transactState(context,0,()=>{}); console.log('published'); }
            catch { console.log('rejected'); }`;
        const invoke = () =>
            promisify(execFile)(process.execPath, ['--input-type=module', '-e', script, f.repository], {
                windowsHide: true,
            });
        const results = await Promise.all([invoke(), invoke()]);
        assert.deepEqual(results.map((result) => result.stdout.trim()).sort(), ['published', 'rejected']);
        assert.equal((await readState(f.context)).stateVersion, 1);
    } finally {
        await f.dispose();
    }
});

test('interrupted write preserves partial candidate; uncertain post-rename failure requires status recovery', async () => {
    const f = await fixture();
    try {
        await initializeState(f.context);
        const before = await readFile(f.context.stateFile);
        await assert.rejects(
            transactState(f.context, 0, () => {}, { write: async () => 0 }),
            /progress/i,
        );
        assert.deepEqual(await readFile(f.context.stateFile), before);
        const candidates = (await readdir(f.context.stateDirectory)).filter((name) =>
            name.startsWith('state.candidate-'),
        );
        assert.equal(candidates.length, 1);
        assert.equal((await readFile(path.join(f.context.stateDirectory, candidates[0] ?? ''))).length, 0);
        await assert.rejects(
            transactState(f.context, 0, () => {}, {
                rename: async (source, destination) => {
                    await rename(source, destination);
                    throw new Error('synthetic post-rename interruption');
                },
            }),
            /post-rename interruption/,
        );
        assert.equal((await readState(f.context)).stateVersion, 1);
        await assert.rejects(
            transactState(f.context, 0, () => {}),
            /version/i,
        );
    } finally {
        await f.dispose();
    }
});

test('note-only edits bump state version without content revision; unknown context transforms fail', async () => {
    const f = await fixture();
    try {
        await initializeState(f.context);
        await transactState(f.context, 0, (draft) => {
            createLedger(draft, { note: 'first', work: 'review' });
        });
        const next = await transactState(f.context, 1, (draft) => {
            const ledger = draft.ledgers[0];
            if (ledger) ledger.note = 'second';
        });
        assert.equal(next.stateVersion, 2);
        assert.equal(next.ledgers[0]?.revision, 1);
        assert.equal(next.ledgers[0]?.note, 'second');
        await assert.rejects(
            transactState(f.context, 2, (draft) => {
                draft.contextId = '11111111-1111-1111-1111-111111111111';
            }),
            /context/i,
        );
        await assert.rejects(
            transactState(f.context, 2, async () => {}),
            /synchronous/i,
        );
    } finally {
        await f.dispose();
    }
});

test('ledger CLI requires exact versions and strict flags, then returns recoverable selected IDs', async () => {
    const { runLedger } = await import('../src/ledger-cli.ts');
    const f = await fixture();
    try {
        const args = ['--worktree', f.repository];
        assert.equal((await runLedger(['init', ...args])).stateVersion, 0);
        for (const command of [
            'create',
            'select',
            'add',
            'remove',
            'block',
            'unblock',
            'pause',
            'resume',
            'reopen',
            'abandon',
            'split',
            'combine',
        ]) {
            await assert.rejects(runLedger([command, ...args]), /version/i);
        }
        await assert.rejects(runLedger(['status', ...args, '--expect-version', '0']), /flag/i);
        await assert.rejects(
            runLedger(['create', ...args, '--expect-version', '0', '--expect-version', '0']),
            /duplicate|flag/i,
        );
        const state = await runLedger(['create', ...args, '--expect-version', '0', '--select']);
        assert.ok('ledgers' in state);
        assert.equal(state.stateVersion, 1);
        assert.equal(state.current?.ledgerId, state.ledgers[0]?.ledgerId);
        const id = state.ledgers[0]?.ledgerId;
        assert.ok(id);
        const input = path.join(f.directory, 'identities.json');
        await writeFile(input, JSON.stringify({ identities: [{ agent: 'Alias', model: 'formal-model' }] }));
        const registry = {
            schemaVersion: 1 as const,
            hosts: [{ name: 'Synthetic Agent', aliases: ['Alias'], family: 'fixture' }],
            ambiguousAliases: [],
            familyAliases: {},
        };
        const added = await runLedger(
            ['add', ...args, '--expect-version', '1', '--ledger', id, '--input', input],
            async () => registry,
        );
        assert.ok('ledgers' in added);
        assert.deepEqual(added.ledgers[0]?.identities, [{ agent: 'Synthetic Agent', model: 'formal-model' }]);
        assert.equal((await runLedger(['status', ...args])).stateVersion, 2);
    } finally {
        await f.dispose();
    }
});

test('CLI basic lifecycle and explicit split/combine retain all source records', async () => {
    const { runLedger } = await import('../src/ledger-cli.ts');
    const f = await fixture();
    try {
        const registry = {
            schemaVersion: 1 as const,
            hosts: [{ name: 'Synthetic Agent', aliases: ['Alias'], family: 'fixture' }],
            ambiguousAliases: [],
            familyAliases: {},
        };
        await initializeState(f.context);
        let version = 0;
        const command = async (name: string, ...args: string[]) => {
            const state = await runLedger(
                [name, '--worktree', f.repository, '--expect-version', String(version), ...args],
                async () => registry,
            );
            version = state.stateVersion;
            assert.ok('ledgers' in state);
            return state;
        };
        const first = '11111111-1111-1111-1111-111111111111';
        const second = '22222222-2222-2222-2222-222222222222';
        const third = '33333333-3333-3333-3333-333333333333';
        const fourth = '44444444-4444-4444-4444-444444444444';
        await command('create', '--ledger', first, '--select', '--note', 'Plan', '--work', 'implementation');
        const input = path.join(f.directory, 'input.json');
        await writeFile(input, JSON.stringify({ identities: [{ agent: 'Alias', model: 'model-a' }] }));
        await command('add', '--ledger', first, '--input', input);
        await command('remove', '--ledger', first, '--input', input);
        await writeFile(input, JSON.stringify({ id: 'required-gap', reason: 'Confirm model' }));
        await command('block', '--ledger', first, '--input', input);
        await command('unblock', '--ledger', first, '--blocker', 'required-gap');
        await command('pause', '--ledger', first);
        await command('resume', '--ledger', first);
        await command('abandon', '--ledger', first);
        await command('reopen', '--ledger', first);
        await command('select', '--ledger', first);
        await writeFile(
            input,
            JSON.stringify({
                sourceIds: [first],
                outputs: [
                    {
                        ledgerId: second,
                        identities: [{ agent: 'Alias', model: 'model-a' }],
                        blockers: [],
                        note: 'AB',
                        work: 'review',
                    },
                    {
                        ledgerId: third,
                        identities: [{ agent: 'Alias', model: 'model-a' }],
                        blockers: [{ id: 'gap', reason: 'Confirm model' }],
                    },
                ],
            }),
        );
        const split = await command('split', '--input', input);
        assert.equal(split.current, null);
        assert.equal(split.ledgers.length, 3);
        assert.equal(split.ledgers[1]?.note, 'AB');
        await writeFile(
            input,
            JSON.stringify({
                sourceIds: [second, third],
                outputs: [{ ledgerId: fourth, identities: [{ agent: 'Alias', model: 'model-a' }], blockers: [] }],
            }),
        );
        const combined = await command('combine', '--input', input);
        assert.deepEqual(
            combined.ledgers.map((ledger) => ledger.state),
            ['abandoned', 'abandoned', 'abandoned', 'open'],
        );
        assert.deepEqual(combined.ledgers[3]?.predecessorIds, [second, third]);
        assert.equal(combined.ledgers[3]?.revision, 1);
    } finally {
        await f.dispose();
    }
});
