import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import commitlintConfig from '../commitlint.config.ts';
import { COMMIT_SCOPES, COMMIT_TYPES, validateBranchName, validateCommitMessage } from '../tooling/governance.ts';

const validScopes = [
    'governance',
    'policy',
    'identity',
    'attribution',
    'integration',
    'docs',
    'ci',
    'security',
    'release',
    'issues',
    'build',
];

test('commitlint configuration loads without unrelated Git or version validators', async () => {
    const directory = await realpath(await mkdtemp(path.join(os.tmpdir(), 'attribution-commit-config-')));
    try {
        await mkdir(path.join(directory, 'tooling'));
        await writeFile(path.join(directory, 'package.json'), '{"type":"module"}\n');
        await writeFile(
            path.join(directory, 'commitlint.config.ts'),
            await readFile(new URL('../commitlint.config.ts', import.meta.url)),
        );
        await writeFile(
            path.join(directory, 'tooling/commit-footer-rule.ts'),
            await readFile(new URL('../tooling/commit-footer-rule.ts', import.meta.url)),
        );
        // Controlled vocabulary proves the config consumes its data dependency without
        // importing Git validators or the root CLI. Production parity is checked below.
        await writeFile(
            path.join(directory, 'tooling/commit-vocabulary.ts'),
            "export const COMMIT_TYPES = Object.freeze(['feat']);\nexport const COMMIT_SCOPES = Object.freeze(['identity']);\n",
        );
        await symlink(
            fileURLToPath(new URL('../node_modules', import.meta.url)),
            path.join(directory, 'node_modules'),
            process.platform === 'win32' ? 'junction' : 'dir',
        );
        const require = createRequire(import.meta.url);
        const cli: unknown = require('@commitlint/cli');
        assert.equal(typeof cli, 'string');
        const run = (message: string) =>
            spawnSync(
                process.execPath,
                [
                    String(cli),
                    '--config',
                    path.join(directory, 'commitlint.config.ts'),
                    '--cwd',
                    directory,
                    '--color=false',
                ],
                { input: message, cwd: directory, encoding: 'utf8', windowsHide: true },
            );
        const valid = run('feat(identity): validate isolated config\n');
        assert.equal(valid.status, 0, valid.stdout + valid.stderr);
        const invalid = run('chore(governance): reject different vocabulary\n');
        assert.equal(invalid.status, 1, invalid.stdout + invalid.stderr);
        assert.match(invalid.stdout + invalid.stderr, /type-enum|scope-enum/);
        const footer = run('feat(identity): validate isolated config\n\nExplain.\nRefs: #2\n');
        assert.equal(footer.status, 1, footer.stdout + footer.stderr);
        assert.match(footer.stdout + footer.stderr, /footer|leading blank/);
    } finally {
        assert.equal(path.dirname(directory), await realpath(os.tmpdir()));
        assert.ok(path.basename(directory).startsWith('attribution-commit-config-'));
        await rm(directory, { recursive: true, force: true });
    }
});

test('wires every approved Conventional Commit type and scope into commitlint', () => {
    const types = ['build', 'chore', 'ci', 'docs', 'feat', 'fix', 'perf', 'refactor', 'revert', 'style', 'test'];

    assert.deepEqual(COMMIT_TYPES, types);
    assert.deepEqual(COMMIT_SCOPES, validScopes);
    assert.deepEqual(commitlintConfig.rules['type-enum'], [2, 'always', COMMIT_TYPES]);
    assert.deepEqual(commitlintConfig.rules['scope-enum'], [2, 'always', COMMIT_SCOPES]);
    assert.deepEqual(validateCommitMessage('feat(identity): describe change'), []);
});

test('accepts breaking commits by marker or footer', () => {
    assert.deepEqual(validateCommitMessage('feat(identity)!: change contract'), []);
    assert.deepEqual(
        validateCommitMessage('feat(identity): change contract\n\nBREAKING CHANGE: callers must migrate'),
        [],
    );
});

test('rejects malformed commit messages with actionable errors', () => {
    const invalid: [string, string][] = [
        ['feature(identity): add feature', 'type'],
        ['feat: add feature', 'scope'],
        ['feat(Identity): add feature', 'scope'],
        ['feat(not-approved): add feature', 'scope'],
        ['feat(identity): ', 'subject'],
        ['feat(identity): add feature.', 'full stop'],
        [`feat(identity): ${'x'.repeat(85)}`, '100'],
        ['feat(identity): add feature\nbody without blank line', 'blank line'],
        ["Merge branch 'topic'", 'type'],
    ];

    for (const [message, expected] of invalid) {
        assert.match(validateCommitMessage(message).join('\n'), new RegExp(expected, 'i'));
    }
});

test('keeps the shared validator in parity with commitlint for body, footer, and subject rules', () => {
    const invalid = [
        'feat(identity): Add feature',
        `feat(identity): change contract\n\n${'x'.repeat(101)}`,
        'feat(identity): change contract\n\nbody details\nBREAKING CHANGE: callers must migrate',
    ];

    for (const message of invalid) {
        assert.notDeepEqual(validateCommitMessage(message), [], message);
    }
});

test('ignores a merge message only when Git topology says it is a merge', () => {
    assert.deepEqual(validateCommitMessage("Merge branch 'topic'", { isMerge: true }), []);
    assert.notDeepEqual(validateCommitMessage("Merge branch 'topic'"), []);
});

test('accepts main, approved topic branches, and SemVer release branches', () => {
    const valid = [
        'main',
        'feat/add-validator',
        'fix/windows-shell',
        'hotfix/reject-pwa',
        'chore/update-tools',
        'release/0.1.0',
        'release/1.2.3-alpha.1+build.9',
    ];

    for (const branch of valid) {
        assert.deepEqual(validateBranchName(branch), [], branch);
    }
});

test('rejects branch names outside the approved grammar', () => {
    const invalid = [
        'master',
        'docs/explain-install',
        'refactor/split-policy',
        'test/cover-branch',
        'ci/pin-actions',
        'codex/task-three',
        'feature/add-validator',
        'bugfix/windows-shell',
        'feat/',
        'feat/Add-validator',
        'feat/under_score',
        'feat/two/levels',
        'feat/-leading',
        'feat/trailing-',
        'feat/double--dash',
        'feat/1.2.3',
        'release/v1.2.3',
        'release/1.2',
        'release/01.2.3',
        'release/1-2-3',
        'release/1.2.3-01',
        'release/1.2.3-alpha..1',
        'release/1.2.3+',
    ];

    for (const branch of invalid) {
        assert.notDeepEqual(validateBranchName(branch), [], branch);
    }
});
