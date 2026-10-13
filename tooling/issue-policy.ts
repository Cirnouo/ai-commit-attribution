import { parseOwnedYaml } from './owned-yaml.ts';
import { normalizeSubmissionText, scanSubmissionMarkdown } from './submission-markdown.ts';

export const ISSUE_INVALID_LABEL = 'template: invalid';

export interface IssueFormSources {
    bugReport: string;
    featureRequest: string;
}

export type IssueTemplate = 'bug-report' | 'feature-request';

export type IssueBodyResult =
    | { status: 'skipped'; template: null; diagnostics: string[] }
    | { status: 'valid'; template: IssueTemplate; diagnostics: string[] }
    | { status: 'invalid'; template: IssueTemplate | null; diagnostics: string[] };

interface IssueField {
    heading: string;
    required: boolean;
    options: string[] | null;
}

interface IssueForm {
    template: IssueTemplate;
    label: string;
    fields: IssueField[];
}

export class IssueFormConfigurationError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'IssueFormConfigurationError';
    }
}

function configurationError(location: string, message: string): never {
    throw new IssueFormConfigurationError(`${location}: ${message}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function record(value: unknown, location: string): Record<string, unknown> {
    if (!isRecord(value)) {
        configurationError(location, 'must be a mapping.');
    }
    return value;
}

function knownKeys(value: Record<string, unknown>, allowed: readonly string[], location: string) {
    for (const key of Object.keys(value)) {
        if (!allowed.includes(key)) configurationError(location, `unsupported property ${key}.`);
    }
}

function string(value: unknown, location: string): string {
    if (typeof value !== 'string') configurationError(location, 'must be a string.');
    return value;
}

function nonemptyString(value: unknown, location: string): string {
    const result = string(value, location);
    if (!result.trim()) configurationError(location, 'must be nonempty.');
    return result;
}

function stringArray(value: unknown, location: string): string[] {
    if (!Array.isArray(value) || value.length === 0) configurationError(location, 'must be a nonempty array.');
    const strings = value.map((entry: unknown) => nonemptyString(entry, location));
    if (new Set(strings).size !== strings.length) configurationError(location, 'must not contain duplicates.');
    return strings;
}

function parseIssueForm(source: string, template: IssueTemplate, location: string): IssueForm {
    let parsed: unknown;
    try {
        parsed = parseOwnedYaml(source, { name: location, documents: 'single' })[0];
    } catch (error) {
        if (error instanceof IssueFormConfigurationError) throw error;
        configurationError(location, `invalid YAML: ${error instanceof Error ? error.message : String(error)}`);
    }
    const form = record(parsed, location);
    knownKeys(form, ['name', 'description', 'title', 'labels', 'assignees', 'body'], location);
    nonemptyString(form.name, `${location}.name`);
    nonemptyString(form.description, `${location}.description`);
    if (form.title !== undefined) string(form.title, `${location}.title`);
    if (form.assignees !== undefined) stringArray(form.assignees, `${location}.assignees`);
    const labels = stringArray(form.labels, `${location}.labels`);
    if (labels.some((label) => label !== label.trim() || /[\r\n]/u.test(label))) {
        configurationError(`${location}.labels`, 'labels must be single-line strings without surrounding whitespace.');
    }
    if (labels.includes(ISSUE_INVALID_LABEL))
        configurationError(`${location}.labels`, `${ISSUE_INVALID_LABEL} is reserved for diagnostics.`);
    const classificationLabels = labels.filter((label) => label.startsWith('template: '));
    if (classificationLabels.length !== 1 || !classificationLabels[0]?.slice('template: '.length).trim()) {
        configurationError(`${location}.labels`, 'must contain exactly one template: classification label.');
    }
    const label = classificationLabels[0];
    if (!label) configurationError(`${location}.labels`, 'classification label is missing.');
    if (!Array.isArray(form.body)) configurationError(`${location}.body`, 'must be an array of fields.');
    const ids = new Set<string>();
    const headings = new Set<string>();
    const fields: IssueField[] = [];
    for (const [index, entry] of form.body.entries()) {
        const fieldLocation = `${location}.body[${index}]`;
        const field = record(entry, fieldLocation);
        knownKeys(field, ['type', 'id', 'attributes', 'validations'], fieldLocation);
        const type = string(field.type, `${fieldLocation}.type`);
        const attributes = record(field.attributes, `${fieldLocation}.attributes`);
        if (type === 'markdown') {
            knownKeys(field, ['type', 'attributes'], fieldLocation);
            knownKeys(attributes, ['value'], `${fieldLocation}.attributes`);
            nonemptyString(attributes.value, `${fieldLocation}.attributes.value (markdown)`);
            continue;
        }
        if (type !== 'input' && type !== 'textarea' && type !== 'dropdown') {
            configurationError(`${fieldLocation}.type`, `unsupported control type ${type}.`);
        }
        const id = nonemptyString(field.id, `${fieldLocation}.ID`);
        if (!/^[a-zA-Z0-9_-]+$/u.test(id))
            configurationError(`${fieldLocation}.ID`, 'must use letters, numbers, hyphens, or underscores.');
        if (ids.has(id)) configurationError(`${fieldLocation}.ID`, `duplicate ID ${id}.`);
        ids.add(id);
        const fieldLabel = nonemptyString(attributes.label, `${fieldLocation}.attributes.label`);
        if (/[\r\n]/u.test(fieldLabel))
            configurationError(`${fieldLocation}.attributes.label`, 'field headings must be single-line labels.');
        const heading = normalizeSubmissionText(fieldLabel);
        if (headings.has(heading))
            configurationError(`${fieldLocation}.attributes.label`, `duplicate heading ${heading}.`);
        headings.add(heading);
        let required = false;
        if (field.validations !== undefined) {
            const validations = record(field.validations, `${fieldLocation}.validations`);
            knownKeys(validations, ['required'], `${fieldLocation}.validations`);
            if (typeof validations.required !== 'boolean')
                configurationError(`${fieldLocation}.validations.required`, 'must be a boolean.');
            required = validations.required;
        }
        if (type === 'dropdown') {
            knownKeys(
                attributes,
                ['label', 'description', 'options', 'multiple', 'default'],
                `${fieldLocation}.attributes`,
            );
            if (attributes.description !== undefined)
                string(attributes.description, `${fieldLocation}.attributes.description`);
            if (attributes.multiple !== undefined && attributes.multiple !== false)
                configurationError(
                    `${fieldLocation}.attributes.multiple`,
                    'only single-choice dropdowns are supported.',
                );
            const options = stringArray(attributes.options, `${fieldLocation}.attributes.options`);
            if (
                attributes.default !== undefined &&
                (!Number.isInteger(attributes.default) ||
                    typeof attributes.default !== 'number' ||
                    attributes.default < 0 ||
                    attributes.default >= options.length)
            ) {
                configurationError(`${fieldLocation}.attributes.default`, 'must be an existing option index.');
            }
            fields.push({ heading, required, options });
        } else {
            const allowed = [
                'label',
                'description',
                'placeholder',
                'value',
                ...(type === 'textarea' ? ['render'] : []),
            ];
            knownKeys(attributes, allowed, `${fieldLocation}.attributes`);
            for (const key of allowed.filter((key) => key !== 'label')) {
                if (attributes[key] !== undefined) string(attributes[key], `${fieldLocation}.attributes.${key}`);
            }
            fields.push({ heading, required, options: null });
        }
    }
    if (fields.length === 0) configurationError(`${location}.body`, 'must contain response fields.');
    return { template, label, fields };
}

function isNoResponse(text: string): boolean {
    return /^(?:_?No response_?|\*{1,2}No response\*{1,2})$/iu.test(normalizeSubmissionText(text));
}

function hasResponse(text: string, literal = false): boolean {
    if (!normalizeSubmissionText(text) || isNoResponse(text)) return false;
    if (literal) return true;
    // Empty prose task markers are not answers. Literal output
    // retains its meaning instead of being rescanned as Markdown formatting.
    return text.split(/\r?\n/u).some((line) => {
        const content = line.trim();
        return Boolean(content) && !isNoResponse(content) && !/^(?:[-+*]|\d+[.)])\s+\[[ xX]\]$/u.test(content);
    });
}

export function validateIssueBody(
    body: string | null,
    labels: readonly string[],
    forms: IssueFormSources,
): IssueBodyResult {
    // Configuration failures belong to automation, including runs for ordinary Issues.
    const parsed = [
        parseIssueForm(forms.bugReport, 'bug-report', 'bugReport Issue form'),
        parseIssueForm(forms.featureRequest, 'feature-request', 'featureRequest Issue form'),
    ];
    if (parsed[0]?.label === parsed[1]?.label)
        configurationError('Issue form labels', 'classification labels must be distinct across forms.');
    const matching = parsed.filter((form) => labels.includes(form.label));
    if (matching.length === 0) return { status: 'skipped', template: null, diagnostics: [] };
    if (matching.length > 1) {
        return {
            status: 'invalid',
            template: null,
            diagnostics: [
                'Issue classification is ambiguous: both form template labels are present. Keep only the corresponding label.',
            ],
        };
    }
    const form = matching[0];
    if (!form) throw new Error('Issue classification did not select a form.');
    const actual = scanSubmissionMarkdown(body ?? '', { sectionLevel: 3 }).filter(
        (section) => section.heading !== null,
    );
    const diagnostics: string[] = [];
    if (
        actual.length !== form.fields.length ||
        form.fields.some((field, index) => actual[index]?.heading !== field.heading)
    ) {
        diagnostics.push(
            `Issue body must preserve every ${form.template} form H3 field heading exactly once and in order: ${form.fields.map((field) => field.heading).join('; ')}.`,
        );
    }
    for (const field of form.fields) {
        const matches = actual.filter((section) => section.heading === field.heading);
        if (matches.length !== 1) continue;
        const section = matches[0];
        if (!section) continue;
        const answered =
            section.paragraphs.some(({ text, literal }) => hasResponse(text, literal)) ||
            section.checklists.some((check) => hasResponse([check.label, ...check.continuations].join('\n')));
        if (field.required && !answered)
            diagnostics.push(
                `Issue body: ${field.heading} requires a nonempty response; _No response_ does not satisfy a required field.`,
            );
        if (field.options) {
            const answer = section.paragraphs[0];
            const plain =
                section.paragraphs.length === 1 &&
                section.checklists.length === 0 &&
                answer !== undefined &&
                !answer.literal;
            const emptyOptional =
                !field.required &&
                section.checklists.length === 0 &&
                (section.paragraphs.length === 0 || (plain && isNoResponse(answer.text)));
            const exactOption = plain && field.options.includes(answer.text);
            if (!emptyOptional && !exactOption) {
                diagnostics.push(
                    `Issue body: ${field.heading} must be exactly one dropdown option: ${field.options.join('; ')}.`,
                );
            }
        }
    }
    return diagnostics.length > 0
        ? { status: 'invalid', template: form.template, diagnostics }
        : { status: 'valid', template: form.template, diagnostics };
}
