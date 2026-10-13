import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { IssueFormConfigurationError, validateIssueBody } from '../tooling/issue-policy.ts';

const forms = {
    bugReport: readFileSync(new URL('../.github/ISSUE_TEMPLATE/bug_report.yaml', import.meta.url), 'utf8'),
    featureRequest: readFileSync(new URL('../.github/ISSUE_TEMPLATE/feature_request.yaml', import.meta.url), 'utf8'),
};
// Literal generated form bodies are independent of the YAML parser and validator.
const bugBody = `### Operating system and version

Windows 11

### Agent host

Codex Desktop

### Host version

0.160.0

### Skill version or repository commit

0.1.0

### Node.js and Git versions

Node.js 24.21.0 and Git 2.51.0

### Reproduction steps

Prepare an isolated Git repository, then validate the attribution.

### Expected behavior

Validation accepts the attribution.

### Actual behavior

Validation reports an attribution error.

### Redacted errors and additional context

_No response_
`;
const featureBody = `### Problem or use case

I need to inspect attribution for each participating agent.

### Proposed behavior

Show the agent identity in the summary.

### Alternatives considered

_No response_

### Additional context

_No response_
`;

function bug(body: string | null, currentForms = forms) {
    return validateIssueBody(body, ['template: bug-report'], currentForms);
}

function feature(body: string | null, currentForms = forms) {
    return validateIssueBody(body, ['template: feature-request'], currentForms);
}

function diagnostics(body: string | null) {
    const result = bug(body);
    assert.equal(result.status, 'invalid');
    return result.diagnostics.join('\n');
}

test('validates literal GitHub Bug and Feature bodies against the repository forms', () => {
    assert.deepEqual(bug(bugBody), { status: 'valid', template: 'bug-report', diagnostics: [] });
    assert.deepEqual(feature(featureBody), { status: 'valid', template: 'feature-request', diagnostics: [] });
});

test('skips ordinary Issues without inferring classification from body or general labels', () => {
    for (const labels of [[], ['bug'], ['feature'], ['template: unrelated'], ['template: invalid']]) {
        assert.deepEqual(validateIssueBody(bugBody, labels, forms), {
            status: 'skipped',
            template: null,
            diagnostics: [],
        });
    }
    assert.equal(validateIssueBody(null, [], forms).status, 'skipped');
    assert.equal(validateIssueBody('ordinary freeform text', ['bug'], forms).status, 'skipped');
});

test('rejects both classification labels without arbitrarily selecting a form', () => {
    const result = validateIssueBody(bugBody, ['template: feature-request', 'bug', 'template: bug-report'], forms);
    assert.equal(result.status, 'invalid');
    assert.equal(result.template, null);
    assert.match(result.diagnostics.join('\n'), /ambiguous|both/i);
});

test('accepts additional ordinary labels on a typed Issue', () => {
    assert.equal(validateIssueBody(bugBody, ['bug', 'triage', 'template: bug-report'], forms).status, 'valid');
});

test('requires optional generated headings while permitting empty or No response answers', () => {
    assert.equal(bug(bugBody.replace('_No response_', '')).status, 'valid');
    assert.equal(feature(featureBody.replaceAll('_No response_', '')).status, 'valid');
    assert.match(diagnostics(bugBody.replace('### Redacted errors and additional context', '')), /H3|heading|field/i);
});

test('rejects missing, empty, placeholder, comment-only, heading-only or formatting-only required responses', () => {
    assert.match(diagnostics(null), /H3|heading|field/i);
    for (const answer of ['', '_No response_', ' _No response_ ', '<!-- answered -->', '#### Details', '---']) {
        assert.match(
            diagnostics(bugBody.replace('Windows 11', answer)),
            /Operating system.*required|required.*Operating system/i,
        );
    }
});

test('accepts terse, Unicode, prose, list and checklist answers without semantic or length rules', () => {
    for (const answer of [
        'x',
        '自定义系统',
        'arbitrary prose without a version',
        '- start\n- inspect',
        '- [ ] Investigate',
    ]) {
        assert.equal(bug(bugBody.replace('Windows 11', answer)).status, 'valid');
    }
    assert.equal(feature(featureBody.replace('Show the agent identity in the summary.', 'x')).status, 'valid');
});

