// bun test preload (bunfig.toml). Runs once per test process, before any test file imports src/env.ts:
// points the db client at TEST_DATABASE_URL and applies the migrations once. Each test file then calls
// `resetDb()` (src/test/helpers.ts) in its beforeAll → TRUNCATE + seed, so files never see each other's rows.
import { tmpdir } from "node:os";

const testUrl = process.env.TEST_DATABASE_URL?.trim();
if (!testUrl) {
  console.error("TEST_DATABASE_URL is missing — bun test needs a LOCAL Postgres database it may truncate (see .env.example)");
  process.exit(1);
}
process.env.DATABASE_URL = testUrl;
process.env.JWT_SECRET = "test-secret";
process.env.UPLOAD_DIR = `${tmpdir()}/safe-goods-test-uploads`;

const { runMigrations } = await import("../db/migrate");
await runMigrations();
