import { eq } from "drizzle-orm";
import { now } from "../lib/time";
import type { Db } from "./client";
import { settings } from "./schema";

// The single `settings` row (id = 1), seeded by `bun run seed`.
export const getSettings = async (db: Db) => {
  const [row] = await db.select().from(settings).where(eq(settings.id, 1));
  if (!row) throw new Error("settings row missing — run `bun run seed`");
  return { feeRatePercent: row.feeRatePercent, feeMinimum: row.feeMinimum };
};

// SPEC-001 endpoint 23 — affects new rooms only; existing rooms keep their frozen copy (AC-5).
export const updateSettings = async (db: Db, next: { feeRatePercent: number; feeMinimum: number }) => {
  await db.update(settings).set({ ...next, updatedAt: now() }).where(eq(settings.id, 1));
  return getSettings(db);
};
