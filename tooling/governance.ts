import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { isSemVer } from './version-policy.ts';

export const COMMIT_TYPES = Object.freeze([
    'build',
    'chore',
    'ci',
    'docs',
    'feat',
    'fix',
    'perf',
    'refactor',
    'revert',
    'style',
    'test',
]);

export const COMMIT_SCOPES = Object.freeze([
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
]);

export const BRANCH_PREFIXES = Object.freeze(['feat', 'fix', 'hotfix', 'chore']);

const kebabPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const require = createRequire(import.meta.url);
const loadedCli: unknown = require('@commitlint/cli');
if (typeof loadedCli !== 'string') throw new Error('Invalid commitlint CLI entry.');
const commitlintCli = loadedCli;
const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));
const commitlintConfig = fileURLToPath(new URL('../commitlint.config.ts', import.meta.url));

export function validateCommitMessage(message: string, options: { isMerge?: boolean } = {}) {
    if (options.isMerge === true) {
        return [];
    }

    const result = spawnSync(
        process.execPath,
        [commitlintCli, '--config', commitlintConfig, '--cwd', repositoryRoot, '--color=false'],
        {
            encoding: 'utf8',
            input: message,
            windowsHide: true,
        },
    );
    if (result.error) {
        throw result.error;
    }
    if (result.status === 0) {
        return [];
    }

    const output = [result.stdout, result.stderr]
        .filter((value) => typeof value === 'string' && value.trim().length > 0)
        .join('\n')
        .trim();
    if (result.status !== 1) {
        throw new Error(output || `commitlint exited with status ${result.status}.`);
    }

    return [output || 'Commit message violates the repository commitlint configuration.'];
}

export function validateBranchName(branchName: string) {
    if (branchName === 'main') {
        return [];
    }

    if (branchName.startsWith('release/')) {
        return isSemVer(branchName.slice('release/'.length))
            ? []
            : ['Release branches must use release/<semver> with SemVer punctuation.'];
    }

    const separator = branchName.indexOf('/');
    const prefix = branchName.slice(0, separator);
    const topic = branchName.slice(separator + 1);
    if (separator < 1 || !BRANCH_PREFIXES.includes(prefix) || !kebabPattern.test(topic)) {
        return [
            `Branch must be main or <approved-prefix>/<lowercase-kebab-topic>; approved prefixes: ${BRANCH_PREFIXES.join(', ')}.`,
        ];
    }

    return [];
}
