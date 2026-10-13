import type { SyncRule } from '@commitlint/types';

const genericTrailer = /^([\w-]+)(?::\s+\S|\s+#\S)/;
const breakingTrailer = /^(?:\*\s+)?BREAKING[ -]CHANGE:/i;
const closingTrailer = /^(?:close[sd]?|fix(?:es|ed)?|resolve[sd]?):?\s+(?:[\w.-]+\/[\w.-]+)?#\d+(?=\s|$|[,;.)\]])/i;

// Enforce the repository's configured `always` policy using original line boundaries.
export const footerLeadingBlank: SyncRule = (parsed) => {
    if (typeof parsed.raw !== 'string') return [false, 'raw commit message is required'];
    const lines = parsed.raw.split(/\r?\n/);
    const headerIndex = lines.findIndex((line) => line.trim().length > 0);
    let afterHeader = true;
    let precedingBlank = false;
    let footerStarted = false;

    for (const line of lines.slice(headerIndex + 1)) {
        if (line.trim().length === 0) {
            precedingBlank = true;
            continue;
        }
        if (afterHeader && !precedingBlank) return [false, 'body or footer must have leading blank line'];
        afterHeader = false;

        const token = genericTrailer.exec(line)?.[1];
        const explicitFooter =
            breakingTrailer.test(line) ||
            closingTrailer.test(line) ||
            (token !== undefined && (token.toLowerCase() === 'refs' || token.includes('-')));
        if (!footerStarted && explicitFooter && !precedingBlank) {
            return [false, 'footer must have leading blank line'];
        }
        if (precedingBlank && (explicitFooter || token !== undefined)) footerStarted = true;
        precedingBlank = false;
    }
    return [true];
};

/** Validate original line boundaries before commitlint normalizes trailers. */
export function validateRawMessage(raw: string): string[] {
    const errors: string[] = [];
    if (/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(raw))
        errors.push('Commit message contains prohibited control characters.');
    if (/\r(?!\n)/.test(raw)) errors.push('Commit message contains a bare carriage return.');
    const lines = raw.split(/\r?\n/);
    let structuredStarted = false;
    let previousBlank = false;
    for (const [index, line] of lines.entries()) {
        if (!line.trim()) {
            previousBlank = true;
            continue;
        }
        const token = genericTrailer.exec(line)?.[1];
        const breaking = breakingTrailer.test(line);
        const completeBreaking = /^BREAKING[ -]CHANGE:\s+\S.*$/.test(line);
        const explicit =
            closingTrailer.test(line) ||
            (token !== undefined && (token.toLowerCase() === 'refs' || token.includes('-')));
        const structured =
            (!breaking || completeBreaking) &&
            index > 0 &&
            (token !== undefined || closingTrailer.test(line) || completeBreaking) &&
            (structuredStarted || previousBlank || explicit || completeBreaking);
        if (index > 0 && structured && !structuredStarted && !previousBlank)
            errors.push('Footer must have leading blank line.');
        if (structured) structuredStarted = true;
        else if (structuredStarted)
            errors.push('Structured trailers must each occupy a single line at the end of the message.');
        if (line.length > 100 && !structured) errors.push('Title and plain body lines must not exceed 100 characters.');
        previousBlank = false;
    }
    return errors;
}