test('required textarea task-list answers count as authored content without flattening dropdown markup', () => {
    assert.equal(
        feature(
            featureBody.replace(
                'Show the agent identity in the summary.',
                '- [ ] Add export support\n- [x] Show agent identities',
            ),
        ).status,
        'valid',
    );
    assert.equal(
        bug(
            bugBody.replace(
                'Prepare an isolated Git repository, then validate the attribution.',
                '- [ ] Launch an isolated Git repository\n- [ ] Request status',
            ),
        ).status,
        'valid',
    );
    for (const answer of [
        '- [x] Codex Desktop',
        '```text\nCodex Desktop\n```',
        '> Codex Desktop',
        '    Codex Desktop',
    ]) {
        assert.match(diagnostics(bugBody.replace('Codex Desktop', answer)), /Agent host.*option|option.*Agent host/i);
    }
});

test('required textarea rejects empty prose markers consistently while preserving literal code evidence', async (context) => {
    for (const marker of ['- [ ]', '- [ ] ', '- [x]', '- [x] ', '+ [X]', '* [ ]', '1. [ ]', '1) [x]', '- [ ]\n- [x]']) {
        await context.test(`prose marker ${JSON.stringify(marker)}`, () => {
            assert.match(
                diagnostics(
                    bugBody.replace('Prepare an isolated Git repository, then validate the attribution.', marker),
                ),
                /Reproduction steps.*requires|requires.*Reproduction steps/i,
            );
        });
    }
    for (const answer of ['```text\n- [ ]\n```', '    - [x]', '```text\n**\n```', '```text\n+\n```']) {
        await context.test(`literal output ${JSON.stringify(answer)}`, () => {
            assert.equal(
                bug(bugBody.replace('Prepare an isolated Git repository, then validate the attribution.', answer))
                    .status,
                'valid',
            );
        });
    }
    for (const answer of ['*', '**']) {
        await context.test(`plain punctuation value ${JSON.stringify(answer)}`, () => {
            assert.equal(
                bug(bugBody.replace('Prepare an isolated Git repository, then validate the attribution.', answer))
                    .status,
                'valid',
            );
            assert.equal(
                bug(bugBody.replace('Codex Desktop', answer), {
                    ...forms,
                    bugReport: forms.bugReport.replace('- Codex Desktop', `- "${answer}"`),
                }).status,
                'valid',
            );
        });
    }
});

test('rejects duplicate, reordered and extra field-like H3 headings', () => {
    for (const body of [
        bugBody.replace('Windows 11', 'Windows 11\n\n### Operating system and version\n\nUbuntu'),
        bugBody
            .replace('### Host version', '### Skill version or repository commit')
            .replace('### Skill version or repository commit\n\n0.1.0', '### Host version\n\n0.1.0'),
        bugBody.replace('Windows 11', 'Windows 11\n\n### Extra field\n\nAnswer'),
    ]) {
        assert.match(diagnostics(body), /once.*order|order.*once|H3|heading/i);
    }
});

test('fake headings in comments, fenced code, indented code and quotes cannot replace a generated heading', () => {
    for (const heading of [
        '<!--\n### Host version\n-->',
        '```md\n### Host version\n```',
        '~~~md\n### Host version\n~~~',
        '    ### Host version',
        '> ### Host version',
    ]) {
        assert.match(diagnostics(bugBody.replace('### Host version', heading)), /H3|heading|field/i);
    }
});

test('accepts fenced and quoted actual answer evidence while ignoring fake structure', () => {
    for (const answer of [
        '```text\n### Host version\n# tests 3\n# pass 3\n```',
        '~~~~text\n### Host version\n~~~\n~~~~~',
        '    ### Host version\n    observed error',
        '> ### Host version\n> observed error',
        '#### Details\n\nObserved an error.\n\n<!-- ### Fake field -->',
    ]) {
        assert.equal(bug(bugBody.replace('Validation reports an attribution error.', answer)).status, 'valid');
    }
});

