// ISO-8601 UTC strings everywhere (SPEC-001 §Technical decisions).
export const nowIso = (): string => new Date().toISOString();
