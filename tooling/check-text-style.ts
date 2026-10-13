import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { isMainModule } from './cli-entry.ts';
import { errorMessage } from './errors.ts';
import { decodeText, validateTextStyle } from './repository-audit.ts';
export async function checkTextStyle(root: string, arguments_: readonly string[]) {
    const errors: string[] = [];
    for (const argument of arguments_) {
        const absolute = path.resolve(root, argument);
        const relative = path.relative(root, absolute).replaceAll('\\', '/');
        if (relative.startsWith('../') || path.isAbsolute(relative)) throw new Error('Text input escapes repository.');
        errors.push(...validateTextStyle(relative, decodeText(relative, await readFile(absolute))));
    }
    return errors;
}
if (isMainModule(import.meta)) {
    try {
        const errors = await checkTextStyle(process.cwd(), process.argv.slice(2));
        if (errors.length) throw new Error(errors.join('\n'));
    } catch (error) {
        console.error(errorMessage(error));
        process.exitCode = 1;
    }
}
