// SPEC-002 "Auto-release sweep": one UPDATE … RETURNING id over every *_WAITING_CONFIRM room whose
// auto_release_at has passed (DB clock), then one batch insert of AUTO_RELEASED events — one transaction.
// Atomic and idempotent by construction: a second run matches no rows.
import { and, inArray, lte, sql } from "drizzle-orm";
import { db } from "../db/client";
import { roomEvents, rooms } from "../db/schema";

export const runAutoRelease = (): Promise<number> =>
  db.transaction(async (tx) => {
    const released = await tx
      .update(rooms)
      .set({ status: "WAITING_PAYOUT", releasedAt: sql`now()`, releasedBy: "SYSTEM", autoReleaseAt: null, updatedAt: sql`now()` })
      .where(and(inArray(rooms.status, ["DELIVERED_WAITING_CONFIRM", "PARCEL_ARRIVED_WAITING_CONFIRM"]), lte(rooms.autoReleaseAt, sql`now()`)))
      .returning({ id: rooms.id });
    if (released.length > 0) {
      await tx
        .insert(roomEvents)
        .values(released.map(({ id }) => ({ roomId: id, type: "AUTO_RELEASED", actorRole: "SYSTEM", actorUserId: null, note: null, createdAt: sql`now()` })));
    }
    return released.length;
  });
