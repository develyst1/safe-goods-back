import { and, count, desc, eq, or } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { db } from "../db/client";
import { categories, files, rooms } from "../db/schema";
import { getSettings } from "../db/settings";
import { env } from "../env";
import { addEvent } from "../domain/events";
import { computeFee } from "../domain/fee";
import { assertStatus, canCancel, type RoomStatus } from "../domain/roomStatus";
import { storeUpload } from "../lib/files";
import { AppError, ok } from "../lib/http";
import { roomCode, uuid } from "../lib/ids";
import { nowIso } from "../lib/time";
import { validate } from "../lib/validate";
import { requireAuth, type AuthEnv } from "../middleware/auth";
import { assertParty, findRoomByCode, myRoleIn, toRoom } from "../serializers/room";
import { enteredPriceSchema, feePayerSchema, priceModeSchema } from "./fee";

const openSchema = z.object({
  myRole: z.enum(["BUYER", "SELLER"]),
  categoryId: z.number().int(),
  description: z.string().min(1).max(500),
  priceMode: priceModeSchema,
  feePayer: feePayerSchema,
  enteredPrice: enteredPriceSchema,
});

const deliverSchema = z.object({ courier: z.string().max(50).optional(), trackingNumber: z.string().max(50).optional() });

const ROOM_CODE_ATTEMPTS = 5;
const autoReleaseFrom = (nowIsoString: string) => new Date(Date.parse(nowIsoString) + env.AUTO_RELEASE_SECONDS * 1000).toISOString();

