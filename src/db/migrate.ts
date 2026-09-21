// `bun run db:migrate` — applies pending migrations from drizzle/ (recorded in __drizzle_migrations;
// running twice is a no-op), then lists the public tables. The migrator matches the driver in use.
import { sql } from "drizzle-orm";
import { resolve } from "node:path";
import { env, maskDatabaseUrl } from "../env";
import { closeDb, db, dbKind } from "./client";

export const MIGRATIONS_FOLDER = resolve(import.meta.dir, "../../drizzle");

export const runMigrations = async () => {
  const migrate =
    dbKind() === "pglite" ? (await import("drizzle-orm/pglite/migrator")).migrate : (await import("drizzle-orm/postgres-js/migrator")).migrate;
  // Both migrators accept the PgDatabase they were built for; the handle kind guarantees the match.
  await migrate(db as never, { migrationsFolder: MIGRATIONS_FOLDER });
};

// db.execute() returns rows directly (postgres.js) or { rows } (PGlite).
export const rowsOf = <T>(result: unknown): T[] => (Array.isArray(result) ? (result as T[]) : ((result as { rows: T[] }).rows ?? []));

if (import.meta.main) {
  await runMigrations();
  const tables = rowsOf<{ tablename: string }>(await db.execute(sql`SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`));
  console.log(`migrated ${maskDatabaseUrl(env.DATABASE_URL)}: ${tables.map((t) => t.tablename).join(", ")}`);
  await closeDb();
}
