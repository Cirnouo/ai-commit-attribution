import type { Dirent } from 'node:fs';
import { lstat, opendir } from 'node:fs/promises';
import path from 'node:path';
import { readRegularFile } from '../tooling/file-evidence.ts';
import type { Candidate, Issue, ScopeContext } from './policy-contract.ts';
import { LIMITS } from './policy-contract.ts';
import type { CapturedScope } from './policy-scope.ts';
import { byteDigest, digest, inspectPath } from './policy-scope.ts';
import type { Operation } from './records.ts';
import { checkRaw, ordinal, unique } from './records.ts';
import { inside, ObservationError } from './safe-git.ts';

export class EvidenceSearch {
    readonly candidates: Candidate[] = [];
    readonly checkedLocations: { locator: string; status: 'present' | 'absent' | 'failed' }[] = [];
    readonly issues: Issue[] = [];
    readonly fingerprints: unknown[] = [];
    readonly seen = new Set<string>();
    readonly scopeUses = new Map<string, Set<string>>();
    readonly directories = new Map<string, 'narrow' | 'adopted'>();
    repository?: string;
    readonly limitations: string[] = [];
    files = 0;
    bytes = 0;
    referenceHops = 0;
    entries = 0;
    issue(code: string, locator: string, detail: string): void {
        const id = digest([code, locator]);
        if (!this.issues.some((item) => item.id === id)) this.issues.push({ id, code, locator, detail });
    }
    count(): void {
        if (++this.entries > LIMITS.entries) throw new ObservationError('Evidence enumeration budget exceeded.');
    }
    async directoryEntries(directory: string): Promise<Dirent[]> {
        const entries: Dirent[] = [];
        for await (const entry of await opendir(directory)) {
            this.count();
            checkRaw(entry.name);
            entries.push(entry);
        }
        return entries.sort((a, b) => ordinal(a.name, b.name));
    }
    async read(
        locator: string,
        sourceKind: string,
        scopeBasis: string,
        required = false,
        depth = 0,
        stack: string[] = [],
        display?: string,
    ): Promise<Candidate | undefined> {
        if (stack.includes(locator)) {
            this.issue('reference-cycle', locator, 'Adopted evidence reference cycle.');
            return;
        }
        const uses = this.scopeUses.get(locator) ?? new Set<string>();
        uses.add(scopeBasis);
        this.scopeUses.set(locator, uses);
        try {
            this.count();
            if (this.seen.has(locator)) {
                const cached = this.candidates.find((item) => item.locator === locator);
                if (cached) cached.scopeBasis = unique([...uses]).join('; ');
                if (
                    required &&
                    this.checkedLocations.some((item) => item.locator === locator && item.status === 'absent')
                ) {
                    const detail = `An explicitly referenced policy/configuration target is missing. Scope: ${unique([...uses]).join('; ')}`;
                    this.issue('missing-reference', locator, detail);
                    const issue = this.issues.find((item) => item.id === digest(['missing-reference', locator]));
                    if (issue) issue.detail = detail;
                }
                return cached;
            }
            this.seen.add(locator);
            const info = await inspectPath(locator);
            if (!info) {
                this.checkedLocations.push({ locator, status: 'absent' });
                if (required)
                    this.issue(
                        'missing-reference',
                        locator,
                        `An explicitly referenced policy/configuration target is missing. Scope: ${unique([...uses]).join('; ')}`,
                    );
                return;
            }
            if (!info.isFile() || info.isSymbolicLink())
                throw new ObservationError('Policy evidence is not a regular physical file.');
            if (++this.files > LIMITS.files || this.candidates.length >= LIMITS.candidates)
                throw new ObservationError('Policy file/candidate budget exceeded.');
            const bytes = await readRegularFile(locator, {
                physicalPath: true,
                maximumBytes: Math.min(LIMITS.fileBytes, LIMITS.bytes - this.bytes),
            });
            const after = await lstat(locator);
            if (
                info.dev !== after.dev ||
                info.ino !== after.ino ||
                info.size !== after.size ||
                info.mtimeMs !== after.mtimeMs ||
                info.ctimeMs !== after.ctimeMs
            )
                throw new ObservationError('Evidence identity changed across bounded observation.');
            this.bytes += bytes.length;
            const decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
            if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u2028\u2029]/u.test(decoded))
                throw new ObservationError('Policy evidence contains unsupported document controls.');
            const id = digest(['candidate', locator]);
            const candidate: Candidate = {
                id,
                locator,
                sourceKind,
                scopeBasis,
                sha256: byteDigest(bytes),
                byteLength: bytes.length,
                text: display ?? decoded,
                referenceIds: [],
            };
            this.fingerprints.push({
                locator,
                dev: info.dev,
                ino: info.ino,
                size: bytes.length,
                sha256: candidate.sha256,
                sourceKind,
                scopeBasis,
            });
            this.candidates.push(candidate);
            this.checkedLocations.push({ locator, status: 'present' });
            if (display !== undefined) return candidate;
            for (const match of decoded.matchAll(/\[[^\]]*\]\(([^\s)]+)(?:\s+"[^"]*")?\)/g)) {
                const link = match[1];
                if (!link || link.startsWith('#')) continue;
                this.referenceHops = Math.max(this.referenceHops, depth + 1);
                if (depth >= LIMITS.referenceHops) {
                    this.issue('reference-budget', locator, 'Adopted reference hop budget exceeded.');
                    break;
                }
                if (/^https?:\/\//i.test(link)) {
                    this.limitations.push(`Unfetched network evidence locator: ${link}`);
                    continue;
                }
                if (/^[a-z][a-z0-9+.-]*:/i.test(link) && !/^[a-z]:[/\\]/i.test(link)) {
                    this.issue('unsupported-reference', locator, 'Unsupported adopted evidence locator scheme.');
                    continue;
                }
                let decodedLink: string;
                try {
                    decodedLink = decodeURIComponent(link.split('#')[0] ?? '');
                    checkRaw(decodedLink);
                } catch {
                    this.issue('invalid-reference', locator, 'Adopted reference has invalid encoding or controls.');
                    continue;
                }
                const target = path.resolve(path.dirname(locator), decodedLink);
                const targetInfo = await inspectPath(target);
                if (targetInfo?.isDirectory()) {
                    if (!this.repository || !inside(this.repository, target))
                        this.issue(
                            'external-directory-reference',
                            target,
                            'External directory navigation is unresolved; only exact external file targets may be read.',
                        );
                    else {
                        await this.docs(target, 0, depth + 1, [...stack, locator], true);
                        candidate.referenceIds.push(
                            ...this.candidates.filter((item) => inside(target, item.locator)).map((item) => item.id),
                        );
                    }
                    continue;
                }
                const child = await this.read(
                    target,
                    'adopted-reference',
                    `Explicit link from ${locator}`,
                    true,
                    depth + 1,
                    [...stack, locator],
                );
                if (child) candidate.referenceIds.push(child.id);
            }
            candidate.referenceIds = unique(candidate.referenceIds);
            return candidate;
        } catch (error) {
            this.checkedLocations.push({ locator, status: 'failed' });
            this.issue(
                'unsafe-evidence',
                locator,
                error instanceof ObservationError
                    ? error.message
                    : 'Evidence read failed identity/type/encoding/byte-budget checks.',
            );
            return;
        }
    }
    async docs(
        directory: string,
        depth = 0,
        referenceDepth = 0,
        stack: string[] = [],
        required = false,
    ): Promise<void> {
        try {
            this.count();
            if (depth > LIMITS.directoryLevels) throw new ObservationError('Policy directory level budget exceeded.');
            if (stack.includes(directory)) throw new ObservationError('Adopted directory reference cycle.');
            const info = await inspectPath(directory);
            if (!info) {
                if (required) throw new ObservationError('Observed/adopted directory disappeared before discovery.');
                this.checkedLocations.push({ locator: directory, status: 'absent' });
                return;
            }
            if (!info.isDirectory()) throw new ObservationError('Policy discovery root must be a physical directory.');
            const mode = referenceDepth > 0 ? 'adopted' : 'narrow';
            const completed = this.directories.get(directory);
            if (completed === 'adopted' || completed === mode) return;
            const entries = await this.directoryEntries(directory);
            this.checkedLocations.push({ locator: directory, status: 'present' });
            this.fingerprints.push({
                directory,
                dev: info.dev,
                ino: info.ino,
                entries: entries.map((entry) => entry.name),
            });
            for (const entry of entries) {
                if (
                    [
                        '.git',
                        'node_modules',
                        '.pnpm',
                        'vendor',
                        'third_party',
                        'third-party',
                        'dist',
                        'coverage',
                    ].includes(entry.name)
                )
                    continue;
                const target = path.join(directory, entry.name);
                if (entry.isSymbolicLink()) {
                    this.issue('unsafe-directory-entry', target, 'Policy discovery encountered a linked path.');
                    continue;
                }
                if (entry.isDirectory())
                    await this.docs(target, depth + 1, referenceDepth, [...stack, directory], true);
                else if (
                    /\.(?:md|txt|ya?ml|json)$/i.test(entry.name) &&
                    (referenceDepth > 0 ||
                        /readme|contribut|commit|policy|attribution|disclos|(^|[._-])ai([._-]|$)/i.test(entry.name) ||
                        directory.endsWith(`${path.sep}.github${path.sep}workflows`))
                )
                    await this.read(
                        target,
                        'repository-document',
                        `Bounded contribution/policy document discovery under ${directory}`,
                        false,
                        referenceDepth,
                        [...stack, directory],
                    );
            }
            const after = await inspectPath(directory);
            if (
                !after ||
                info.dev !== after.dev ||
                info.ino !== after.ino ||
                info.mtimeMs !== after.mtimeMs ||
                info.ctimeMs !== after.ctimeMs
            )
                throw new ObservationError('Policy directory changed/disappeared during discovery.');
            // A narrow crawl cannot satisfy later explicit adoption. Cache only completed
            // coverage so widening revisits every child under the same shared budgets.
            this.directories.set(directory, mode);
        } catch {
            this.checkedLocations.push({ locator: directory, status: 'failed' });
            this.issue(
                'directory-observation',
                directory,
                'Directory discovery failed or exceeded its enumeration/level budget.',
            );
        }
    }
    async configuration(scope: CapturedScope): Promise<void> {
        const keys = ['core.hooksPath', 'commit.template', 'include.path'];
        const visited = new Set<string>();
        const active = new Set<string>();
        const settings = new Map<string, string>();
        const inspect = async (file: string, depth = 0): Promise<void> => {
            if (active.has(file) || depth > LIMITS.referenceHops) {
                this.issue('config-cycle-budget', file, 'Configuration include cycle/depth is unsupported.');
                return;
            }
            if (visited.has(file)) return;
            visited.add(file);
            active.add(file);
            const candidate = await this.read(
                file,
                'git-configuration',
                'Actual local/worktree/include configuration; only policy locator keys are displayed.',
                depth > 0,
                0,
                [],
                'Configuration bytes are bound; unrelated and secret values are omitted.',
            );
            if (!candidate) {
                active.delete(file);
                return;
            }
            try {
                const conditional = await scope.git.text(
                    'config',
                    ['--no-includes', '--file', file, '--get-regexp', '^includeIf\\..*\\.path$'],
                    true,
                );
                if (conditional) {
                    this.issue(
                        'conditional-config',
                        file,
                        'Conditional include semantics require an explicit decision; no include is guessed.',
                    );
                }
                const selected: string[] = [];
                for (const key of keys) {
                    const bytes = await scope.git.run(
                        'config',
                        ['--no-includes', '--null', '--file', file, '--get-all', key],
                        true,
                    );
                    const values = new TextDecoder('utf-8', { fatal: true }).decode(bytes).split('\0').filter(Boolean);
                    for (const value of values) {
                        checkRaw(value);
                        selected.push(`${key}=${value}`);
                        if (key === 'include.path') {
                            this.issue(
                                'config-include-order',
                                file,
                                'Included configuration is bound as data; its effective inline precedence requires a decision.',
                            );
                            if (value.startsWith('~') || !value || /\$|%/.test(value)) {
                                this.issue(
                                    'config-locator',
                                    file,
                                    'Unsupported include path expansion requires a decision.',
                                );
                                continue;
                            }
                            const target = path.resolve(path.dirname(file), value);
                            const child = await this.read(
                                target,
                                'git-configuration',
                                `Exact include referenced by ${file}`,
                                true,
                                0,
                                [],
                                'Included configuration bytes are bound; unrelated and secret values are omitted.',
                            );
                            if (child) candidate.referenceIds.push(child.id);
                            await inspect(target, depth + 1);
                        } else settings.set(key, value);
                    }
                }
                candidate.text = selected.join('\n');
            } catch {
                this.issue('config-read', file, 'Malformed or unsupported configuration cannot be safely resolved.');
            }
            active.delete(file);
        };
        await inspect(path.join(scope.commonGitDir, 'config'));
        const worktreeConfig = await scope.git.text(
            'config',
            [
                '--no-includes',
                '--file',
                path.join(scope.commonGitDir, 'config'),
                '--bool',
                '--get',
                'extensions.worktreeConfig',
            ],
            true,
        );
        if (worktreeConfig === 'true') await inspect(path.join(scope.gitDirectory, 'config.worktree'));
        const hookSetting = settings.get('core.hooksPath');
        if (hookSetting?.startsWith('~') || settings.get('commit.template')?.startsWith('~')) {
            this.issue(
                'config-locator',
                scope.gitDirectory,
                'Home-relative policy locators need an explicit exact candidate.',
            );
            return;
        }
        const hooks = hookSetting ? path.resolve(scope.worktree, hookSetting) : path.join(scope.commonGitDir, 'hooks');
        for (const name of ['prepare-commit-msg', 'commit-msg'])
            await this.read(
                path.join(hooks, name),
                'message-hook',
                'Effective message-related hook definition, read as data',
            );
        const template = settings.get('commit.template');
        if (template)
            await this.read(
                path.resolve(scope.git.directory, template),
                'commit-template',
                'Effective explicitly configured commit template',
                true,
            );
    }
    async discover(operation: Operation, context: ScopeContext, scope: CapturedScope): Promise<void> {
        this.repository = operation.worktree;
        const dirs = new Set<string>();
        let current = operation.worktree;
        let steps = 0;
        for (;;) {
            if (++steps > LIMITS.ancestors) {
                this.issue('ancestor-budget', current, 'Applicable ancestor instruction budget exceeded.');
                break;
            }
            dirs.add(current);
            const parent = path.dirname(current);
            if (parent === current) break;
            current = parent;
        }
        for (const relative of scope.paths) {
            let parent = path.dirname(path.join(operation.worktree, relative));
            const state = await inspectPath(path.join(operation.worktree, relative));
            if (state?.isDirectory()) parent = path.join(operation.worktree, relative);
            let depth = 0;
            while (inside(operation.worktree, parent)) {
                if (++depth > LIMITS.directoryLevels) {
                    this.issue('local-depth-budget', parent, 'Applicable local instruction depth budget exceeded.');
                    break;
                }
                dirs.add(parent);
                if (parent === operation.worktree) break;
                parent = path.dirname(parent);
            }
        }
        for (const directory of [...dirs].sort(ordinal))
            for (const name of ['AGENTS.md', 'CLAUDE.md'])
                await this.read(
                    path.join(directory, name),
                    'applicable-instruction',
                    'Exact ancestor/local instruction of worktree or selected/intended path',
                );
        try {
            for (const entry of await this.directoryEntries(operation.worktree)) {
                if (/^(?:README|CONTRIBUTING)(?:[._-].*)?$/i.test(entry.name))
                    await this.read(
                        path.join(operation.worktree, entry.name),
                        'contribution-entry',
                        'Root contribution/navigation entry',
                    );
            }
        } catch {
            this.issue('root-discovery', operation.worktree, 'Root entry discovery failed.');
        }
        for (const name of ['README.md', 'CONTRIBUTING.md'])
            await this.read(
                path.join(operation.worktree, name),
                'contribution-entry',
                'Expected root contribution/navigation entry',
            );
        await this.docs(path.join(operation.worktree, 'docs'));
        await this.docs(path.join(operation.worktree, '.github/workflows'));
        await this.configuration(scope);
        for (const locator of context.additionalCandidatePaths ?? [])
            await this.read(locator, 'explicit-candidate', 'Exact candidate supplied by caller', true);
    }
    bindingDigest(): string {
        this.candidates.sort((a, b) => ordinal(a.id, b.id));
        this.checkedLocations.sort((a, b) => ordinal(a.locator, b.locator) || ordinal(a.status, b.status));
        this.issues.sort((a, b) => ordinal(a.id, b.id));
        return digest({
            profile: LIMITS,
            enumerationLimit: LIMITS.entries,
            scopeUses: [...this.scopeUses]
                .sort(([a], [b]) => ordinal(a, b))
                .map(([locator, uses]) => ({ locator, uses: unique([...uses]) })),
            candidates: this.candidates,
            checkedLocations: this.checkedLocations,
            issues: this.issues,
            fingerprints: this.fingerprints.sort((a, b) => ordinal(JSON.stringify(a), JSON.stringify(b))),
            limitations: unique(this.limitations),
        });
    }
}
