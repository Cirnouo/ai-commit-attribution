import { INPUT_BYTES } from './input-contract.ts';
import { parseAssessment } from './message-assessment.ts';
import type { MessageRecord, MessageResult } from './message-contract.ts';
import { writeNewMessage } from './message-output.ts';
import { decodeMessage, messageLayout, preflightAssisted, reconcileSpans, runTrailers } from './message-trailers.ts';
import { resolveOutputScope } from './output-scope.ts';
import { checkRouting } from './policy.ts';
import type { Issue } from './policy-contract.ts';
import { checkRaw, InputError, identity, parseRegistry, unique } from './records.ts';
import { byteDigest, digest } from './runtime-support.ts';

type MessageInput = {
    mode: 'render' | 'validate';
    message: Buffer;
    operation: unknown;
    decision: unknown;
    output?: string;
    consumedPaths?: readonly string[];
    signal?: AbortSignal;
};
type DefaultInput = { ledger: unknown; registry: unknown; assessment?: unknown };
const issue = (id: string, code: string, detail: string): Issue => ({ id, code, detail });
function assisted(record: MessageRecord, registry: ReturnType<typeof parseRegistry>) {
    checkRaw(record.key);
    checkRaw(record.value);
    if (record.folded) throw new InputError('Folded Assisted-by is not a single-line record.');
    const match = /^([^:()<>]+):([^\s()<>]+)(?: \(([^\s:()<>]+)\))?$/.exec(record.value);
    if (!match?.[1] || !match[2] || ['unknown', 'n/a', 'null', 'auto', 'latest'].includes(match[2].toLowerCase()))
        throw new InputError('Malformed default Assisted-by identity or optional suffix.');
    const agent = match[1].trim();
    if (!agent || ['unknown', 'n/a', 'null'].includes(agent.toLowerCase()))
        throw new InputError('Malformed default Assisted-by Agent placeholder.');
    const host = registry.hosts.find((host) => host.name === agent || host.aliases.includes(agent));
    // Preserve an unresolved spelling as evidence; it cannot match a resolved current tuple or become generated output.
    return {
        agent: host?.name ?? agent,
        model: identity(match[2], 'model'),
        ...(match[3] ? { reasoning: identity(match[3], 'reasoning') } : {}),
    };
}

