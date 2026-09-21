// `bun run db:migrate` — applies pending migrations from drizzle/ (recorded in __drizzle_migrations;
// running twice is a no-op), then lists the public tables.
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { resolve } from "node:path";
import { env, maskDatabaseUrl } from "../env";
import { db, sql } from "./client";

export const MIGRATIONS_FOLDER = resolve(import.meta.dir, "../../drizzle");

export const runMigrations = () => migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });

if (import.meta.main) {
  await runMigrations();
  const tables = await sql<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`;
  console.log(`migrated ${maskDatabaseUrl(env.DATABASE_URL)}: ${tables.map((t) => t.tablename).join(", ")}`);
  await sql.end();
}
