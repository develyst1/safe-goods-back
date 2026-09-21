import { and, count, desc, eq, or } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { db } from "../db/client";
import { categories, files, rooms } from "../db/schema";
import { getSettings } from "../db/settings";
import { transition } from "../db/transition";
import { env } from "../env";
import { addEvent } from "../domain/events";
import { computeFee } from "../domain/fee";
import { assertStatus, canCancel, type RoomStatus } from "../domain/roomStatus";
import { storeUpload } from "../lib/files";
import { AppError, ok } from "../lib/http";
import { roomCode, uuid } from "../lib/ids";
import { isUniqueViolation } from "../lib/pg";
import { now } from "../lib/time";
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
const autoReleaseFrom = (at: Date) => new Date(at.getTime() + env.AUTO_RELEASE_SECONDS * 1000);

// Reload and serialize after a transition — every state-changing endpoint returns the full Room.
const reply = async (c: Parameters<typeof ok>[0], code: string, viewer: AuthEnv["Variables"]["user"], status?: 201) =>
  ok(c, await toRoom(db, await findRoomByCode(db, code), viewer), status);

export const roomsRoute = new Hono<AuthEnv>()
  .use("*", requireAuth)
  // SPEC-001 endpoint 8
  .post("/", validate("json", openSchema), async (c) => {
    const body = c.req.valid("json");
    const me = c.var.user;
    const [category] = await db.select().from(categories).where(eq(categories.id, body.categoryId));
    if (!category) throw new AppError(400, "VALIDATION_ERROR", "unknown categoryId", [{ path: ["categoryId"], message: "unknown category" }]);

    const s = await getSettings(db); // frozen into the row (AC-5)
    const amounts = computeFee({
      priceMode: body.priceMode,
      feePayer: body.feePayer,
      enteredPrice: body.enteredPrice,
      ratePercent: s.feeRatePercent,
      minimum: s.feeMinimum,
    });
    const at = now();
    const id = uuid();
    const status: RoomStatus = body.myRole === "SELLER" ? "WAITING_BUYER_JOIN" : "WAITING_SELLER_JOIN";

    // Retry the 8-char code on a UNIQUE collision (rooms_code_unique).
    let lastError: unknown;
    for (let attempt = 0; attempt < ROOM_CODE_ATTEMPTS; attempt++) {
      const code = roomCode();
      try {
        await db.transaction(async (tx) => {
          await tx.insert(rooms).values({
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
            createdAt: at,
            updatedAt: at,
          });
          await addEvent(tx, id, "ROOM_OPENED", body.myRole, me.id);
        });
        return reply(c, code, me, 201);
      } catch (e) {
        lastError = e;
        if (!isUniqueViolation(e, "rooms_code_unique")) throw e;
      }
    }
    throw lastError;
  })
  // SPEC-001 endpoint 9
  .get("/mine", async (c) => {
    const me = c.var.user;
    const rows = await db
      .select()
      .from(rooms)
      .where(or(eq(rooms.buyerId, me.id), eq(rooms.sellerId, me.id)))
      .orderBy(desc(rooms.createdAt));
    return ok(c, await Promise.all(rows.map((r) => toRoom(db, r, me, { withEvents: false }))));
  })
  // SPEC-001 endpoint 10 — non-member gets the same shape with myRole: null
  .get("/:code", async (c) => ok(c, await toRoom(db, await findRoomByCode(db, c.req.param("code")), c.var.user)))
  // SPEC-001 endpoint 11
  .post("/:code/join", async (c) => {
    const me = c.var.user;
    const room = await findRoomByCode(db, c.req.param("code"));
    // Order (SPEC-001 row 11 ruling): closed room → INVALID_STATE; member → no-op; both seats taken → ROOM_FULL.
    if (room.status === "CANCELLED" || room.status === "COMPLETED") assertStatus(room, "WAITING_BUYER_JOIN", "WAITING_SELLER_JOIN");
    if (room.buyerId === me.id || room.sellerId === me.id) return ok(c, await toRoom(db, room, me));
    if (room.buyerId && room.sellerId) throw new AppError(409, "ROOM_FULL", "room already has a buyer and a seller");
    assertStatus(room, "WAITING_BUYER_JOIN", "WAITING_SELLER_JOIN");
    const seat = room.status === "WAITING_BUYER_JOIN" ? "BUYER" : "SELLER";

    await db.transaction(async (tx) => {
      await transition(tx, room, [room.status as RoomStatus], { ...(seat === "BUYER" ? { buyerId: me.id } : { sellerId: me.id }), status: "WAITING_PAYMENT" });
      await addEvent(tx, room.id, "ROOM_JOINED", seat, me.id);
    });
    return reply(c, room.code, me);
  })
  // SPEC-001 endpoint 13 — buyer only; replaces any previous slip (old file row stays for history)
  .post("/:code/slip", async (c) => {
    const me = c.var.user;
    const room = await findRoomByCode(db, c.req.param("code"));
    assertParty(room, me, "BUYER");
    assertStatus(room, "WAITING_PAYMENT");
    const slip = await storeUpload(c, { roomId: room.id, kind: "SLIP", uploadedBy: me.id });
    await db.transaction(async (tx) => {
      await transition(tx, room, ["WAITING_PAYMENT"], { status: "SLIP_REVIEW", slipFileId: slip.id, rejectReason: null });
      await addEvent(tx, room.id, "SLIP_UPLOADED", "BUYER", me.id);
    });
    return reply(c, room.code, me);
  })
  // SPEC-001 endpoint 14 — seller only; no status change, no event (DELIVERED is the record)
  .post("/:code/evidence", async (c) => {
    const me = c.var.user;
    const room = await findRoomByCode(db, c.req.param("code"));
    assertParty(room, me, "SELLER");
    assertStatus(room, "PAID_WAITING_DELIVERY");
    await storeUpload(c, { roomId: room.id, kind: "EVIDENCE", uploadedBy: me.id });
    return ok(c, await toRoom(db, room, me));
  })
  // SPEC-001 endpoint 15 — check order: evidence → tracking (PHYSICAL) → transition
  .post("/:code/deliver", validate("json", deliverSchema), async (c) => {
    const me = c.var.user;
    const body = c.req.valid("json");
    const room = await findRoomByCode(db, c.req.param("code"));
    assertParty(room, me, "SELLER");
    assertStatus(room, "PAID_WAITING_DELIVERY");
    const [ev] = await db.select({ n: count() }).from(files).where(and(eq(files.roomId, room.id), eq(files.kind, "EVIDENCE")));
    if ((ev?.n ?? 0) === 0) throw new AppError(422, "EVIDENCE_REQUIRED", "attach at least one evidence image before delivering");
    const [category] = await db.select().from(categories).where(eq(categories.id, room.categoryId));
    const courier = body.courier?.trim() || null;
    const trackingNumber = body.trackingNumber?.trim() || null;
    if (category?.kind === "PHYSICAL" && (!courier || !trackingNumber)) {
      throw new AppError(422, "TRACKING_REQUIRED", "courier and trackingNumber are required for physical goods");
    }

    const at = now();
    const patch =
      category?.kind === "PHYSICAL"
        ? { status: "SHIPPED_WAITING_PARCEL" as const, courier, trackingNumber, autoReleaseAt: null }
        : { status: "DELIVERED_WAITING_CONFIRM" as const, autoReleaseAt: autoReleaseFrom(at) };
    await db.transaction(async (tx) => {
      await transition(tx, room, ["PAID_WAITING_DELIVERY"], { ...patch, deliveredAt: at });
      await addEvent(tx, room.id, "DELIVERED", "SELLER", me.id);
    });
    return reply(c, room.code, me);
  })
  // SPEC-001 endpoint 16 — buyer or admin
  .post("/:code/parcel-arrived", async (c) => {
    const me = c.var.user;
    const room = await findRoomByCode(db, c.req.param("code"));
    const actor = assertParty(room, me, "BUYER", "ADMIN");
    assertStatus(room, "SHIPPED_WAITING_PARCEL");
    const at = now();
    await db.transaction(async (tx) => {
      await transition(tx, room, ["SHIPPED_WAITING_PARCEL"], { status: "PARCEL_ARRIVED_WAITING_CONFIRM", parcelArrivedAt: at, autoReleaseAt: autoReleaseFrom(at) });
      await addEvent(tx, room.id, "PARCEL_ARRIVED", actor, me.id);
    });
    return reply(c, room.code, me);
  })
  // SPEC-001 endpoint 17 — buyer confirms receipt
  .post("/:code/received", async (c) => {
    const me = c.var.user;
    const room = await findRoomByCode(db, c.req.param("code"));
    assertParty(room, me, "BUYER");
    assertStatus(room, "DELIVERED_WAITING_CONFIRM", "PARCEL_ARRIVED_WAITING_CONFIRM");
    await db.transaction(async (tx) => {
      await transition(tx, room, ["DELIVERED_WAITING_CONFIRM", "PARCEL_ARRIVED_WAITING_CONFIRM"], {
        status: "WAITING_PAYOUT",
        releasedAt: now(),
        releasedBy: "BUYER",
        autoReleaseAt: null,
      });
      await addEvent(tx, room.id, "RECEIVED_CONFIRMED", "BUYER", me.id);
    });
    return reply(c, room.code, me);
  })
  // SPEC-001 endpoint 12
  .post("/:code/cancel", async (c) => {
    const me = c.var.user;
    const room = await findRoomByCode(db, c.req.param("code"));
    const role = myRoleIn(room, me);
    if (role !== "BUYER" && role !== "SELLER") throw new AppError(403, "FORBIDDEN", "not a member of this room");
    if (!canCancel(room.status as RoomStatus)) throw new AppError(409, "INVALID_STATE", `room ${room.code} is ${room.status}; cannot cancel`);

    await db.transaction(async (tx) => {
      await transition(tx, room, ["WAITING_BUYER_JOIN", "WAITING_SELLER_JOIN", "WAITING_PAYMENT", "SLIP_REVIEW"], { status: "CANCELLED", cancelledAt: now() });
      await addEvent(tx, room.id, "ROOM_CANCELLED", role, me.id);
    });
    return reply(c, room.code, me);
  });
