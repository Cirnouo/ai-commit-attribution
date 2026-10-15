/** Reserve case variants on Windows/macOS, plus Windows stream and short-name aliases. */
export function isLedgerStatePath(raw: Buffer, platform: NodeJS.Platform = process.platform): boolean {
    const first = raw.subarray(0, raw.indexOf(0x2f) < 0 ? raw.length : raw.indexOf(0x2f)).toString('latin1');
    if (platform === 'darwin') return first.toLowerCase() === '.ai-commit-attribution';
    if (platform !== 'win32') return first === '.ai-commit-attribution';
    const normalized =
        first
            .split(':')[0]
            ?.replace(/[ .]+$/, '')
            .toLowerCase() ?? '';
    return normalized === '.ai-commit-attribution' || /^\.?ai-com~[0-9]+$/.test(normalized);
}
