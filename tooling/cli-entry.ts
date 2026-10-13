/** Native entry identity remains correct through filesystem aliases. */
export function isMainModule(metadata: { readonly main?: unknown }): boolean {
    if (typeof metadata.main !== 'boolean')
        throw new Error('CLI entry detection requires the supported Node 24 runtime with import.meta.main.');
    return metadata.main;
}
