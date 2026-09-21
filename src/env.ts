// Typed env with defaults from SPEC-001 §Non-functional. Bun loads `.env` automatically.
const str = (key: string, fallback: string): string => process.env[key] ?? fallback;
const int = (key: string, fallback: number): number => {
  const raw = process.env[key];
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n)) throw new Error(`env ${key} must be an integer, got "${raw}"`);
  return n;
};

export const env = {
  PORT: int("PORT", 3001),
  DATABASE_PATH: str("DATABASE_PATH", "data/safe-goods.sqlite"),
  UPLOAD_DIR: str("UPLOAD_DIR", "uploads"),
  JWT_SECRET: str("JWT_SECRET", "local-dev-secret-change-me"),
  AUTO_RELEASE_SECONDS: int("AUTO_RELEASE_SECONDS", 259_200),
  SWEEP_INTERVAL_MS: int("SWEEP_INTERVAL_MS", 60_000),
  CORS_ORIGIN: str("CORS_ORIGIN", "http://localhost:3000"),
  ADMIN_EMAIL: str("ADMIN_EMAIL", "admin@local.test"),
  ADMIN_PASSWORD: str("ADMIN_PASSWORD", "admin1234"),
  ADMIN_DISPLAY_NAME: str("ADMIN_DISPLAY_NAME", "Admin"),
} as const;
