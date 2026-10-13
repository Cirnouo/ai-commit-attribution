import configConventional from '@commitlint/config-conventional';
import type { UserConfig } from '@commitlint/types';

import { footerLeadingBlank, validateRawMessage } from './tooling/commit-footer-rule.ts';
import { COMMIT_SCOPES, COMMIT_TYPES } from './tooling/commit-vocabulary.ts';

export default {
    defaultIgnores: false,
    ignores: [],
    plugins: [
        {
            rules: {
                'footer-leading-blank': footerLeadingBlank,
                'raw-message': (parsed) => {
                    const errors = validateRawMessage(parsed.raw ?? '');
                    return [errors.length === 0, errors.join(' ')];
                },
            },
        },
    ],
    parserPreset: {
        name: 'repository-conventional-commits',
        parserOpts: {
            headerPattern: /^(\w+)(?:\(([a-z0-9]+(?:-[a-z0-9]+)*)\))?(?:!)?: (.+)$/,
            headerCorrespondence: ['type', 'scope', 'subject'],
            noteKeywords: ['BREAKING CHANGE'],
        },
    },
    rules: {
        ...configConventional.rules,
        'body-leading-blank': [2, 'always'],
        'raw-message': [2, 'always'],
        'body-max-line-length': [0],
        'footer-max-line-length': [0],
        'footer-leading-blank': [2, 'always'],
        'header-max-length': [2, 'always', 100],
        'scope-case': [2, 'always', 'kebab-case'],
        'scope-empty': [2, 'never'],
        'scope-enum': [2, 'always', [...COMMIT_SCOPES]],
        'subject-empty': [2, 'never'],
        'subject-full-stop': [2, 'never', '.'],
        'type-enum': [2, 'always', [...COMMIT_TYPES]],
    },
} satisfies UserConfig;
