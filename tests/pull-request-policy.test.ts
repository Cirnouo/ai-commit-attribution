import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { validatePullRequestBody } from '../tooling/pull-request-policy.ts';
import { scanSubmissionMarkdown } from '../tooling/submission-markdown.ts';

const template = readFileSync(new URL('../.github/PULL_REQUEST_TEMPLATE.md', import.meta.url), 'utf8');

const compliantBody = `## Problem

https://github.com/example/project/issues/219

## Resulting behavior

The gate rejects descriptions that omit the required verification evidence.

## Verification

Focused policy tests and pnpm verify:push passed; real browser checks were not run.

- [x] Focused tests and \`pnpm verify:push\` pass.
- [ ] Dependency or build-input changes passed \`pnpm check:security\`, when applicable.
    N/A: Dependencies and build inputs are unchanged.
- [ ] Runtime source changes include verified regenerated distribution output, when applicable.
    N/A: Runtime source is unchanged.

## Documentation

- [x] Relevant documentation and meaningful Unreleased user changes are updated, when applicable.
- [x] The PR title and commits follow the repository policy.
- [x] Version 0.1.0 remains unreleased.
`;

function errors(body: string | null, currentTemplate = template) {
    return validatePullRequestBody(body, currentTemplate).join('\n');
}

test('accepts a literal compliant current PR body and selected uppercase checks', () => {
    assert.equal(errors(compliantBody), '');
    assert.equal(errors(compliantBody.replaceAll('[x]', '[X]')), '');
});

test('requires each canonical section exactly once and in template order without extra H2 headings', () => {
    for (const body of [
        null,
        '',
        compliantBody.replace('## Problem', '### Problem'),
        `## Problem\n\nAnother problem.\n\n${compliantBody}`,
        compliantBody
            .replace('## Problem', '## Resulting behavior')
            .replace('## Resulting behavior\n\nThe gate', '## Problem\n\nThe gate'),
        `${compliantBody}\n## Unrelated\n`,
        `${compliantBody}\nUnrelated\n---------\n`,
    ]) {
        assert.match(errors(body), /section|heading|body/i);
    }
});

test('requires unchanged canonical checklist labels once in the owning section and original order', () => {
    const focused = '- [x] Focused tests and `pnpm verify:push` pass.';
    const title = '- [x] The PR title and commits follow the repository policy.';
    const version = '- [x] Version 0.1.0 remains unreleased.';
    for (const body of [
        compliantBody.replace(focused, ''),
        compliantBody.replace(focused, `${focused}\n${focused}`),
        `${focused}\n\n${compliantBody}`,
        compliantBody.replace(focused, '').replace('## Documentation', `## Documentation\n\n${focused}`),
        compliantBody.replace(`${title}\n${version}`, `${version}\n${title}`),
        compliantBody.replace('Focused tests and', 'Focused tests plus'),
    ]) {
        assert.match(errors(body), /checklist/i);
    }
});

test('rejects unselected mandatory checks and incomplete conditional N/A reasons', () => {
    for (const body of [
        compliantBody.replace('[x] Focused', '[ ] Focused'),
        compliantBody.replace('[x] The PR title', '[ ] The PR title'),
        compliantBody.replace('    N/A: Dependencies and build inputs are unchanged.\n', ''),
        compliantBody.replace('    N/A: Dependencies and build inputs are unchanged.', '    N/A:   '),
        compliantBody.replace('    N/A: Dependencies', 'N/A: Dependencies'),
        compliantBody.replace('    N/A: Dependencies', '\n    N/A: Dependencies'),
        compliantBody.replace('    N/A: Dependencies', '    Dependencies'),
    ]) {
        assert.match(errors(body), /selected|N\/A|checklist/i);
    }
    assert.equal(
        errors(
            compliantBody.replace(
                '- [x] Relevant documentation and meaningful Unreleased user changes are updated, when applicable.',
                '- [ ] Relevant documentation and meaningful Unreleased user changes are updated, when applicable.\n' +
                    '    N/A: This change needs no further documentation or user-facing changelog entry.',
            ),
        ),
        '',
    );
});

