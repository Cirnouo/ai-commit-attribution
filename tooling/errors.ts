/** Safe cross-layer error metadata; external values remain unknown. */
export function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

export function errorCode(error: unknown): string | undefined {
    return isRecord(error) && typeof error.code === 'string' ? error.code : undefined;
}
