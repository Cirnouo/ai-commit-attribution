import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { parse } from '@babel/parser';
import { isMainModule } from './cli-entry.ts';

const powershellParser = [
    '$tokens = $null',
    '$parseErrors = $null',
    '[System.Management.Automation.Language.Parser]::ParseFile($env:ATTRIBUTION_POWERSHELL_FILE, [ref] $tokens, [ref] $parseErrors) | Out-Null',
    'if ($parseErrors.Count -gt 0) {',
    '    $parseErrors | ForEach-Object { [Console]::Error.WriteLine($_.Message) }',
    '    exit 1',
    '}',
].join('\n');

type ScriptStep = { kind: 'node' | 'typescript' | 'powershell'; executable: string; file: string };

export function buildScriptCheckPlan({ files, platform }: { files: string[]; platform: string }) {
    const plan: ScriptStep[] = files
        .filter((filePath) => /\.(?:cjs|js|mjs|ts|mts|cts)$/.test(filePath))
        .sort()
        .map((file) => ({
            kind: /\.(?:ts|mts|cts)$/.test(file) ? 'typescript' : 'node',
            executable: process.execPath,
            file,
        }));
    for (const file of files.filter((file) => file.endsWith('.ps1')).sort()) {
        plan.push({ kind: 'powershell', executable: 'pwsh', file });
        if (platform === 'win32') {
            plan.push({ kind: 'powershell', executable: 'powershell.exe', file });
        }
    }
    return plan;
}

function maintainedFiles(root: string) {
    return execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], {
        cwd: root,
        encoding: 'utf8',
    })
        .split('\0')
        .filter((file) => file && existsSync(path.join(root, file)))
        .map((filePath) => filePath.replaceAll('\\', '/'));
}

function runStep(root: string, step: ScriptStep) {
    const absolute = path.join(root, ...step.file.split('/'));
    if (step.kind === 'typescript') {
        parse(readFileSync(absolute, 'utf8'), {
            sourceType: step.file.endsWith('.cts') ? 'script' : 'module',
            plugins: ['typescript'],
        });
        return;
    }
    const arguments_ =
        step.kind === 'node'
            ? ['--check', absolute]
            : ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', powershellParser];
    const result = spawnSync(step.executable, arguments_, {
        cwd: root,
        encoding: 'utf8',
        env: { ...process.env, ATTRIBUTION_POWERSHELL_FILE: absolute },
        windowsHide: true,
    });
    if (result.error) {
        throw new Error(`${step.executable} could not run for ${step.file}: ${result.error.message}`);
    }
    if (result.status !== 0) {
        throw new Error(
            `${step.executable} syntax check failed for ${step.file}:\n${result.stdout ?? ''}${result.stderr ?? ''}`,
        );
    }
}

function run() {
    const root = process.cwd();
    const plan = buildScriptCheckPlan({ files: maintainedFiles(root), platform: process.platform });
    try {
        for (const step of plan) {
            runStep(root, step);
        }
        const nodeCount = plan.filter((step) => step.kind === 'node').length;
        const typescriptCount = plan.filter((step) => step.kind === 'typescript').length;
        const powershellCount = plan.filter((step) => step.kind === 'powershell').length;
        console.log(
            `Script syntax checks passed (${typescriptCount} TypeScript sources, ${nodeCount} generated JavaScript files, ${powershellCount} PowerShell parsers).`,
        );
    } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
    }
}

if (isMainModule(import.meta)) {
    run();
}
