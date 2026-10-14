/** Independently reviewed installed files and maintained packaging inputs, never derived from esbuild. */
export const SKILL_FILES = [
    'LICENSE',
    'SKILL.md',
    'THIRD-PARTY-NOTICES.txt',
    'references/agent-registry.json',
    'references/records.md',
    'references/policy.md',
    'references/messages.md',
    'references/hosts.md',
    'references/integration.md',
    'scripts/attribution.mjs',
] as const;
export const PACKAGING_FILES = [
    'README.md',
    'SKILL.md',
    'agent-registry.json',
    'records.md',
    'policy.md',
    'messages.md',
    'hosts.md',
    'integration.md',
] as const;
export const PACKAGING_RESOURCES = new Map([
    ['agent-registry.json', 'references/agent-registry.json'],
    ['records.md', 'references/records.md'],
    ['policy.md', 'references/policy.md'],
    ['messages.md', 'references/messages.md'],
    ['hosts.md', 'references/hosts.md'],
    ['integration.md', 'references/integration.md'],
]);
export const SKILL_DIRECTORIES = ['references', 'scripts'] as const;
export const SKILL_ROOT = 'skills/ai-commit-attribution';