test('uses exact dropdown option text, with no aliases, substrings, multiple choices or extra prose', () => {
    for (const host of ['Codex Desktop', 'Codex CLI', 'Claude Code', 'Other']) {
        assert.equal(bug(bugBody.replace('Codex Desktop', host)).status, 'valid');
    }
    for (const host of [
        'codex desktop',
        'Codex',
        'Codex Desktop, Claude Code',
        'Codex Desktop\n\nMore text',
        '_No response_',
        '',
    ]) {
        assert.match(diagnostics(bugBody.replace('Codex Desktop', host)), /Agent host.*option|option.*Agent host/i);
    }
});

test('derives labels, headings, order, required flags and dropdown options from changed YAML', () => {
    const currentForms = {
        ...forms,
        bugReport: forms.bugReport
            .replace('template: bug-report', 'template: defect')
            .replace('label: Host version', 'label: Installed host release')
            .replace('- Codex Desktop', '- My Custom Host')
            .replace(
                'description: Include relevant error codes and operation phases; remove sensitive data.',
                'description: Include relevant error codes and operation phases; remove sensitive data.\n        validations:\n            required: true',
            ),
    };
    assert.equal(validateIssueBody(bugBody, ['template: bug-report'], currentForms).status, 'skipped');
    const changedBody = bugBody
        .replace('### Host version', '### Installed host release')
        .replace('Codex Desktop', 'My Custom Host');
    const requiredResult = validateIssueBody(changedBody, ['template: defect'], currentForms);
    assert.equal(requiredResult.status, 'invalid');
    assert.match(requiredResult.diagnostics.join('\n'), /Redacted errors.*required|required.*Redacted errors/i);
    assert.equal(
        validateIssueBody(
            changedBody.replace('_No response_', 'Redacted code: timeout.'),
            ['template: defect'],
            currentForms,
        ).status,
        'valid',
    );
    assert.equal(validateIssueBody(bugBody, ['template: defect'], currentForms).status, 'invalid');
    const reorderedForms = {
        ...forms,
        featureRequest: forms.featureRequest
            .replace('label: Problem or use case', 'label: Proposed behavior')
            .replace(
                'label: Proposed behavior\n        validations',
                'label: Problem or use case\n        validations',
            ),
    };
    assert.equal(feature(featureBody, reorderedForms).status, 'invalid');
    assert.equal(
        feature(
            featureBody
                .replace('### Problem or use case', '### Proposed behavior')
                .replace('### Proposed behavior\n\nShow', '### Problem or use case\n\nShow'),
            reorderedForms,
        ).status,
        'valid',
    );
    assert.equal(
        bug(bugBody.replace('Windows 11', '_No response_'), {
            ...forms,
            bugReport: forms.bugReport.replace('required: true', 'required: false'),
        }).status,
        'valid',
    );
    assert.equal(
        bug(bugBody, {
            ...forms,
            bugReport: forms.bugReport.replace(
                "    - 'template: bug-report'",
                "    - bug\n    - 'template: bug-report'",
            ),
        }).status,
        'valid',
    );
});

test('optional dropdowns accept empty and No response while preserving exact options for provided answers', () => {
    const currentForms = {
        ...forms,
        bugReport: forms.bugReport.replace(
            '                - Claude Code\n                - Other\n        validations:\n            required: true',
            '                - Claude Code\n                - Other\n        validations:\n            required: false',
        ),
    };
    assert.equal(bug(bugBody.replace('Codex Desktop', '_No response_'), currentForms).status, 'valid');
    assert.equal(bug(bugBody.replace('Codex Desktop', ''), currentForms).status, 'valid');
    assert.equal(bug(bugBody.replace('Codex Desktop', 'Codex'), currentForms).status, 'invalid');
});