export const roomsRoute = new Hono<AuthEnv>()
  .use("*", requireAuth)
  // SPEC-001 endpoint 8
  .post("/", validate("json", openSchema), (c) => {
    const body = c.req.valid("json");
    const me = c.var.user;
    const category = db.select().from(categories).where(eq(categories.id, body.categoryId)).get();
    if (!category) throw new AppError(400, "VALIDATION_ERROR", "unknown categoryId", [{ path: ["categoryId"], message: "unknown category" }]);

    const s = getSettings(db); // frozen into the row (AC-5)
    const amounts = computeFee({
      priceMode: body.priceMode,
      feePayer: body.feePayer,
      enteredPrice: body.enteredPrice,
      ratePercent: s.feeRatePercent,
      minimum: s.feeMinimum,
    });
    const now = nowIso();
    const id = uuid();
    const status: RoomStatus = body.myRole === "SELLER" ? "WAITING_BUYER_JOIN" : "WAITING_SELLER_JOIN";

    // Retry the 8-char code on a UNIQUE collision.
    let lastError: unknown;
    for (let attempt = 0; attempt < ROOM_CODE_ATTEMPTS; attempt++) {
      const code = roomCode();
      try {
        db.transaction((tx) => {
          tx.insert(rooms)
            .values({
              id,
              code,
              status,
              categoryId: category.id,
              description: body.description,
              priceMode: body.priceMode,
              feePayer: body.feePayer,
              enteredPrice: body.enteredPrice,
              basePrice: amounts.basePrice,
              fee: amounts.fee,
              buyerPays: amounts.buyerPays,
              sellerReceives: amounts.sellerReceives,
              feeRatePercent: amounts.feeRatePercent,
              feeMinimum: amounts.feeMinimum,
              openedByRole: body.myRole,
              buyerId: body.myRole === "BUYER" ? me.id : null,
              sellerId: body.myRole === "SELLER" ? me.id : null,
              createdAt: now,
              updatedAt: now,
            })
            .run();
          addEvent(tx, id, "ROOM_OPENED", body.myRole, me.id);
        });
        return ok(c, toRoom(db, findRoomByCode(db, code), me), 201);
      } catch (e) {
        lastError = e;
        if (!(e instanceof Error && /UNIQUE constraint failed: rooms\.code/.test(e.message))) throw e;
      }
    }
    throw lastError;
  })
  // SPEC-001 endpoint 9
  .get("/mine", (c) => {
    const me = c.var.user;
    const rows = db
      .select()
      .from(rooms)
      .where(or(eq(rooms.buyerId, me.id), eq(rooms.sellerId, me.id)))
      .orderBy(desc(rooms.createdAt))
      .all();
    return ok(c, rows.map((r) => toRoom(db, r, me, { withEvents: false })));
  })
  // SPEC-001 endpoint 10 — non-member gets the same shape with myRole: null
  .get("/:code", (c) => ok(c, toRoom(db, findRoomByCode(db, c.req.param("code")), c.var.user)))
  // SPEC-001 endpoint 11
  .post("/:code/join", (c) => {
    const me = c.var.user;
    const room = findRoomByCode(db, c.req.param("code"));
    // Order: closed room → INVALID_STATE (even for a member, TASK-003 DoD); member → no-op; both seats taken → ROOM_FULL.
    if (room.status === "CANCELLED" || room.status === "COMPLETED") assertStatus(room, "WAITING_BUYER_JOIN", "WAITING_SELLER_JOIN");
    if (room.buyerId === me.id || room.sellerId === me.id) return ok(c, toRoom(db, room, me));
    if (room.buyerId && room.sellerId) throw new AppError(409, "ROOM_FULL", "room already has a buyer and a seller");
    assertStatus(room, "WAITING_BUYER_JOIN", "WAITING_SELLER_JOIN");
    const seat = room.status === "WAITING_BUYER_JOIN" ? "BUYER" : "SELLER";

    db.transaction((tx) => {
      tx.update(rooms)
        .set({ ...(seat === "BUYER" ? { buyerId: me.id } : { sellerId: me.id }), status: "WAITING_PAYMENT", updatedAt: nowIso() })
        .where(eq(rooms.id, room.id))
        .run();
      addEvent(tx, room.id, "ROOM_JOINED", seat, me.id);
    });
    return ok(c, toRoom(db, findRoomByCode(db, room.code), me));
  })
  // SPEC-001 endpoint 13 — buyer only; replaces any previous slip (old file row stays for history)
  .post("/:code/slip", async (c) => {
    const me = c.var.user;
    const room = findRoomByCode(db, c.req.param("code"));
    assertParty(room, me, "BUYER");
    assertStatus(room, "WAITING_PAYMENT");
    const slip = await storeUpload(c, { roomId: room.id, kind: "SLIP", uploadedBy: me.id });
    const now = nowIso();
    db.transaction((tx) => {
      tx.update(rooms).set({ status: "SLIP_REVIEW", slipFileId: slip.id, rejectReason: null, updatedAt: now }).where(eq(rooms.id, room.id)).run();
      addEvent(tx, room.id, "SLIP_UPLOADED", "BUYER", me.id);
    });
    return ok(c, toRoom(db, findRoomByCode(db, room.code), me));
  })
  // SPEC-001 endpoint 14 — seller only; no status change, no event (DELIVERED is the record)
  .post("/:code/evidence", async (c) => {
    const me = c.var.user;
    const room = findRoomByCode(db, c.req.param("code"));
    assertParty(room, me, "SELLER");
    assertStatus(room, "PAID_WAITING_DELIVERY");
    await storeUpload(c, { roomId: room.id, kind: "EVIDENCE", uploadedBy: me.id });
    return ok(c, toRoom(db, room, me));
  })
  // SPEC-001 endpoint 15 — check order: evidence → tracking (PHYSICAL) → transition
  .post("/:code/deliver", validate("json", deliverSchema), (c) => {
    const me = c.var.user;
    const body = c.req.valid("json");
    const room = findRoomByCode(db, c.req.param("code"));
    assertParty(room, me, "SELLER");
    assertStatus(room, "PAID_WAITING_DELIVERY");
    const evidenceCount = db.select({ n: count() }).from(files).where(and(eq(files.roomId, room.id), eq(files.kind, "EVIDENCE"))).get()?.n ?? 0;
    if (evidenceCount === 0) throw new AppError(422, "EVIDENCE_REQUIRED", "attach at least one evidence image before delivering");
    const category = db.select().from(categories).where(eq(categories.id, room.categoryId)).get()!;
    const courier = body.courier?.trim() || null;
    const trackingNumber = body.trackingNumber?.trim() || null;
    if (category.kind === "PHYSICAL" && (!courier || !trackingNumber)) {
      throw new AppError(422, "TRACKING_REQUIRED", "courier and trackingNumber are required for physical goods");
    }

    const now = nowIso();
    const patch =
      category.kind === "PHYSICAL"
        ? { status: "SHIPPED_WAITING_PARCEL" as const, courier, trackingNumber, autoReleaseAt: null }
        : { status: "DELIVERED_WAITING_CONFIRM" as const, autoReleaseAt: autoReleaseFrom(now) };
    db.transaction((tx) => {
      tx.update(rooms).set({ ...patch, deliveredAt: now, updatedAt: now }).where(eq(rooms.id, room.id)).run();
      addEvent(tx, room.id, "DELIVERED", "SELLER", me.id);
    });
    return ok(c, toRoom(db, findRoomByCode(db, room.code), me));
  })
  // SPEC-001 endpoint 16 — buyer or admin
  .post("/:code/parcel-arrived", (c) => {
    const me = c.var.user;
    const room = findRoomByCode(db, c.req.param("code"));
    const actor = assertParty(room, me, "BUYER", "ADMIN");
    assertStatus(room, "SHIPPED_WAITING_PARCEL");
    const now = nowIso();
    db.transaction((tx) => {
      tx.update(rooms)
        .set({ status: "PARCEL_ARRIVED_WAITING_CONFIRM", parcelArrivedAt: now, autoReleaseAt: autoReleaseFrom(now), updatedAt: now })
        .where(eq(rooms.id, room.id))
        .run();
      addEvent(tx, room.id, "PARCEL_ARRIVED", actor, me.id);
    });
    return ok(c, toRoom(db, findRoomByCode(db, room.code), me));
  })
  // SPEC-001 endpoint 17 — buyer confirms receipt
  .post("/:code/received", (c) => {
    const me = c.var.user;
    const room = findRoomByCode(db, c.req.param("code"));
    assertParty(room, me, "BUYER");
    assertStatus(room, "DELIVERED_WAITING_CONFIRM", "PARCEL_ARRIVED_WAITING_CONFIRM");
    const now = nowIso();
    db.transaction((tx) => {
      tx.update(rooms)
        .set({ status: "WAITING_PAYOUT", releasedAt: now, releasedBy: "BUYER", autoReleaseAt: null, updatedAt: now })
        .where(eq(rooms.id, room.id))
        .run();
      addEvent(tx, room.id, "RECEIVED_CONFIRMED", "BUYER", me.id);
    });
    return ok(c, toRoom(db, findRoomByCode(db, room.code), me));
  })
  // SPEC-001 endpoint 12
  .post("/:code/cancel", (c) => {
    const me = c.var.user;
    const room = findRoomByCode(db, c.req.param("code"));
    const role = myRoleIn(room, me);
    if (role !== "BUYER" && role !== "SELLER") throw new AppError(403, "FORBIDDEN", "not a member of this room");
    if (!canCancel(room.status as RoomStatus)) throw new AppError(409, "INVALID_STATE", `room ${room.code} is ${room.status}; cannot cancel`);

    const now = nowIso();
    db.transaction((tx) => {
      tx.update(rooms).set({ status: "CANCELLED", cancelledAt: now, updatedAt: now }).where(eq(rooms.id, room.id)).run();
      addEvent(tx, room.id, "ROOM_CANCELLED", role, me.id);
    });
    return ok(c, toRoom(db, findRoomByCode(db, room.code), me));
  });
