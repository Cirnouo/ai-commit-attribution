import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { errorMessage, isRecord } from './errors.ts';
import { readRegularFile } from './file-evidence.ts';
import { parseOwnedYaml } from './owned-yaml.ts';
import { scanSubmissionMarkdown } from './submission-markdown.ts';
import { isSemVer } from './version-policy.ts';

export function decodeText(file: string, bytes: Uint8Array): string {
    try {
        return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
        throw new Error(`${file}: invalid UTF-8 text.`);
    }
}

export function validateTextStyle(file: string, source: string): string[] {
    const errors: string[] = [];
    if (/\.yml$/i.test(file) && file !== '.github/ISSUE_TEMPLATE/config.yml')
        errors.push(`${file}: owned YAML must use .yaml; only .github/ISSUE_TEMPLATE/config.yml is exempt.`);
    if (source.includes('\r')) errors.push(`${file}: use LF, not CRLF.`);
    if (source.includes('\t')) errors.push(`${file}: tabs are prohibited.`);
    if (source && !source.endsWith('\n')) errors.push(`${file}: add a final newline.`);
    if (file !== 'pnpm-lock.yaml' && /\.(?:json|yaml|yml|ps1|psd1|psm1|toml|sh)$/.test(file)) {
        source.split('\n').forEach((line, index) => {
            const indentation = line.match(/^ +(?=\S)/)?.[0].length;
            if (indentation !== undefined && indentation % 4 !== 0)
                errors.push(`${file}:${index + 1}: indentation must be a multiple of four.`);
        });
    }
    if (/\.ya?ml$/.test(file)) {
        try {
            parseOwnedYaml(source, { name: file, documents: file === 'pnpm-lock.yaml' ? 'all' : 'single' });
        } catch (error) {
            errors.push(errorMessage(error));
        }
    }
    return errors;
}

export async function auditRepository(root: string): Promise<string[]> {
    const errors: string[] = [];
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
    const files = new Map<string, string>();
    for (const file of paths) {
        const absolute = path.resolve(root, file);
        let source: string;
        try {
            source = decodeText(file, await readRegularFile(absolute, { physicalPath: true }));
        } catch (error) {
            errors.push(errorMessage(error));
            continue;
        }
        files.set(file, source);
        if (file !== 'tooling/security/dist/check-security.mjs') errors.push(...validateTextStyle(file, source));
        if (/\.(?:mjs|cjs|js)$/.test(file) && file !== 'tooling/security/dist/check-security.mjs')
            errors.push(`${file}: maintained Node code must be TypeScript.`);
        try {
            if (/\.json$/.test(file)) JSON.parse(source);
        } catch (error) {
            errors.push(`${file}: ${errorMessage(error)}`);
        }
        if (/^\.github\/readme(?:\.[^/]+)?$/i.test(file)) errors.push(`${file}: use .github/INDEX.md.`);
    }
    const required = [
        'AGENTS.md',
        'CONTRIBUTING.md',
        'LICENSE',
        'README.md',
        'CHANGELOG.md',
        'SECURITY.md',
        '.github/INDEX.md',
        '.github/PULL_REQUEST_TEMPLATE.md',
        '.github/workflows/ci.yaml',
        '.github/workflows/codeql.yaml',
        'docs/policies/commits-and-scope.md',
        'docs/policies/documentation.md',
        'docs/policies/quality.md',
        'docs/policies/releases.md',
        'docs/policies/security.md',
        'docs/policies/supply-chain.md',
        'docs/policies/security-exceptions.json',
        'docs/policies/migration.md',
    ];
    for (const file of required) if (!files.has(file)) errors.push(`Required PR1 governance file missing: ${file}`);
    const directories = new Set(
        paths.flatMap((file) => {
            const result: string[] = [];
            for (let directory = path.posix.dirname(file); directory !== '.'; directory = path.posix.dirname(directory))
                result.push(directory);
            return result;
        }),
    );
    for (const directory of directories) {
        if (directory === 'tooling/security/dist') continue;
        const index = directory === '.github' ? 'INDEX.md' : 'README.md';
        if (!files.has(`${directory}/${index}`))
            errors.push(`${directory}: add ${index} describing immediate contents.`);
    }
    const manifest: unknown = JSON.parse(files.get('package.json') ?? 'null');
    if (
        !isRecord(manifest) ||
        !isSemVer(manifest.version) ||
        manifest.private !== true ||
        manifest.name !== 'ai-commit-attribution'
    )
        errors.push('Root private package is the authoritative SemVer identity.');
    if (!isRecord(manifest) || !isRecord(manifest.engines) || manifest.engines.node !== '^24.21.0')
        errors.push('Node supported range must be ^24.21.0.');
    if (!isRecord(manifest) || manifest.packageManager !== 'pnpm@12.4.2') errors.push('pnpm pin must be pnpm@12.4.2.');
    if (!files.get('LICENSE')?.includes('Copyright (c) 2026 Cirnouo')) errors.push('MIT attribution is missing.');
    if (!files.get('CHANGELOG.md')?.includes('## [Unreleased]'))
        errors.push('Changelog requires an Unreleased section.');
    for (const pattern of ['.idea/', 'node_modules/', '.env*'])
        if (!files.get('.gitignore')?.includes(pattern)) errors.push(`Ignore policy missing ${pattern}.`);
    const template = files.get('.github/PULL_REQUEST_TEMPLATE.md');
    if (template && !scanSubmissionMarkdown(template).some((section) => section.heading !== null))
        errors.push('Current PR template must define H2 semantics.');
    return errors;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    try {
        const errors = await auditRepository(process.cwd());
        if (errors.length) throw new Error(errors.join('\n'));
        console.log('Repository audit passed.');
    } catch (error) {
        console.error(errorMessage(error));
        process.exitCode = 1;
    }
}