/** Actual routing is always checked before invoking the lazy default-input boundary. */
export async function processMessage(
    input: MessageInput,
    loadDefault: () => Promise<DefaultInput>,
): Promise<MessageResult> {
    if (!['render', 'validate'].includes(input.mode) || (input.mode === 'validate' && input.output !== undefined))
        throw new InputError('Invalid message command or validate output option.');
    checkRaw(input.output);
    if (input.message.length > INPUT_BYTES) throw new InputError('Message byte budget exceeded.');
    const message = decodeMessage(input.message);
    const route = await checkRouting(input);
    const result: MessageResult = {
        schemaVersion: 2,
        artifact: input.mode === 'render' ? 'message-render' : 'message-validation',
        operation: route.operation,
        routing: { branch: route.branch },
        message: { inputSha256: byteDigest(input.message) },
        format: {
            status: 'not-run',
            convention: route.branch === 'repository-policy' ? 'repository-policy' : 'undetermined',
        },
        participationEvidence: { status: 'not-run', appliedExceptionIssueIds: [] },
        repositoryPolicyValidation: { status: 'not-run' },
        issues: [...route.issues],
        limitations: [
            ...route.limitations,
            'Message results cannot authenticate declared participation, semantic signature mappings or actual user decisions; they never grant operation permission.',
            'Unobserved host signing and ordinary repository commit-format criteria remain integrator responsibilities.',
        ],
        exitCode: route.exitCode,
    };
    if (route.branch === 'needs-decision') return result;
    const cancelled = () => {
        if (input.signal?.aborted) throw new Error('Message processing cancelled before completion.');
    };
    cancelled();
    let candidate = message;
    if (route.branch === 'skill-default') {
        const defaults = await loadDefault();
        cancelled();
        const { summarize } = await import('./summarize.ts');
        const summary = await summarize(defaults.ledger, route.operation, defaults.registry);
        const registry = parseRegistry(defaults.registry);
        for (const host of registry.hosts) {
            checkRaw(host.name);
            if (/[:()<>]/.test(host.name))
                throw new InputError('Registry host cannot be expressed as a default trailer.');
        }
        result.format = { status: 'valid', convention: 'skill-default' };
        result.participationEvidence = {
            status: summary.issues.length ? 'incomplete' : 'complete-against-declared-input',
            summary,
            appliedExceptionIssueIds: [],
        };
        const summaryIssues = new Set(
            summary.issues.map((item) =>
                issue(
                    item.id,
                    item.code,
                    'Declared participation has an unresolved required identity or participant gap.',
                ),
            ),
        );
        result.issues.push(...summaryIssues);
        const excluded = [route.operation.repository, route.operation.worktree, route.operation.commonGitDir];
        let layout: ReturnType<typeof messageLayout>;
        try {
            preflightAssisted(message);
            const parsed = decodeMessage(
                await runTrailers(Buffer.from(message.replaceAll('\r\n', '\n')), {
                    excluded,
                    ...(input.signal ? { signal: input.signal } : {}),
                }),
            );
            layout = messageLayout(message, parsed);
        } catch (error) {
            if (!(error instanceof InputError)) throw error;
            result.format.status = 'invalid';
            result.exitCode = 2;
            result.issues.push(
                issue(digest(['format', result.message.inputSha256]), 'invalid-trailer-layout', error.message),
            );
            return result;
        }
        const assessment = await parseAssessment(
            defaults.assessment,
            route,
            result.message.inputSha256,
            layout.records,
            summary,
        );
        result.message.records = layout.records.map((record) => ({
            id: record.id,
            key: record.key,
            sha256: byteDigest(Buffer.from(record.raw)),
            byteLength: Buffer.byteLength(record.raw),
        }));
        const applied = unique(assessment.exceptionApplications.flatMap((application) => application.issueIds));
        result.participationEvidence.appliedExceptionIssueIds = applied;
        if (summary.issues.length && applied.length)
            result.participationEvidence.status = 'incomplete-with-user-exception';
        const removed = new Set<string>();
        const canonical = summary.tuples.map(
            (tuple) => `Assisted-by: ${tuple.agent}:${tuple.model}${tuple.reasoning ? ` (${tuple.reasoning})` : ''}`,
        );
        const actual: string[] = [];
        let invalid = false;
        for (const record of layout.records) {
            if (/^assisted\s*-\s*by$/i.test(record.key)) {
                try {
                    const tuple = assisted(record, registry);
                    const matching = summary.tuples.filter(
                        (expected) => expected.agent === tuple.agent && expected.model === tuple.model,
                    );
                    if (!matching.length) {
                        result.issues.push(
                            issue(
                                record.id,
                                'unresolved-existing-identity',
                                'Existing Agent/model has no supported current event association.',
                            ),
                        );
                    } else {
                        const line = `Assisted-by: ${tuple.agent}:${tuple.model}${tuple.reasoning ? ` (${tuple.reasoning})` : ''}`;
                        actual.push(line);
                        if (
                            !canonical.includes(line) ||
                            record.key !== 'Assisted-by' ||
                            record.raw.replace(/\r?\n$/, '') !== line
                        )
                            invalid = true;
                        removed.add(record.id);
                    }
                } catch (error) {
                    if (!(error instanceof InputError)) throw error;
                    invalid = true;
                    result.issues.push(issue(record.id, 'invalid-assisted-by', error.message));
                }
            } else if (/^AI-(?:Agent|Model|Reasoning-Effort)$/i.test(record.key)) {
                const signature = assessment.signatures.find(
                    (signature) =>
                        signature.source.kind === 'message-record' && signature.source.messageRecordId === record.id,
                );
                const migration =
                    signature &&
                    assessment.migrations.find((migration) => migration.signatureIds.includes(signature.id));
                if (migration && input.mode === 'render') removed.add(record.id);
                else
                    result.issues.push(
                        issue(
                            record.id,
                            'legacy-signature',
                            'Legacy signature needs an exact event mapping and current modification decision.',
                        ),
                    );
            }
        }
        for (const signature of assessment.signatures) {
            if (signature.classification === 'uncertain')
                result.issues.push(
                    issue(
                        signature.id,
                        'uncertain-signature',
                        'A concrete supplied signature assessment remains uncertain.',
                    ),
                );
            if (signature.classification !== 'ai-signature') continue;
            if (signature.source.kind === 'automatic-signing') {
                result.issues.push(
                    issue(
                        signature.id,
                        'automatic-ai-signature',
                        'Declared automatic AI signing conflicts with the default route; resolve it without changing identity or global configuration.',
                    ),
                );
            } else {
                const messageRecordId = signature.source.messageRecordId;
                const record = layout.records.find((record) => record.id === messageRecordId);
                if (record && !/^assisted\s*-\s*by$/i.test(record.key) && !removed.has(record.id)) {
                    if (
                        input.mode === 'render' &&
                        assessment.migrations.some((migration) => migration.signatureIds.includes(signature.id))
                    )
                        removed.add(record.id);
                    else if (!/^AI-(?:Agent|Model|Reasoning-Effort)$/i.test(record.key))
                        result.issues.push(
                            issue(
                                record.id,
                                'ai-signature-conflict',
                                'Known AI signature needs exact authorized migration before default completion.',
                            ),
                        );
                }
            }
        }
        const formatIssues = result.issues.filter((item) => item.code === 'invalid-assisted-by');
        const blockers = result.issues.filter(
            (item) => !(summaryIssues.has(item) && applied.includes(item.id)) && !formatIssues.includes(item),
        );
        if (formatIssues.length || (input.mode === 'validate' && invalid)) {
            result.format.status = 'invalid';
            result.exitCode = 2;
            if (!formatIssues.length)
                result.issues.push(
                    issue(
                        digest(['canonical', result.message.inputSha256]),
                        'noncanonical-assisted-by',
                        'Default records need canonical names, spacing and supported optional effort.',
                    ),
                );
            return result;
        }
        if (blockers.length) {
            result.exitCode = 20;
            return result;
        }
        if (input.mode === 'validate') {
            const expected = canonical.join('\n');
            const indexes = layout.records.flatMap((record, index) =>
                /^assisted\s*-\s*by$/i.test(record.key) ? [index] : [],
            );
            const adjacent = indexes.every(
                (index, position) => position === 0 || index === (indexes[position - 1] ?? 0) + 1,
            );
            if (actual.join('\n') !== expected || !adjacent) {
                result.exitCode = actual.length === new Set(actual).size && actual.length < canonical.length ? 20 : 2;
                result.format.status = result.exitCode === 2 ? 'invalid' : 'valid';
                result.issues.push(
                    issue(
                        digest(['tuples', result.message.inputSha256]),
                        'missing-or-unsorted-tuples',
                        'Actual trailer group differs from the canonical supported current tuples.',
                    ),
                );
            } else result.exitCode = 0;
            cancelled();
            return result;
        }
        const retained = reconcileSpans(message, layout, removed, []);
        // Real Git insertion must recognize the complete supplied set; retain source spans instead of its unrelated rewrites.
        const inserted = decodeMessage(
            await runTrailers(Buffer.from(retained.replaceAll('\r\n', '\n')), {
                excluded,
                additions: canonical,
                ...(input.signal ? { signal: input.signal } : {}),
            }),
        );
        const interpreted = decodeMessage(
            await runTrailers(Buffer.from(inserted), { excluded, ...(input.signal ? { signal: input.signal } : {}) }),
        );
        if (canonical.some((line) => !interpreted.split('\n').includes(line)))
            throw new Error('Trailer insertion did not retain canonical supplied records.');
        candidate = reconcileSpans(message, layout, removed, canonical);
        const finalParsed = decodeMessage(
            await runTrailers(Buffer.from(candidate.replaceAll('\r\n', '\n')), {
                excluded,
                ...(input.signal ? { signal: input.signal } : {}),
            }),
        );
        const finalLayout = messageLayout(candidate, finalParsed);
        const final = finalLayout.records
            .filter((record) => /^Assisted-by$/i.test(record.key))
            .map((record) => record.raw.replace(/\r?\n$/, ''));
        if (JSON.stringify(final) !== JSON.stringify(canonical))
            throw new Error('Final canonical trailer semantics differ from the supported tuple set.');
        result.exitCode = 0;
    }
    if (input.mode === 'render') {
        cancelled();
        result.message.outputSha256 = byteDigest(Buffer.from(candidate));
        result.message.preview = candidate;
        result.message.changed = candidate !== message;
        if (input.output !== undefined)
            result.message.outputPath = await writeNewMessage(
                input.output,
                Buffer.from(candidate),
                await resolveOutputScope(route.operation),
                input.consumedPaths ?? [],
                input.signal,
            );
    }
    return result;
}
