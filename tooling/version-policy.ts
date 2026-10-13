import parse from 'semver/functions/parse.js';

function parseStrictVersion(value: unknown) {
    if (typeof value !== 'string' || value !== value.trim() || value.startsWith('v') || value.startsWith('V'))
        return null;
    return parse(value, { loose: false });
}

export function isSemVer(value: unknown): value is string {
    return parseStrictVersion(value) !== null;
}