test('optional dropdown No response exemption applies only to empty or plain marker content', async (context) => {
    const currentForms = {
        ...forms,
        bugReport: forms.bugReport.replace(
            '                - Claude Code\n                - Other\n        validations:\n            required: true',
            '                - Claude Code\n                - Other\n        validations:\n            required: false',
        ),
    };
    for (const answer of [
        '',
        '_No response_',
        'No response',
        '**No response**',
        '<!-- empty -->',
        '<!-- hint -->\n_No response_',
        '<!-- hint -->_No response_',
    ]) {
        await context.test(`empty/plain ${JSON.stringify(answer)}`, () => {
            assert.equal(bug(bugBody.replace('Codex Desktop', answer), currentForms).status, 'valid');
        });
    }
    for (const answer of [
        '- [x] _No response_',
        '- [ ] _No response_',
        '1. [ ] _No response_',
        '```text\n_No response_\n```',
        '> _No response_',
        '    _No response_',
        '- [ ]',
        '- [ ] ',
        '_No response_\n\n_No response_',
    ]) {
        await context.test(`supplied markup ${JSON.stringify(answer)}`, () => {
            const result = bug(bugBody.replace('Codex Desktop', answer), currentForms);
            assert.equal(result.status, 'invalid');
            assert.match(result.diagnostics.join('\n'), /Agent host.*option|option.*Agent host/i);
        });
    }
});

test('form configuration errors are distinct from user-body diagnostics, including ordinary Issues', () => {
    assert.throws(
        () => validateIssueBody('ordinary', [], { ...forms, bugReport: 'body: [\n' }),
        IssueFormConfigurationError,
    );
    assert.throws(() => feature(featureBody, { ...forms, bugReport: 'null\n' }), IssueFormConfigurationError);
});

test('fails closed on duplicate YAML keys, malformed labels/body/options and unknown supported-profile structure', async (context) => {
    const changes = [
        ['duplicate YAML key', forms.bugReport.replace('name: Bug report', 'name: Bug report\nname: Duplicate')],
        ['missing classification label', forms.bugReport.replace("    - 'template: bug-report'", '    - bug')],
        ['malformed labels', forms.bugReport.replace("    - 'template: bug-report'", '    - 7')],
        ['padded label', forms.bugReport.replace('template: bug-report', 'template: bug-report ')],
        [
            'duplicate labels',
            forms.bugReport.replace(
                "    - 'template: bug-report'",
                "    - 'template: bug-report'\n    - 'template: bug-report'",
            ),
        ],
        [
            'two classification labels',
            forms.bugReport.replace(
                "    - 'template: bug-report'",
                "    - 'template: bug-report'\n    - 'template: other'",
            ),
        ],
        ['reserved diagnostic label', forms.bugReport.replace('template: bug-report', 'template: invalid')],
        ['malformed body', `${forms.bugReport.slice(0, forms.bugReport.indexOf('body:'))}body: invalid\n`],
        ['no response fields', 'name: Empty\ndescription: Empty\nlabels: ["template: empty"]\nbody: []\n'],
        [
            'malformed options',
            forms.bugReport.replace(
                'options:\n                - Codex Desktop\n                - Codex CLI\n                - Claude Code\n                - Other',
                'options: invalid',
            ),
        ],
        [
            'empty options',
            forms.bugReport.replace(
                'options:\n                - Codex Desktop\n                - Codex CLI\n                - Claude Code\n                - Other',
                'options: []',
            ),
        ],
        ['duplicate options', forms.bugReport.replace('- Codex CLI', '- Codex Desktop')],
        ['nonstring option', forms.bugReport.replace('- Codex CLI', '- 7')],
        ['duplicate ID', forms.bugReport.replace('id: host-version', 'id: agent-host')],
        ['duplicate heading', forms.bugReport.replace('label: Host version', 'label: Agent host')],
        ['missing ID', forms.bugReport.replace('        id: host-version\n', '')],
        ['malformed ID', forms.bugReport.replace('id: host-version', 'id: host version')],
        ['missing label', forms.bugReport.replace('            label: Host version\n', '')],
        [
            'multiline heading',
            forms.bugReport.replace('label: Host version', 'label: |\n                Host\n                version'),
        ],
        [
            'malformed attributes',
            forms.bugReport.replace(
                'attributes:\n            label: Operating system and version\n            placeholder: Windows 11, Ubuntu 24.04, or macOS 15',
                'attributes: invalid',
            ),
        ],
        ['unsupported checkboxes', forms.bugReport.replace('type: input', 'type: checkboxes')],
        ['unknown field type', forms.bugReport.replace('type: input', 'type: future-control')],
        ['malformed required flag', forms.bugReport.replace('required: true', 'required: "true"')],
        ['unknown validation structure', forms.bugReport.replace('required: true', 'minimum: 1')],
        [
            'unknown attribute structure',
            forms.bugReport.replace('label: Host version', 'label: Host version\n            unknown: true'),
        ],
        ['multiple dropdown', forms.bugReport.replace('options:', 'multiple: true\n            options:')],
        [
            'empty static Markdown',
            forms.bugReport.replace(
                'value: |\n                Report suspected vulnerabilities through the private channel in SECURITY.md.\n                Remove tokens, private commit content and personal paths from all examples.',
                'value: ""',
            ),
        ],
    ];
    for (const [name, source] of changes) {
        await context.test(name ?? 'malformed form', () => {
            assert.throws(
                () => bug(bugBody, { ...forms, bugReport: source ?? '' }),
                (error: unknown) => {
                    assert.ok(error instanceof IssueFormConfigurationError);
                    assert.match(error.message, /bug.report|bugReport/i);
                    assert.match(
                        error.message,
                        /label|body|option|ID|heading|type|required|validation|attribute|markdown|YAML/i,
                    );
                    return true;
                },
            );
        });
    }
});