test('conditional N/A indentation uses actual source spaces rather than masked comments', async (context) => {
    const reason = 'N/A: Dependencies and build inputs are unchanged.';
    for (const [name, replacement] of [
        ['unindented reason', reason],
        ['unindented comment prefix', `<!-- hint -->${reason}`],
        ['one actual space with comment prefix', ` <!-- hint -->${reason}`],
    ]) {
        await context.test(name ?? 'invalid indentation', () => {
            assert.match(errors(compliantBody.replace(`    ${reason}`, replacement ?? '')), /selected|N\/A|checklist/i);
        });
    }
    for (const [name, replacement] of [
        ['two actual spaces with comment prefix', `  <!-- hint -->${reason}`],
        ['four actual spaces with comment prefix', `    <!-- hint -->${reason}`],
        ['four actual spaces without comment', `    ${reason}`],
    ]) {
        await context.test(name ?? 'valid indentation', () => {
            assert.equal(errors(compliantBody.replace(`    ${reason}`, replacement ?? '')), '');
        });
    }
});

test('allows logical wrapped labels after whitespace normalization without erasing punctuation or markup', () => {
    assert.equal(
        errors(
            compliantBody.replace(
                'Focused tests and `pnpm verify:push` pass.',
                'Focused tests and\n    `pnpm verify:push` pass.',
            ),
        ),
        '',
    );
    assert.match(errors(compliantBody.replace('`pnpm verify:push`', 'pnpm verify:push')), /checklist/i);
});

test('accepts unindented lazy continuations of logically wrapped checklist labels', () => {
    const body = compliantBody.replace(
        'Focused tests and `pnpm verify:push` pass.',
        'Focused tests and\n`pnpm verify:push` pass.',
    );
    assert.equal(errors(body), '');
    assert.equal(
        scanSubmissionMarkdown('- [x] Focused tests and\n`pnpm verify:push` pass.\n')[0]?.checklists[0]?.label,
        'Focused tests and `pnpm verify:push` pass.',
    );
});

test('logical checkbox continuations stop at headings, lists, quotes and code fences', () => {
    for (const block of [
        '## Details',
        '- Next item',
        '> results',
        '```text\npassed\n```',
        '    ```text\n    passed\n    ```',
    ]) {
        assert.equal(scanSubmissionMarkdown(`- [x] Confirmed.\n${block}\n`)[0]?.checklists[0]?.label, 'Confirmed.');
    }
});

test('requires actual Problem, Resulting behavior and Verification content beyond starter prose', () => {
    for (const [actual, starter] of [
        ['https://github.com/example/project/issues/219', 'Describe the problem or link the relevant issue.'],
        [
            'The gate rejects descriptions that omit the required verification evidence.',
            'Explain the final change and any compatibility or security implications.',
        ],
        [
            'Focused policy tests and pnpm verify:push passed; real browser checks were not run.',
            'List the checks actually run and their results. Identify any remaining\nverification limits, including real-platform checks.',
        ],
    ] as const) {
        for (const replacement of [
            '',
            starter,
            `<!-- ${actual} -->`,
            `> ${starter}`,
            `\`\`\`text\n${starter}\n\`\`\``,
        ]) {
            assert.match(errors(compliantBody.replace(actual, replacement)), /content|evidence/i);
        }
    }
});

test('matches whole starter paragraphs instead of substrings and permits Unicode or short answers', () => {
    assert.equal(
        errors(
            compliantBody
                .replace('https://github.com/example/project/issues/219', '#219')
                .replace(
                    'The gate rejects descriptions that omit the required verification evidence.',
                    '修复提交说明。',
                )
                .replace(
                    'Focused policy tests and pnpm verify:push passed; real browser checks were not run.',
                    '> List the checks actually run and their results. Identify any remaining\n' +
                        '> verification limits, including real-platform checks.\n\n检查已通过。',
                ),
        ),
        '',
    );
    assert.equal(
        errors(
            compliantBody.replace(
                'https://github.com/example/project/issues/219',
                'Describe the problem or link the relevant issue. See #219.',
            ),
        ),
        '',
    );
});

