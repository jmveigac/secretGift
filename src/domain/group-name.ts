export function normalizeGroupName(value: unknown): string | undefined {
    if (typeof value !== 'string' || value.length > 100 || /[\x00-\x1f\x7f]/.test(value)) return undefined;
    return value.trim().replace(/\s+/g, ' ') || undefined;
}
