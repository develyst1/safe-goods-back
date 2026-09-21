import { eq } from "drizzle-orm";
import type { Db } from "./client";
import { settings } from "./schema";

// The single `settings` row (id = 1), seeded by `bun run seed`.
export const getSettings = (db: Db) => {
  const row = db.select().from(settings).where(eq(settings.id, 1)).get();
  if (!row) throw new Error("settings row missing — run `bun run seed`");
  return { feeRatePercent: row.feeRatePercent, feeMinimum: row.feeMinimum };
};

// SPEC-001 endpoint 23 — affects new rooms only; existing rooms keep their frozen copy (AC-5).
export const updateSettings = (db: Db, next: { feeRatePercent: number; feeMinimum: number }) => {
  db.update(settings).set({ ...next, updatedAt: new Date().toISOString() }).where(eq(settings.id, 1)).run();
  return getSettings(db);
};
