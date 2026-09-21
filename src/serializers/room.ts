import { asc, eq, inArray } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Db } from "../db/client";
import { categories, files, roomEvents, rooms, users } from "../db/schema";
import { canCancel, type RoomStatus } from "../domain/roomStatus";
import { AppError } from "../lib/http";
import { iso } from "../lib/time";
import { toUserPublic } from "./user";

export type RoomRow = typeof rooms.$inferSelect;
type FileRow = typeof files.$inferSelect;
export type Viewer = { id: string; role: "USER" | "ADMIN" };

// SPEC-001 §Shared shapes → FileRef (url is always the authenticated endpoint 18)
export const toFileRef = (f: FileRow) => ({
  id: f.id,
  kind: f.kind as "SLIP" | "EVIDENCE",
  fileName: f.fileName,
  mimeType: f.mimeType,
  sizeBytes: f.sizeBytes,
  uploadedAt: f.createdAt.toISOString(),
  url: `/api/v1/files/${f.id}`,
});

export const findRoomByCode = async (db: Db, code: string): Promise<RoomRow> => {
  const [row] = await db.select().from(rooms).where(eq(rooms.code, code));
  if (!row) throw new AppError(404, "NOT_FOUND", `room ${code} not found`);
  return row;
};

export const myRoleIn = (room: RoomRow, viewer: Viewer): "BUYER" | "SELLER" | "ADMIN" | null =>
  room.buyerId === viewer.id ? "BUYER" : room.sellerId === viewer.id ? "SELLER" : viewer.role === "ADMIN" ? "ADMIN" : null;

// SPEC-001 §Shared shapes → Room. Same shape for buyer, seller, admin and non-member.
export const toRoom = async (db: Db, room: RoomRow, viewer: Viewer, { withEvents = true }: { withEvents?: boolean } = {}) => {
  const [category] = await db.select().from(categories).where(eq(categories.id, room.categoryId));
  if (!category) throw new Error(`room ${room.code}: category ${room.categoryId} missing`);
  const memberIds = [room.buyerId, room.sellerId].filter((x): x is string => x !== null);
  const members = memberIds.length ? await db.select().from(users).where(inArray(users.id, memberIds)) : [];
  const byId = (id: string | null) => (id ? members.find((u) => u.id === id) ?? null : null);
  const buyer = byId(room.buyerId);
  const seller = byId(room.sellerId);

  const roomFiles = await db.select().from(files).where(eq(files.roomId, room.id)).orderBy(asc(files.createdAt));
  const slip = room.slipFileId ? roomFiles.find((f) => f.id === room.slipFileId) ?? null : null;
  const evidence = roomFiles.filter((f) => f.kind === "EVIDENCE");

  const actor = alias(users, "actor");
  const events = withEvents
    ? (
        await db
          .select({ e: roomEvents, actorDisplayName: actor.displayName })
          .from(roomEvents)
          .leftJoin(actor, eq(roomEvents.actorUserId, actor.id))
          .where(eq(roomEvents.roomId, room.id))
          .orderBy(asc(roomEvents.createdAt), asc(roomEvents.id))
      ).map(({ e, actorDisplayName }) => ({
        id: e.id,
        type: e.type,
        actorRole: e.actorRole as "BUYER" | "SELLER" | "ADMIN" | "SYSTEM",
        actorDisplayName: actorDisplayName ?? null,
        note: e.note,
        createdAt: e.createdAt.toISOString(),
      }))
    : [];

  return {
    id: room.id,
    code: room.code,
    status: room.status as RoomStatus,
    category: { id: category.id, kind: category.kind as "IN_GAME" | "PHYSICAL", nameTh: category.nameTh },
    description: room.description,
    priceMode: room.priceMode as "FEE_ADDED" | "FEE_INCLUDED",
    feePayer: room.feePayer as "SELLER" | "BUYER" | "SPLIT",
    amounts: {
      enteredPrice: room.enteredPrice,
      basePrice: room.basePrice,
      fee: room.fee,
      buyerPays: room.buyerPays,
      sellerReceives: room.sellerReceives,
      feeRatePercent: room.feeRatePercent,
      feeMinimum: room.feeMinimum,
    },
    buyer: buyer ? await toUserPublic(db, buyer) : null,
    seller: seller ? await toUserPublic(db, seller) : null,
    openedByRole: room.openedByRole as "BUYER" | "SELLER",
    myRole: myRoleIn(room, viewer),
    payment: { slip: slip ? toFileRef(slip) : null, rejectReason: room.rejectReason, confirmedAt: iso(room.paymentConfirmedAt) },
    delivery: {
      evidence: evidence.map(toFileRef),
      courier: room.courier,
      trackingNumber: room.trackingNumber,
      deliveredAt: iso(room.deliveredAt),
      parcelArrivedAt: iso(room.parcelArrivedAt),
    },
    autoReleaseAt: iso(room.autoReleaseAt),
    releasedAt: iso(room.releasedAt),
    releasedBy: room.releasedBy as "BUYER" | "SYSTEM" | null,
    paidOutAt: iso(room.paidOutAt),
    completedAt: iso(room.completedAt),
    cancelledAt: iso(room.cancelledAt),
    canCancel: canCancel(room.status as RoomStatus),
    events,
    createdAt: room.createdAt.toISOString(),
    updatedAt: room.updatedAt.toISOString(),
  };
};

// 403 FORBIDDEN unless the viewer holds one of the given roles in this room (ADMIN = any admin).
export const assertParty = (room: RoomRow, viewer: Viewer, ...allowed: Array<"BUYER" | "SELLER" | "ADMIN">): "BUYER" | "SELLER" | "ADMIN" => {
  const role = myRoleIn(room, viewer);
  if (role && allowed.includes(role)) return role;
  throw new AppError(403, "FORBIDDEN", `this action is for ${allowed.join(" or ")} of room ${room.code}`);
};
