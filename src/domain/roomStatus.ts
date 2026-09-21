// SPEC-001 §Domain vocabulary — one code per status; the FE renders Porter's Thai.
import { AppError } from "../lib/http";

export const ROOM_STATUSES = [
  "WAITING_BUYER_JOIN",
  "WAITING_SELLER_JOIN",
  "WAITING_PAYMENT",
  "SLIP_REVIEW",
  "PAID_WAITING_DELIVERY",
  "DELIVERED_WAITING_CONFIRM",
  "SHIPPED_WAITING_PARCEL",
  "PARCEL_ARRIVED_WAITING_CONFIRM",
  "WAITING_PAYOUT",
  "COMPLETED",
  "CANCELLED",
] as const;
export type RoomStatus = (typeof ROOM_STATUSES)[number];

export type PartyRole = "BUYER" | "SELLER";
export type ActorRole = PartyRole | "ADMIN" | "SYSTEM";

// AC-12/13: cancel only before the money is confirmed.
const CANCELLABLE: ReadonlySet<RoomStatus> = new Set(["WAITING_BUYER_JOIN", "WAITING_SELLER_JOIN", "WAITING_PAYMENT", "SLIP_REVIEW"]);
export const canCancel = (status: RoomStatus): boolean => CANCELLABLE.has(status);

// Every transition guards through here → 409 INVALID_STATE.
export const assertStatus = (room: { status: string; code: string }, ...allowed: RoomStatus[]): void => {
  if (!allowed.includes(room.status as RoomStatus)) {
    throw new AppError(409, "INVALID_STATE", `room ${room.code} is ${room.status}; allowed: ${allowed.join(", ")}`);
  }
};
