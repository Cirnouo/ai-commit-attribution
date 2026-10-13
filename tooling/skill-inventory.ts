/** Independently reviewed installed files and maintained packaging inputs, never derived from esbuild. */
export const SKILL_FILES = [
    'LICENSE',
    'SKILL.md',
    'THIRD-PARTY-NOTICES.txt',
    'references/agent-registry.json',
    'references/records.md',
    'scripts/attribution.mjs',
] as const;
export const PACKAGING_FILES = ['README.md', 'SKILL.md', 'agent-registry.json', 'records.md'] as const;
export const PACKAGING_RESOURCES = new Map([
    ['agent-registry.json', 'references/agent-registry.json'],
    ['records.md', 'references/records.md'],
]);
export const SKILL_DIRECTORIES = ['references', 'scripts'] as const;
export const SKILL_ROOT = 'skills/ai-commit-attribution';
