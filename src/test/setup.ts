// bun test preload (bunfig.toml). Runs once per test process, before any test file imports the app:
// installs an embedded in-memory PostgreSQL (PGlite) as THE database, migrates it once, and sets the
// test env. DATABASE_URL is never read here and never opened by tests (SPEC-002 §Change 1, AC-8).
// Each test file then calls `resetDb()` (src/test/helpers.ts) in its beforeAll → TRUNCATE + seed.
import { PGlite } from "@electric-sql/pglite";
import { tmpdir } from "node:os";

process.env.JWT_SECRET = "test-secret";
process.env.UPLOAD_DIR = `${tmpdir()}/safe-goods-test-uploads`;

const client = new PGlite(); // memory-only
const { createPgliteDb, setTestDb } = await import("../db/client");
setTestDb(createPgliteDb(client));
const { runMigrations } = await import("../db/migrate");
await runMigrations();
const version = (await client.query<{ version: string }>("SELECT version()")).rows[0]?.version ?? "?";
console.log(`[test] embedded database: ${version}`);