test('rejects colliding classification labels across forms', () => {
    assert.throws(
        () =>
            bug(bugBody, {
                ...forms,
                featureRequest: forms.featureRequest.replace('template: feature-request', 'template: bug-report'),
            }),
        IssueFormConfigurationError,
    );
});

test('Issue forms share the owned YAML1.2/core profile before content classification', () => {
    for (const source of [
        `%YAML 1.1\n---\n${forms.bugReport}`,
        `%TAG !e! tag:example.com,2026:\n---\n${forms.bugReport}`,
        `${forms.bugReport}\ntrue: value\n`,
        forms.bugReport.replace('name: Bug report', 'name: !unapproved Bug report'),
        `${forms.bugReport}\n---\nname: Extra document\n`,
    ])
        assert.throws(
            () => validateIssueBody('ordinary', [], { ...forms, bugReport: source }),
            IssueFormConfigurationError,
        );
});

test('supported dropdown default and static profile options are validated as configuration', () => {
    const withDefault = forms.bugReport.replace(
        '            options:',
        '            multiple: false\n            default: 0\n            options:',
    );
    assert.equal(bug(bugBody, { ...forms, bugReport: withDefault }).status, 'valid');
    for (const value of ['-1', '999', '0.5', '"0"']) {
        assert.throws(
            () => bug(bugBody, { ...forms, bugReport: withDefault.replace('default: 0', `default: ${value}`) }),
            IssueFormConfigurationError,
        );
    }
});

test('round1 closed and unclosed indented HTML output answers required text without hiding later form headings', () => {
    for (const answer of [
        '    <!-- actual emitted diagnostic E1234 -->',
        '    <!-- actual emitted diagnostic E1234',
        '    <!--\n    actual emitted diagnostic E1234\n    -->',
        '    <!--\n    actual emitted diagnostic E1234',
    ]) {
        assert.equal(bug(bugBody.replace('Validation reports an attribution error.', answer)).status, 'valid', answer);
    }
});

test('round1 enclosing prose comment state still hides indented output and apparent fields', () => {
    for (const answer of [
        '<!-- prose only -->',
        '<!-- prose starts\n    actual emitted diagnostic E1234\n-->',
        '<!-- prose starts\n    actual emitted diagnostic E1234\n### Fake field\n-->',
    ]) {
        assert.equal(
            bug(bugBody.replace('Validation reports an attribution error.', answer)).status,
            'invalid',
            answer,
        );
    }
});
