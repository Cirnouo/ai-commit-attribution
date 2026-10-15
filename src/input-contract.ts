import { isRecord } from '../tooling/errors.ts';
import { checkRaw, InputError, text, unique } from './records.ts';

export const INPUT_BYTES = 2 * 1024 * 1024;

export function object(value: unknown, keys: readonly string[]): Record<string, unknown> {
    if (!isRecord(value) || Object.keys(value).some((key) => !keys.includes(key)))
        throw new InputError('Invalid policy input shape or unknown member.');
    return value;
}
export function strings(value: unknown): string[] {
    if (!Array.isArray(value) || value.some((item) => typeof item !== 'string'))
        throw new InputError('Invalid policy string list.');
    value.forEach(checkRaw);
    const result = value.map((item) => {
        text(item);
        return item as string;
    });
    if (new Set(result).size !== result.length) throw new InputError('Duplicate policy identifier.');
    return unique(result);
}
