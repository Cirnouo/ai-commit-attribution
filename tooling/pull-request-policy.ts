import {
    normalizeSubmissionText,
    readSubmissionChecklist,
    readSubmissionHeading,
    scanSubmissionMarkdown,
} from './submission-markdown.ts';

export function validatePullRequestBody(body: string | null, template: string): string[] {
    const expected = scanSubmissionMarkdown(template).filter((section) => section.heading !== null);
    if (expected.length === 0) throw new Error('The current pull request template has no H2 sections.');
    const scanned = scanSubmissionMarkdown(body ?? '');
    const actual = scanned.filter((section) => section.heading !== null);
    const placeholders = expected
        .flatMap((section) => section.paragraphs)
        .map((paragraph) => normalizeSubmissionText(paragraph.text));
    const templateExamples = template.split(/\r?\n[ \t]*\r?\n/u).map(normalizeSubmissionText);
    const templateHeadings = expected.map((section) => section.heading);
    const templateLabels = expected.flatMap((section) => section.checklists).map((check) => check.label);
    const errors: string[] = [];
    if (
        expected.length !== actual.length ||
        expected.some((section, index) => section.heading !== actual[index]?.heading)
    ) {
        errors.push('Pull request body must preserve every template H2 section exactly once and in order.');
    }
    for (const section of expected) {
        const matches = actual.filter((candidate) => candidate.heading === section.heading);
        if (matches.length !== 1) continue;
        const candidate = matches[0];
        if (!candidate) continue;
        const canonicalLabels = section.checklists.map((check) => check.label);
        const matchedLabels = candidate.checklists
            .filter((check) => canonicalLabels.includes(check.label))
            .map((check) => check.label);
        if (
            matchedLabels.length !== canonicalLabels.length ||
            canonicalLabels.some((label, index) => matchedLabels[index] !== label)
        ) {
            errors.push(`Pull request body: ${section.heading} must preserve its template checklists once in order.`);
        }
        for (const check of section.checklists) {
            const allOccurrences = scanned
                .flatMap((entry) => entry.checklists)
                .filter((item) => item.label === check.label);
            const occurrences = candidate.checklists.filter((item) => item.label === check.label);
            if (allOccurrences.length !== 1 || occurrences.length !== 1) {
                errors.push(`Pull request body: checklist must occur once in ${section.heading}: ${check.label}`);
                continue;
            }
            const item = occurrences[0];
            if (!item || item.selected) continue;
            const conditional = check.label.includes('when applicable');
            const reason = item.continuations[0];
            if (!conditional || !reason || !/^N\/A:\s*\S/u.test(reason)) {
                errors.push(
                    `Pull request body: checklist must be selected${conditional ? ' or have an adjacent indented N/A: reason' : ''}: ${check.label}`,
                );
            }
        }
        // Keep literal output literal: TAP counters can resemble Markdown
        // headings. Exclude only copied template examples and whole starters.
        const hasContent = candidate.paragraphs.some(({ text, literal }) =>
            text.split(/\r?\n[ \t]*\r?\n/u).some((block) => {
                const normalized = normalizeSubmissionText(block);
                if (!normalized || placeholders.includes(normalized)) return false;
                if (!literal) return true;
                if (templateExamples.includes(normalized)) return false;
                const proseRuns: string[] = [];
                let run: string[] = [];
                const finishRun = () => {
                    const value = normalizeSubmissionText(run.join('\n'));
                    if (value) proseRuns.push(value);
                    run = [];
                };
                const lines = block.split(/\r?\n/u);
                for (let index = 0; index < lines.length; index += 1) {
                    const line = lines[index];
                    if (line === undefined) continue;
                    const heading = readSubmissionHeading(line.trimStart());
                    const check = readSubmissionChecklist(line.trimStart());
                    let copiedCheckEnd = index;
                    let copiedLabel = check?.label ?? '';
                    while (
                        check &&
                        !templateLabels.includes(copiedLabel) &&
                        templateLabels.some((label) => !copiedLabel || label.startsWith(`${copiedLabel} `))
                    ) {
                        const continuation = lines[copiedCheckEnd + 1];
                        if (continuation === undefined) break;
                        copiedCheckEnd += 1;
                        copiedLabel = normalizeSubmissionText(`${copiedLabel} ${continuation}`);
                    }
                    if (
                        (heading && templateHeadings.includes(heading.text)) ||
                        (check && templateLabels.includes(copiedLabel))
                    ) {
                        // Canonical copied structure ends a starter paragraph even
                        // when blank lines are removed or its logical label wraps.
                        finishRun();
                        index = copiedCheckEnd;
                    } else {
                        run.push(line);
                    }
                }
                finishRun();
                return proseRuns.some((value) => !placeholders.includes(value) && !templateExamples.includes(value));
            }),
        );
        if (section.paragraphs.length > 0 && !hasContent) {
            errors.push(
                `Pull request body: ${section.heading} needs content or evidence beyond template starter prose.`,
            );
        }
    }
    return errors;
}
