// Database client factory (SPEC-002 §Change 1).
//   app  → postgres.js on DATABASE_URL, created lazily on first use
//   test → an embedded PGlite instance installed by src/test/setup.ts via setTestDb() BEFORE any query;
//          under `bun test` the client refuses to open DATABASE_URL at all (AC-8).
// Both drivers produce the same Drizzle `Db` shape, so every route/serializer is driver-agnostic.
import type { PGlite } from "@electric-sql/pglite";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { drizzle as drizzlePostgres } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;
export type DbKind = "postgres" | "pglite";

type Handle = { kind: DbKind; db: Db; ping: () => Promise<void>; close: () => Promise<void> };

export const createPostgresDb = (url: string): Handle => {
  const sql = postgres(url, { max: 10, onnotice: () => {} });
  return {
    kind: "postgres",
    db: drizzlePostgres(sql, { schema }) as unknown as Db,
    ping: async () => {
      await sql`SELECT 1`;
    },
    close: () => sql.end(),
  };
};

export const createPgliteDb = (client: PGlite): Handle => ({
  kind: "pglite",
  db: drizzlePglite(client, { schema }) as unknown as Db,
  ping: async () => {
    await client.query("SELECT 1");
  },
  close: () => client.close(),
});

let handle: Handle | undefined;

// Called by the test preload only.
export const setTestDb = (h: Handle) => {
  handle = h;
};

const resolve = (): Handle => {
  if (handle) return handle;
  if (process.env.NODE_ENV === "test") throw new Error("bun test must install an embedded database via setTestDb() — DATABASE_URL is never opened by tests");
  const url = process.env.DATABASE_URL?.trim();
  if (!url) throw new Error("DATABASE_URL is missing");
  handle = createPostgresDb(url);
  return handle;
};

// The process singleton, resolved on first property access so importing this module never connects.
export const db: Db = new Proxy({} as Db, {
  get(_target, prop) {
    const real = resolve().db as unknown as Record<PropertyKey, unknown>;
    const value = real[prop];
    return typeof value === "function" ? (value as (...a: unknown[]) => unknown).bind(real) : value;
  },
});

export const dbKind = (): DbKind => resolve().kind;
// `SELECT 1` — used by src/index.ts to fail fast before Bun.serve (AC-6).
export const pingDb = (): Promise<void> => resolve().ping();
export const closeDb = (): Promise<void> => resolve().close();
