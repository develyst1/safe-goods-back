import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "../env";
import * as schema from "./schema";

// One postgres.js pool for the process (SPEC-002 §Technical decisions → Driver).
export const sql = postgres(env.DATABASE_URL, { max: 10, onnotice: () => {} });
export const db = drizzle(sql, { schema });
export type Db = typeof db;

// `SELECT 1` — used by src/index.ts to fail fast before Bun.serve (AC-6).
export const pingDb = async (): Promise<void> => {
  await sql`SELECT 1`;
};
