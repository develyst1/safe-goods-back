// SQLSTATE 23505 = unique_violation. postgres.js puts `code` / `constraint_name` on the error itself;
// Drizzle wraps PGlite's error, so the same fields sit on `cause` (SPEC-002 §Change 1).
type PgErr = { code?: string; constraint_name?: string; cause?: PgErr };

export const isUniqueViolation = (e: unknown, constraint?: string): boolean => {
  for (let err = e as PgErr | undefined; err && typeof err === "object"; err = err.cause) {
    if (err.code === "23505") return !constraint || err.constraint_name === constraint;
  }
  return false;
};
