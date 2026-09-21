# safe-goods-back

Bun + Hono API for **เว็บกลาง** (safe-goods) on PostgreSQL.

## Run locally

1. `cp .env.example .env` and set `DATABASE_URL` (required — the process refuses to start without it).
   The owner supplies the dev-DB URL; for your own machine, a local Postgres:
   ```
   createdb safe-goods_local
   # then set DATABASE_URL to the safe-goods_local database, same form as .env.example
   ```
2. `bun install`
3. `bun run db:migrate` — applies `drizzle/*.sql` (idempotent; tracked in `__drizzle_migrations`)
4. `bun run seed` — categories, fee settings, admin from `ADMIN_*` (idempotent)
5. `bun run dev` → http://localhost:3001/api/v1/health

## Tests

`bun test` needs no database and no env — it runs an embedded PostgreSQL (PGlite) in memory and never touches `DATABASE_URL`.
