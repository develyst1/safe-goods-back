// postgres.js surfaces SQLSTATE on `code` and the constraint on `constraint_name`; 23505 = unique_violation.
export const isUniqueViolation = (e: unknown, constraint?: string): boolean => {
  if (typeof e !== "object" || e === null) return false;
  const err = e as { code?: string; constraint_name?: string };
  return err.code === "23505" && (!constraint || err.constraint_name === constraint);
};
