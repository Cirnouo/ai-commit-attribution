export interface SubmissionChecklist {
    label: string;
    selected: boolean;
    continuations: string[];
}

export interface SubmissionSection {
    heading: string | null;
    paragraphs: SubmissionParagraph[];
    checklists: SubmissionChecklist[];
}

export interface SubmissionParagraph {
    text: string;
    literal: boolean;
}

export function normalizeSubmissionText(text: string) {
    return text.replace(/\s+/gu, ' ').trim();
}

export function readSubmissionHeading(line: string) {
    const match = /^ {0,3}(#{1,6})(?:\s+|$)(.*?)\s*$/u.exec(line);
    if (!match?.[1]) return undefined;
    return {
        level: match[1].length,
        text: normalizeSubmissionText((match[2] ?? '').replace(/\s+#+\s*$/u, '')),
    };
}

export function readSubmissionChecklist(line: string): SubmissionChecklist | undefined {
    const match = /^ {0,3}(?:[-+*]|\d+[.)])\s+\[([ xX])\]\s+(.*)$/u.exec(line);
    if (!match) return undefined;
    return { label: normalizeSubmissionText(match[2] ?? ''), selected: match[1] !== ' ', continuations: [] };
}

/** Scan only submission structure and content; this is not a Markdown renderer. */
export function scanSubmissionMarkdown(source: string, { sectionLevel = 2 } = {}): SubmissionSection[] {
    let section: SubmissionSection = { heading: null, paragraphs: [], checklists: [] };
    const sections: SubmissionSection[] = [section];
    let paragraph: string[] = [];
    let paragraphIsProse = true;
    let paragraphIsLiteral = false;
    let checklist: SubmissionChecklist | undefined;
    let fence: { marker: string; length: number } | undefined;
    let inComment = false;
    const flushParagraph = () => {
        const text = paragraph.join('\n').trim();
        if (text) section.paragraphs.push({ text, literal: paragraphIsLiteral });
        paragraph = [];
        paragraphIsProse = true;
        paragraphIsLiteral = false;
    };
    const appendLine = (line: string, literal: boolean) => {
        // A quote paragraph can also continue lazily without a new > marker.
        paragraphIsLiteral ||= literal;
        paragraph.push(line);
        if (literal) paragraphIsProse = false;
    };
    const beginSection = (heading: string) => {
        section = { heading: normalizeSubmissionText(heading), paragraphs: [], checklists: [] };
        sections.push(section);
    };
    const visibleLine = (line: string) => {
        let visible = '';
        let remaining = line;
        while (remaining) {
            const marker = inComment ? '-->' : '<!--';
            const index = remaining.indexOf(marker);
            if (index < 0) {
                visible += inComment ? ' '.repeat(remaining.length) : remaining;
                break;
            }
            visible += inComment ? ' '.repeat(index) : remaining.slice(0, index);
            visible += ' '.repeat(marker.length);
            remaining = remaining.slice(index + marker.length);
            inComment = !inComment;
        }
        return visible;
    };
    for (const original of source.split(/\r?\n/u)) {
        if (fence) {
            const close = /^ {0,3}(`{3,}|~{3,})\s*$/u.exec(original);
            if (close?.[1]?.[0] === fence.marker && close[1].length >= fence.length) {
                flushParagraph();
                fence = undefined;
            } else {
                appendLine(original, true);
            }
            continue;
        }
        const line = visibleLine(original);
        if (!line.trim()) {
            flushParagraph();
            checklist = undefined;
            continue;
        }
        const open = /^ {0,3}(`{3,}|~{3,})(.*)$/u.exec(line);
        if (open?.[1] && (open[1][0] === '~' || !open[2]?.includes('`'))) {
            flushParagraph();
            checklist = undefined;
            fence = { marker: open[1][0] ?? '', length: open[1].length };
            continue;
        }
        // Quotes and indented code provide evidence, never canonical structure.
        // A list paragraph can wrap lazily without indentation. Actual block
        // boundaries cannot continue its label; N/A reasons still need indentation.
        if (
            checklist &&
            !/^\s*(?:#{1,6}(?:\s|$)|>|(?:[-+*]|\d+[.)])\s)/u.test(line) &&
            !/^\s*(?:`{3,}|~{3,})/u.test(line) &&
            !/^\s*(?:=+|-+|\*(?:\s*\*){2,}|_(?:\s*_){2,})\s*$/u.test(line)
        ) {
            const continuation = line.trim();
            if (/^ {2,}\S/u.test(original) && (/^N\/A:/u.test(continuation) || checklist.continuations.length > 0)) {
                checklist.continuations.push(continuation);
            } else {
                checklist.label = normalizeSubmissionText(`${checklist.label} ${continuation}`);
            }
            continue;
        }
        checklist = undefined;
        if (/^ {0,3}>/u.test(line)) {
            appendLine(line.replace(/^ {0,3}(?:>\s*)+/u, ''), true);
            continue;
        }
        // Comment masking preserves columns for structure, but those inserted
        // spaces cannot turn originally unindented prose into literal code.
        if (/^(?: {4}|\t)/u.test(original)) {
            appendLine(line.trim(), true);
            continue;
        }
        const setext = /^ {0,3}(=+|-+)\s*$/u.exec(line);
        if (setext?.[1] && paragraph.length > 0 && paragraphIsProse) {
            const title = paragraph.join('\n');
            paragraph = [];
            flushParagraph();
            if ((setext[1][0] === '=' ? 1 : 2) === sectionLevel) beginSection(title);
            continue;
        }
        if (/^ {0,3}(?:\*(?:\s*\*){2,}|-(?:\s*-){2,}|_(?:\s*_){2,})\s*$/u.test(line)) {
            flushParagraph();
            continue;
        }
        const heading = readSubmissionHeading(line);
        if (heading) {
            flushParagraph();
            if (heading.level === sectionLevel) {
                beginSection(heading.text);
            }
            continue;
        }
        const check = readSubmissionChecklist(line);
        if (check) {
            flushParagraph();
            checklist = check;
            section.checklists.push(checklist);
            continue;
        }
        appendLine(line, false);
        if (/^ {0,3}(?:[-+*]|\d+[.)])\s/u.test(line)) paragraphIsProse = false;
    }
    flushParagraph();
    return sections;
}
