// The app clock. Timestamps are stored as timestamptz (Date) and rendered ISO-8601 UTC on the wire.
export const now = (): Date => new Date();
export const nowIso = (): string => new Date().toISOString();
export const iso = (d: Date | null | undefined): string | null => d?.toISOString() ?? null;
