import path from 'node:path';

/** Fence validity is independent of the caller's allowed indentation. */
function fenceToken(line: string) {
    const match = /^( *)(`{3,}|~{3,})([^\r\n]*)/.exec(line);
    if (!match) return;
    const [, spaces = '', run = '', tail = ''] = match;
    if (run.startsWith('`') && tail.includes('`')) return;
    return { indentation: spaces.length, marker: run[0] ?? '', length: run.length, tail };
}

/** A finite prose profile, independent of policy meaning and file observation. */
export function proseEvidence(locator: string, sourceKind: string): boolean {
    if (sourceKind === 'message-hook' || sourceKind === 'git-configuration') return false;
    const extension = path.extname(locator).toLowerCase();
    if (['', '.md', '.markdown', '.txt'].includes(extension)) return true;
    // An explicit text template may use an arbitrary suffix. Known structured
    // and source/configuration formats remain data even when configured as one.
    return (
        sourceKind === 'commit-template' &&
        !/^(?:\.(?:jsonc?|jsonl|ya?ml|[cm]?[jt]sx?|sh|bash|zsh|fish|ps1|psm1|psd1|bat|cmd|py|rb|pl|php|go|rs|java|[ch](?:pp|xx)?|cs|swift|kt|lua|sql|toml|ini|cfg|conf|config|xml|html?|css|scss|less|svg))$/.test(
            extension,
        )
    );
}

/** Lexical inline-link extraction; raw evidence bytes are never changed. */
export function markdownReferenceTargets(source: string): string[] {
    if (source.startsWith('#!')) return [];
    let fence: { marker: string; length: number } | undefined;
    let comment = false;
    let listIndent = 0;
    let inlineEnd = 0;
    let offset = 0;
    const lines = source.split(/(?<=\n)/).map((original) => {
        const start = offset;
        offset += original.length;
        const line = original.replace(/^(?: {0,3}>[ \t]?)+/, '');
        const lineStart = start + original.length - line.length;
        const listPrefix = /^( {0,3})(?:[-+*]|\d+[.)])([ \t]+)/.exec(line)?.[0];
        const bareFence = fenceToken(line);
        const listFence = listPrefix ? fenceToken(line.slice(listPrefix.length)) : undefined;
        // Under any frozen list context, a valid bare token is either a fence
        // after stripping continuation indentation or an indented code block.
        const fenceStart = Boolean(bareFence || (listFence && listFence.indentation <= 3));
        return { original, line, lineStart, fenceStart };
    });
    // Index equal-length runs once within prose paragraphs. A code block or
    // blank line interrupts a paragraph, so its ticks cannot close an earlier
    // unmatched prose opener. Never rescan every remaining document suffix.
    const next = new Map<number, { index: number; line: number }>();
    const last = new Map<number, { index: number; line: number }>();
    for (let lineIndex = lines.length - 1; lineIndex >= 0; lineIndex--) {
        const { line, lineStart, fenceStart } = lines[lineIndex] ?? { line: '', lineStart: 0, fenceStart: false };
        const boundary = !line.trim() || fenceStart;
        if (boundary) last.clear();
        for (const run of [...line.matchAll(/`+/g)].reverse()) {
            const index = lineStart + run.index;
            const following = last.get(run[0].length);
            if (following !== undefined) next.set(index, following);
            last.set(run[0].length, { index, line: lineIndex });
        }
        if (boundary) last.clear();
    }
    // A span freezes the current prose list context. Index indentation ranges
    // so matching across continuation lines can distinguish real code blocks
    // without letting literal list markers change that context or rescanning
    // document suffixes. Each query costs logarithmic work and bounded storage.
    const size = 2 ** Math.ceil(Math.log2(Math.max(1, lines.length)));
    const smallest = new Float64Array(size * 2).fill(Number.POSITIVE_INFINITY);
    const largest = new Float64Array(size * 2);
    for (const [i, { line }] of lines.entries()) {
        const indentation = line.startsWith('\t') ? Number.POSITIVE_INFINITY : (/^ +/.exec(line)?.[0].length ?? 0);
        if (indentation >= 4) smallest[size + i] = largest[size + i] = indentation;
    }
    for (let i = size - 1; i > 0; i--) {
        smallest[i] = Math.min(
            smallest[i * 2] ?? Number.POSITIVE_INFINITY,
            smallest[i * 2 + 1] ?? Number.POSITIVE_INFINITY,
        );
        largest[i] = Math.max(largest[i * 2] ?? 0, largest[i * 2 + 1] ?? 0);
    }
    const hasIndentedBlock = (from: number, to: number, indent: number): boolean => {
        let minimum = Number.POSITIVE_INFINITY;
        let maximum = 0;
        for (let left = size + from, right = size + to; left < right; left >>= 1, right >>= 1) {
            if (left % 2) {
                minimum = Math.min(minimum, smallest[left] ?? Number.POSITIVE_INFINITY);
                maximum = Math.max(maximum, largest[left] ?? 0);
                left++;
            }
            if (right % 2) {
                right--;
                minimum = Math.min(minimum, smallest[right] ?? Number.POSITIVE_INFINITY);
                maximum = Math.max(maximum, largest[right] ?? 0);
            }
        }
        return maximum >= indent + 4 || (indent > 4 && minimum < indent);
    };
    const prose: string[] = [];
    for (const [lineIndex, { original, line, lineStart }] of lines.entries()) {
        // Only visible prose may change list context. Comments, fenced bodies
        // and multiline spans must not lend their example markers to later code.
        const list =
            !comment && !fence && inlineEnd <= lineStart ? /^( {0,3})(?:[-+*]|\d+[.)])([ \t]+)/.exec(line) : null;
        const indent = list?.[0].length ?? listIndent;
        const content = list
            ? line.slice(list[0].length)
            : indent && line.startsWith(' '.repeat(indent))
              ? line.slice(indent)
              : line;
        const token = fenceToken(content);
        const marker = token && token.indentation <= 3 ? token : undefined;
        if (fence) {
            if (marker && marker.marker === fence.marker && marker.length >= fence.length && !marker.tail.trim())
                fence = undefined;
            prose.push(original.replace(/[^\r\n]/g, ' '));
            continue;
        }
        if (!comment && inlineEnd <= lineStart && marker) {
            if (list) listIndent = list[0].length;
            fence = { marker: marker.marker, length: marker.length };
            prose.push(original.replace(/[^\r\n]/g, ' '));
            continue;
        }
        if (!comment && inlineEnd <= lineStart && /^(?: {4}|\t)/.test(content)) {
            prose.push(original.replace(/[^\r\n]/g, ' '));
            continue;
        }
        let output = '';
        for (let i = 0; i < line.length; ) {
            if (lineStart + i < inlineEnd) {
                output += /[\r\n]/.test(line[i] ?? '') ? line[i] : ' ';
                i++;
            } else if (comment) {
                if (line.startsWith('-->', i)) {
                    output += '   ';
                    i += 3;
                    comment = false;
                } else {
                    output += /[\r\n]/.test(line[i] ?? '') ? line[i] : ' ';
                    i++;
                }
            } else if (line.startsWith('<!--', i)) {
                output += '    ';
                i += 4;
                comment = true;
            } else if (line[i] === '`') {
                let end = i + 1;
                while (line[end] === '`') end++;
                const closing = next.get(lineStart + i);
                if (closing !== undefined && !hasIndentedBlock(lineIndex + 1, closing.line + 1, indent)) {
                    inlineEnd = closing.index + end - i;
                    const stop = Math.min(line.length, inlineEnd - lineStart);
                    output += line.slice(i, stop).replace(/[^\r\n]/g, ' ');
                    i = stop;
                } else {
                    output += line.slice(i, end);
                    i = end;
                }
            } else {
                output += line[i];
                i++;
            }
        }
        if (list) listIndent = list[0].length;
        else if (output.trim() && !/^[ \t]/.test(line)) listIndent = 0;
        prose.push(output);
    }
    return [...prose.join('').matchAll(/\[[^\]]*\]\(([^\s)]+)(?:\s+"[^"]*")?\)/g)].map((match) => match[1] ?? '');
}
