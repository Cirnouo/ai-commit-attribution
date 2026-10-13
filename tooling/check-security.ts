import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { lstat, readFile } from 'node:fs/promises';
import path from 'node:path';
import { isMainModule } from './cli-entry.ts';
import { errorMessage } from './errors.ts';
import { readRegularFile } from './file-evidence.ts';
import type { AuditScope, FindingDecision, Fingerprints } from './security/audit-policy.ts';
import { evaluateFindings, readLockInventory, validateExceptions } from './security/audit-policy.ts';
import { fingerprintInputs } from './security/security-evidence.ts';
import type { PnpmExecutor, ScanResult } from './security/security-runner.ts';
import { scanRepository } from './security/security-runner.ts';
import { PACKAGING_FILES, SKILL_FILES, SKILL_ROOT } from './skill-inventory.ts';

type SecurityOptions = { phase?: string; now?: Date; execute?: PnpmExecutor };
type ScopeResult = FindingDecision & { signatures: ScanResult['signatures']; fingerprints: Fingerprints };

export async function checkSecurity(root: string, options: SecurityOptions = {}) {
    const phase = options.phase ?? 'complete';
    if (phase !== 'complete' && phase !== 'lockfile') throw new Error(`Unknown security phase: ${phase}`);
    const paths = [
        ...new Set(
            execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], {
                cwd: root,
                encoding: 'utf8',
                windowsHide: true,
            })
                .split('\0')
                .filter((file) => file && existsSync(path.join(root, file))),
        ),
    ];
    const exceptionPath = path.join(root, 'docs/policies/security-exceptions.json');
    const exceptionBytes = await readRegularFile(exceptionPath);
    const exceptions = validateExceptions(JSON.parse(exceptionBytes.toString('utf8')), options.now);
    const code = paths.filter(
        (file) =>
            /^(?:src|tooling)\/.*\.(?:ts|mts|cts|mjs|cjs|ps1)$/.test(file) ||
            file === `${SKILL_ROOT}/scripts/attribution.mjs`,
    );
    const configuration = paths.filter(
        (file) =>
            PACKAGING_FILES.some((name) => name !== 'README.md' && file === `packaging/${name}`) ||
            SKILL_FILES.some((name) => !name.endsWith('.mjs') && file === `${SKILL_ROOT}/${name}`) ||
            /^\.github\/.*\.yaml$/.test(file) ||
            file === '.github/ISSUE_TEMPLATE/config.yml' ||
            /^\.husky\/[^/]+$/.test(file) ||
            [
                'package.json',
                'pnpm-workspace.yaml',
                'pnpm-lock.yaml',
                '.npmrc',
                'tsconfig.json',
                'biome.json',
                'commitlint.config.ts',
                'mise.toml',
                'tooling/security/installer-evidence.json',
            ].includes(file),
    );
    for (const exception of exceptions) {
        for (const file of exception.evidence) {
            if (
                (!code.includes(file) && !configuration.includes(file)) ||
                !(await lstat(path.join(root, file))).isFile()
            )
                throw new Error(`Unreviewable fingerprinted evidence: ${file}`);
        }
    }
    const initialInventory = readLockInventory(await readFile(path.join(root, 'pnpm-lock.yaml'), 'utf8'));
    const initialEvidence = await fingerprintInputs(root, code, configuration, initialInventory);
    async function review(scope: AuditScope, result: ScanResult): Promise<ScopeResult> {
        const fingerprints = await fingerprintInputs(root, code, configuration, result.inventory);
        if (fingerprints.code !== initialEvidence.code || fingerprints.configuration !== initialEvidence.configuration)
            throw new Error('Audit evidence changed during scan; retry with stable inputs.');
        return {
            ...evaluateFindings(result.findings, exceptions, { [scope]: fingerprints }),
            signatures: result.signatures,
            fingerprints,
        };
    }
    const results: { repository: ScopeResult } = {
        repository: await review('repository', await scanRepository({ root, ...options, phase })),
    };
    const finalEvidence = await fingerprintInputs(root, code, configuration, initialInventory);
    if (finalEvidence.code !== initialEvidence.code || finalEvidence.configuration !== initialEvidence.configuration)
        throw new Error('Audit evidence changed during scan; retry with stable inputs.');
    if (!exceptionBytes.equals(await readRegularFile(exceptionPath)))
        throw new Error('Review exceptions changed during scan; retry with stable inputs.');
    return { ok: Object.values(results).every((result) => result.blocked.length === 0), scopes: results };
}

if (isMainModule(import.meta)) {
    try {
        const args = process.argv.slice(2);
        let root: string | undefined;
        let phase = 'complete';
        const seen = new Set();
        while (args.length) {
            const flag = args.shift();
            const value = args.shift();
            if (!flag || !['--phase', '--root'].includes(flag) || seen.has(flag) || !value || value.startsWith('--'))
                throw new Error('Usage: check-security.mjs --root <repository> [--phase complete|lockfile]');
            seen.add(flag);
            if (flag === '--phase') phase = value;
            else root = path.resolve(value);
        }
        if (!root) throw new Error('Usage: check-security.mjs --root <repository> [--phase complete|lockfile]');
        const result = await checkSecurity(root, { phase });
        console.log(JSON.stringify(result, null, 4));
        if (!result.ok) process.exitCode = 1;
    } catch (error) {
        console.error(JSON.stringify({ ok: false, error: errorMessage(error) }, null, 4));
        process.exitCode = 1;
    }
}
