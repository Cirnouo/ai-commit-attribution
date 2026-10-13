import assert from 'node:assert/strict';
import test from 'node:test';

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
