// SPEC-002 §Flow: every transition is `UPDATE … WHERE id = $1 AND status IN (<expected>)`; a lost race
// (or a stale client) updates nothing and gets 409 INVALID_STATE — atomic on the DB, not on the process.
import { and, eq, inArray } from "drizzle-orm";
import type { Tx } from "../domain/events";
import type { RoomStatus } from "../domain/roomStatus";
import { AppError } from "../lib/http";
import { now } from "../lib/time";
import type { Db } from "./client";
import { rooms } from "./schema";

type RoomPatch = Partial<typeof rooms.$inferInsert>;

export const transition = async (tx: Db | Tx, room: { id: string; code: string }, expected: RoomStatus[], patch: RoomPatch): Promise<void> => {
  const updated = await tx
    .update(rooms)
    .set({ ...patch, updatedAt: now() })
    .where(and(eq(rooms.id, room.id), inArray(rooms.status, expected)))
    .returning({ id: rooms.id });
  if (updated.length === 0) throw new AppError(409, "INVALID_STATE", `room ${room.code} is no longer in ${expected.join(" / ")}`);
};
