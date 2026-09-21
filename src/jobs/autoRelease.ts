// SPEC-001 "Auto-release sweep": rooms waiting for the buyer's confirm whose autoReleaseAt has
// passed → WAITING_PAYOUT, released by SYSTEM. Idempotent — a second run releases nothing new.
import { and, eq, inArray, lte } from "drizzle-orm";
import { db } from "../db/client";
import { rooms } from "../db/schema";
import { addEvent } from "../domain/events";
import { nowIso } from "../lib/time";

export const runAutoRelease = (): number => {
  const now = nowIso();
  const due = db
    .select({ id: rooms.id })
    .from(rooms)
    .where(and(inArray(rooms.status, ["DELIVERED_WAITING_CONFIRM", "PARCEL_ARRIVED_WAITING_CONFIRM"]), lte(rooms.autoReleaseAt, now)))
    .all();

  for (const { id } of due) {
    db.transaction((tx) => {
      tx.update(rooms)
        .set({ status: "WAITING_PAYOUT", releasedAt: now, releasedBy: "SYSTEM", autoReleaseAt: null, updatedAt: now })
        .where(eq(rooms.id, id))
        .run();
      addEvent(tx, id, "AUTO_RELEASED", "SYSTEM");
    });
  }
  return due.length;
};
