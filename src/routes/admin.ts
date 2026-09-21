import { desc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { db } from "../db/client";
import { rooms } from "../db/schema";
import { updateSettings } from "../db/settings";
import { transition } from "../db/transition";
import { addEvent } from "../domain/events";
import { assertStatus, ROOM_STATUSES } from "../domain/roomStatus";
import { runAutoRelease } from "../jobs/autoRelease";
import { ok } from "../lib/http";
import { now } from "../lib/time";
import { validate } from "../lib/validate";
import { requireAdmin, requireAuth, type AuthEnv } from "../middleware/auth";
import { findRoomByCode, toRoom } from "../serializers/room";

const listQuerySchema = z.object({ status: z.enum(ROOM_STATUSES).optional() });
const rejectSchema = z.object({ reason: z.string().min(1).max(200) });
const feeSettingsSchema = z.object({ feeRatePercent: z.number().int().min(0).max(100), feeMinimum: z.number().int().min(0) });

export const admin = new Hono<AuthEnv>()
  .use("*", requireAuth, requireAdmin)
  // SPEC-001 endpoint 19
  .get("/rooms", validate("query", listQuerySchema), async (c) => {
    const { status } = c.req.valid("query");
    const q = db.select().from(rooms);
    const rows = await (status ? q.where(eq(rooms.status, status)) : q).orderBy(desc(rooms.createdAt));
    return ok(c, await Promise.all(rows.map((r) => toRoom(db, r, c.var.user, { withEvents: false }))));
  })
  // SPEC-001 endpoint 20
  .post("/rooms/:code/payment/confirm", async (c) => {
    const me = c.var.user;
    const room = await findRoomByCode(db, c.req.param("code"));
    assertStatus(room, "SLIP_REVIEW");
    await db.transaction(async (tx) => {
      await transition(tx, room, ["SLIP_REVIEW"], { status: "PAID_WAITING_DELIVERY", paymentConfirmedAt: now() });
      await addEvent(tx, room.id, "PAYMENT_CONFIRMED", "ADMIN", me.id);
    });
    return ok(c, await toRoom(db, await findRoomByCode(db, room.code), me));
  })
  // SPEC-001 endpoint 21 — slip kept for the record, reason on the event
  .post("/rooms/:code/payment/reject", validate("json", rejectSchema), async (c) => {
    const me = c.var.user;
    const { reason } = c.req.valid("json");
    const room = await findRoomByCode(db, c.req.param("code"));
    assertStatus(room, "SLIP_REVIEW");
    await db.transaction(async (tx) => {
      await transition(tx, room, ["SLIP_REVIEW"], { status: "WAITING_PAYMENT", rejectReason: reason });
      await addEvent(tx, room.id, "PAYMENT_REJECTED", "ADMIN", me.id, reason);
    });
    return ok(c, await toRoom(db, await findRoomByCode(db, room.code), me));
  })
  // SPEC-001 endpoint 22 — credit is derived; nothing else to write
  .post("/rooms/:code/payout", async (c) => {
    const me = c.var.user;
    const room = await findRoomByCode(db, c.req.param("code"));
    assertStatus(room, "WAITING_PAYOUT");
    const at = now();
    await db.transaction(async (tx) => {
      await transition(tx, room, ["WAITING_PAYOUT"], { status: "COMPLETED", paidOutAt: at, completedAt: at });
      await addEvent(tx, room.id, "PAID_OUT", "ADMIN", me.id);
    });
    return ok(c, await toRoom(db, await findRoomByCode(db, room.code), me));
  })
  // SPEC-001 endpoint 23 — new rooms only (AC-5)
  .put("/fee-settings", validate("json", feeSettingsSchema), async (c) => ok(c, await updateSettings(db, c.req.valid("json"))))
  // SPEC-001 endpoint 24 — the same sweep as the interval, now
  .post("/jobs/auto-release", async (c) => ok(c, { released: await runAutoRelease() }));
