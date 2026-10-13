import { readFileSync } from 'node:fs';
import { validateCommitMessage } from './governance.ts';

const file = process.argv[2];
if (!file || process.argv.length !== 3) throw new Error('Usage: check-commit-message.ts <message-file>');
const errors = validateCommitMessage(readFileSync(file, 'utf8'));
if (errors.length) {
    console.error(errors.join('\n'));
    process.exitCode = 1;
}