test('code, quotes, indented code and comments cannot supply missing structural sections or checks', () => {
    const missingCheck = compliantBody.replace('- [x] Focused tests and `pnpm verify:push` pass.', '');
    for (const example of [
        '```md\n- [x] Focused tests and `pnpm verify:push` pass.\n```',
        '~~~md\n- [x] Focused tests and `pnpm verify:push` pass.\n~~~',
        '    - [x] Focused tests and `pnpm verify:push` pass.',
        '> - [x] Focused tests and `pnpm verify:push` pass.',
        '<!-- - [x] Focused tests and `pnpm verify:push` pass. -->',
    ]) {
        assert.match(errors(missingCheck.replace('## Verification', `## Verification\n\n${example}`)), /checklist/i);
    }
    for (const example of ['```md\n## Problem\n```', '    ## Problem', '> ## Problem', '<!--\n## Problem\n-->']) {
        assert.match(errors(compliantBody.replace('## Problem', example)), /section|heading/i);
    }
});

test('accepts fenced result evidence and deeper prose, while respecting both fence marker lengths', () => {
    const evidence = 'Focused policy tests and pnpm verify:push passed; real browser checks were not run.';
    for (const [open, short, close] of [
        ['````', '```', '`````'],
        ['~~~~', '~~~', '~~~~~'],
    ]) {
        const body = compliantBody.replace(evidence, `${open}text\nchecks passed\n${short}\n## Example\n${close}`);
        assert.equal(errors(body), '');
    }
    assert.equal(errors(compliantBody.replace(evidence, '### Platform results\n\n    checks passed')), '');
    assert.equal(errors(compliantBody.replace(evidence, '<!-- ## Fake -->checks passed<!-- hidden -->')), '');
});

test('accepts literal fenced TAP counters as verification evidence without treating them as headings', () => {
    const body = compliantBody.replace(
        'Focused policy tests and pnpm verify:push passed; real browser checks were not run.',
        '```text\n# tests 586\n# pass 586\n# fail 0\n```',
    );
    assert.equal(errors(body), '');
    assert.equal(scanSubmissionMarkdown(body).filter((section) => section.heading !== null).length, 4);
});

test('accepts equivalent setext H2 sections and rejects headings synthesized by removing comments', () => {
    assert.equal(errors(compliantBody.replace('## Problem', 'Problem\n-------')), '');
    for (const replacement of ['#<!-- comment --># Problem', '<!-- comment -->## Problem']) {
        assert.match(errors(compliantBody.replace('## Problem', replacement)), /section|heading/i);
    }
});

test('formatting and copied template examples alone do not supply verification evidence', () => {
    const evidence = 'Focused policy tests and pnpm verify:push passed; real browser checks were not run.';
    for (const replacement of [
        '---',
        '### Results',
        '> - [x] Focused tests and `pnpm verify:push` pass.',
        '```md\n- [x] Focused tests and `pnpm verify:push` pass.\n```',
        `\`\`\`md\n${template}\n\`\`\``,
    ]) {
        assert.match(errors(compliantBody.replace(evidence, replacement)), /content|evidence/i);
    }
    assert.match(
        errors(
            compliantBody.replace(
                'https://github.com/example/project/issues/219',
                'Explain the final change and any compatibility or security implications.',
            ),
        ),
        /content|evidence/i,
    );
});

