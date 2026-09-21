import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { env } from "../env";
import * as schema from "./schema";

const MIGRATIONS_FOLDER = resolve(import.meta.dir, "../../drizzle");

// One connection for the process. Pending migrations in `drizzle/` are applied on boot
// (idempotent — drizzle records applied ones in `__drizzle_migrations`).
export const createDb = (path: string = env.DATABASE_PATH) => {
  if (path !== ":memory:") mkdirSync(dirname(resolve(path)), { recursive: true });
  const sqlite = new Database(path, { create: true, strict: true });
  sqlite.exec("PRAGMA journal_mode = WAL;");
  sqlite.exec("PRAGMA foreign_keys = ON;");
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  return { db, sqlite };
};

export const { db, sqlite } = createDb();
export type Db = typeof db;
