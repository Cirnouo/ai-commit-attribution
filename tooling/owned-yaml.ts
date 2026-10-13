import { isScalar, parseAllDocuments, visit } from 'yaml';
import { errorMessage } from './errors.ts';

/** One syntax/profile boundary; owned input formatting remains a separate gate. */
export function parseOwnedYaml(source: string, options: { name: string; documents: 'all' | 'single' }): unknown[] {
    const documents = parseAllDocuments(source, {
        uniqueKeys: true,
        version: '1.2',
        schema: 'core',
        logLevel: 'silent',
    });
    const errors: string[] = [];
    if (documents.length === 0 || (options.documents === 'single' && documents.length !== 1))
        errors.push(
            options.documents === 'single'
                ? 'owned YAML must contain exactly one document.'
                : 'at least one YAML document is required.',
        );
    const values: unknown[] = [];
    for (const document of documents) {
        for (const error of [...document.errors, ...document.warnings]) errors.push(error.message);
        if (
            document.directives?.yaml.version !== '1.2' ||
            Object.entries(document.directives?.tags ?? {}).some(
                ([handle, prefix]) => handle !== '!!' || prefix !== 'tag:yaml.org,2002:',
            )
        )
            errors.push('only core YAML 1.2 directives and tags are allowed.');
        visit(document, {
            Pair(_key, pair) {
                if (!isScalar(pair.key) || typeof pair.key.value !== 'string')
                    errors.push('mapping keys must be strings.');
            },
        });
        if (errors.length === 0) {
            try {
                values.push(document.toJS({ maxAliasCount: 100 }) as unknown);
            } catch (error) {
                errors.push(errorMessage(error));
            }
        }
    }
    if (errors.length) throw new Error(`Malformed ${options.name} YAML: ${errors.join('\n')}`);
    return values;
}