test('rejects compact literal examples containing only canonical starter prose and checklist content', async (context) => {
    const evidence = 'Focused policy tests and pnpm verify:push passed; real browser checks were not run.';
    const compactTemplate = template
        .split(/\r?\n/u)
        .filter((line) => line.trim())
        .join('\n');
    for (const [name, copied] of [
        [
            'starter followed by a checklist',
            'Describe the problem or link the relevant issue.\n- [x] Focused tests and `pnpm verify:push` pass.',
        ],
        [
            'starter followed by an indented logical checkbox wrap',
            'Describe the problem or link the relevant issue.\n- [x] Focused tests and\n    `pnpm verify:push` pass.',
        ],
        [
            'starter followed by an unindented lazy checkbox wrap',
            'Describe the problem or link the relevant issue.\n- [x] Focused tests and\n`pnpm verify:push` pass.',
        ],
        [
            'starter followed by an indented copied checkbox and wrapped label',
            'Describe the problem or link the relevant issue.\n    - [x] Focused tests and\n        `pnpm verify:push` pass.',
        ],
        ['canonical template with blank lines removed', compactTemplate],
        [
            'indented canonical template with blank lines removed',
            compactTemplate
                .split('\n')
                .map((line) => `    ${line}`)
                .join('\n'),
        ],
    ] as const) {
        await context.test(name, () => {
            assert.match(errors(compliantBody.replace(evidence, `\`\`\`md\n${copied}\n\`\`\``)), /content|evidence/i);
        });
    }
});

test('accepts literal template examples mixed with actual results without substring placeholder matching', () => {
    const evidence = 'Focused policy tests and pnpm verify:push passed; real browser checks were not run.';
    for (const content of [
        'Describe the problem or link the relevant issue. Tests passed.\n- [x] Focused tests and `pnpm verify:push` pass.',
        'Describe the problem or link the relevant issue.\nTests passed.\n- [x] Focused tests and `pnpm verify:push` pass.',
        'Describe the problem or link the relevant issue.\n- [x] Focused tests and `pnpm verify:push` pass.\n# tests 586\n# pass 586\n# fail 0',
        'Describe the problem or link the relevant issue.\n- [x] Focused tests and\n    `pnpm verify:push` pass.\n# tests 586\n# pass 586\n# fail 0',
        'Describe the problem or link the relevant issue.\n- [x] Focused tests and\n`pnpm verify:push` pass. Tests passed.',
    ]) {
        assert.equal(errors(compliantBody.replace(evidence, `\`\`\`md\n${content}\n\`\`\``)), '');
    }
});

test('derives sections, checklists and starter prose from the supplied template', () => {
    const currentTemplate =
        '## Context\n\nExplain the context.\n\n## Outcome\n\nDescribe the outcome.\n\n- [ ] Recorded the result.\n';
    assert.equal(
        errors('## Context\n\n#19\n\n## Outcome\n\nDone.\n\n- [x] Recorded the result.\n', currentTemplate),
        '',
    );
    assert.match(
        errors(
            '## Context\n\nExplain the context.\n\n## Outcome\n\nDone.\n\n- [x] Recorded the result.\n',
            currentTemplate,
        ),
        /content|evidence/i,
    );
    assert.match(errors('## Context\n\n#19\n\n## Outcome\n\nDone.\n', currentTemplate), /checklist/i);
});

test('scanner selects section depth for reuse and does not split on deeper headings', () => {
    const scanned = scanSubmissionMarkdown('### Answer\n\n#### Details\n\nready\n\n- [x] Confirmed.\n', {
        sectionLevel: 3,
    });
    assert.equal(scanned.length, 2);
    assert.equal(scanned[1]?.heading, 'Answer');
    assert.deepEqual(scanned[1]?.paragraphs, [{ text: 'ready', literal: false }]);
    assert.deepEqual(scanned[1]?.checklists, [{ label: 'Confirmed.', selected: true, continuations: [] }]);
});

test('inline comments preserve actual indentation provenance for PR evidence', () => {
    const scanned = scanSubmissionMarkdown('## Verification\n\n<!-- hint -->checks passed\n');
    assert.deepEqual(scanned[1]?.paragraphs, [{ text: 'checks passed', literal: false }]);
    const indented = scanSubmissionMarkdown('## Verification\n\n    <!-- hint -->checks passed\n');
    assert.deepEqual(indented[1]?.paragraphs, [{ text: 'checks passed', literal: true }]);
    assert.equal(
        errors(
            compliantBody.replace(
                'Focused policy tests and pnpm verify:push passed; real browser checks were not run.',
                '<!-- hint -->checks passed',
            ),
        ),
        '',
    );
});
