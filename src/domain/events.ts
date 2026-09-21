// SPEC-001 §Domain vocabulary → eventType. REQ-002 appends new types; the list is open.
import type { Db } from "../db/client";
import { roomEvents } from "../db/schema";
import { nowIso } from "../lib/time";
import type { ActorRole } from "./roomStatus";

export type EventType =
  | "ROOM_OPENED"
  | "ROOM_JOINED"
  | "SLIP_UPLOADED"
  | "PAYMENT_CONFIRMED"
  | "PAYMENT_REJECTED"
  | "DELIVERED"
  | "PARCEL_ARRIVED"
  | "RECEIVED_CONFIRMED"
  | "AUTO_RELEASED"
  | "PAID_OUT"
  | "ROOM_CANCELLED";

export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

// Called inside the same transaction as the room update.
export const addEvent = (tx: Db | Tx, roomId: string, type: EventType, actorRole: ActorRole, actorUserId: string | null = null, note: string | null = null) =>
  tx.insert(roomEvents).values({ roomId, type, actorRole, actorUserId, note, createdAt: nowIso() }).run();
