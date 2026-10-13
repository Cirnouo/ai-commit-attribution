import { execFile } from 'node:child_process';
import { lstat, readFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { parse } from 'yaml';
import { NPM_REGISTRY } from '../constants.ts';
import { errorCode, errorMessage, isRecord } from '../errors.ts';
import type { AuditCommandResult, Finding, LockInventory } from './audit-policy.ts';

export type SecurityPhase = 'complete' | 'lockfile';
export type PnpmExecutor = (
    args: string[],
    options: { cwd: string; env: NodeJS.ProcessEnv },
) => Promise<AuditCommandResult>;
export interface ScanResult {
    inventory: LockInventory;
    findings: Finding[];
    signatures: { audited: number; verified: number };
}
export type SecurityRunnerOptions = { root: string; phase?: SecurityPhase; execute?: PnpmExecutor };

import {
    assessAudit,
    readLockInventory,
    validateConfigurationDependencies,
    validateSignatures,
} from './audit-policy.ts';
import { verifyInstallerEvidence, verifyInstallerRegistry } from './installer-evidence.ts';
import { validateInstallPolicy, verifyInstalledTree, verifyLockManifest } from './security-evidence.ts';

const exec = promisify(execFile);
const AUDIT_OPTIONS = ['--ignore-pnpmfile', '--config.configDependencies={}', `--registry=${NPM_REGISTRY}`];
const PROCESS_OPTIONS = {
    windowsHide: true,
    shell: false,
    timeout: 180_000,
    maxBuffer: 16 * 1024 * 1024,
    encoding: 'utf8' as const,
};

export async function executePnpm(
    args: string[],
    options: { cwd: string; env: NodeJS.ProcessEnv },
): Promise<AuditCommandResult> {
    let executable = process.platform === 'win32' ? 'pnpm.exe' : 'pnpm';
    let commandArgs = args;
    // npm-distributed pnpm can expose its JS entry point; never launch a .cmd through a shell.
    if (process.env.npm_execpath && /\.(?:c?js|mjs)$/.test(process.env.npm_execpath)) {
        executable = process.execPath;
        commandArgs = [process.env.npm_execpath, ...args];
    }
    try {
        const result = await exec(executable, commandArgs, { ...PROCESS_OPTIONS, ...options });
        return { ...result, exitCode: 0 };
    } catch (error) {
        if (
            !isRecord(error) ||
            typeof error.code !== 'number' ||
            error.killed ||
            error.signal ||
            typeof error.stdout !== 'string' ||
            typeof error.stderr !== 'string'
        )
            throw new Error(`pnpm command could not complete: ${errorMessage(error)}`);
        return { stdout: error.stdout, stderr: error.stderr, exitCode: error.code };
    }
}

async function verifyConfiguration(root: string, execute: PnpmExecutor, env: NodeJS.ProcessEnv) {
    const workspace: unknown = parse(await readFile(path.join(root, 'pnpm-workspace.yaml'), 'utf8'));
    if (!isRecord(workspace)) throw new Error('Invalid workspace configuration.');
    validateConfigurationDependencies(workspace.configDependencies);
    const effective = await execute(['config', 'list', '--json', ...AUDIT_OPTIONS], { cwd: root, env });
    if (effective.exitCode !== 0) throw new Error('Cannot verify effective pnpm audit configuration.');
    const configuration: unknown = JSON.parse(effective.stdout);
    validateInstallPolicy(configuration);
}

async function auditTree(
    root: string,
    inventory: LockInventory,
    execute: PnpmExecutor,
    env: NodeJS.ProcessEnv,
): Promise<ScanResult> {
    const options = { cwd: root, env };
    const vulnerabilities = await execute(['audit', '--json', '--audit-level=info', ...AUDIT_OPTIONS], options);
    const findings = assessAudit(vulnerabilities, inventory.packages);
    const signatures = await execute(['audit', 'signatures', '--json', ...AUDIT_OPTIONS], options);
    validateSignatures(signatures, inventory.packages.length);
    return {
        inventory,
        findings,
        signatures: { audited: inventory.packages.length, verified: inventory.packages.length },
    };
}

async function hasInstallation(root: string) {
    try {
        await lstat(path.join(root, 'node_modules'));
        return true;
    } catch (error) {
        if (errorCode(error) !== 'ENOENT') throw error;
        return false;
    }
}

async function lockedInputs(root: string) {
    return Promise.all(
        ['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml'].map((file) => readFile(path.join(root, file))),
    );
}

async function assertUnchangedInputs(root: string, before: Buffer[]) {
    const after = await lockedInputs(root);
    if (before.some((bytes, index) => !after[index] || !bytes.equals(after[index])))
        throw new Error('Locked inputs changed during validation or installation.');
}

export async function scanRepository({ root, phase = 'complete', execute = executePnpm }: SecurityRunnerOptions) {
    const inventory = readLockInventory(await readFile(path.join(root, 'pnpm-lock.yaml'), 'utf8'));
    await verifyLockManifest(root, inventory);
    await verifyConfiguration(root, execute, process.env);
    if (phase === 'lockfile') {
        const before = await lockedInputs(root);
        const installedBefore = await hasInstallation(root);
        const validation = await execute(
            [
                'install',
                '--lockfile-only',
                '--frozen-lockfile',
                '--ignore-scripts',
                '--config.managePackageManagerVersions=false',
                ...AUDIT_OPTIONS,
            ],
            { cwd: root, env: process.env },
        );
        if (validation.exitCode !== 0)
            throw new Error(`Frozen lockfile validation failed: ${validation.stderr ?? validation.stdout}`);
        await assertUnchangedInputs(root, before);
        if (!installedBefore && (await hasInstallation(root)))
            throw new Error('Lock-only validation created an installation tree.');
    } else {
        await verifyInstalledTree(root, inventory);
    }
    if (inventory.packages.some((entry) => entry.name === 'skills')) {
        const metadata = await execute(['view', 'skills@1.7.2', '--json', ...AUDIT_OPTIONS], {
            cwd: root,
            env: process.env,
        });
        if (metadata.exitCode !== 0) throw new Error('Cannot verify published skills installer identity.');
        verifyInstallerRegistry(JSON.parse(metadata.stdout));
        if (phase === 'complete')
            await verifyInstallerEvidence(
                path.join(root, 'node_modules/skills'),
                inventory,
                JSON.parse(await readFile(path.join(root, 'tooling/security/installer-evidence.json'), 'utf8')),
            );
    }
    return auditTree(root, inventory, execute, process.env);
}
