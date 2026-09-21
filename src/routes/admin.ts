import { desc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { db } from "../db/client";
import { rooms } from "../db/schema";
import { addEvent } from "../domain/events";
import { updateSettings } from "../db/settings";
import { assertStatus, ROOM_STATUSES } from "../domain/roomStatus";
import { runAutoRelease } from "../jobs/autoRelease";
import { ok } from "../lib/http";
import { nowIso } from "../lib/time";
import { validate } from "../lib/validate";
import { requireAdmin, requireAuth, type AuthEnv } from "../middleware/auth";
import { findRoomByCode, toRoom } from "../serializers/room";

const listQuerySchema = z.object({ status: z.enum(ROOM_STATUSES).optional() });
const rejectSchema = z.object({ reason: z.string().min(1).max(200) });
const feeSettingsSchema = z.object({ feeRatePercent: z.number().int().min(0).max(100), feeMinimum: z.number().int().min(0) });

export const admin = new Hono<AuthEnv>()
  .use("*", requireAuth, requireAdmin)
  // SPEC-001 endpoint 19
  .get("/rooms", validate("query", listQuerySchema), (c) => {
    const { status } = c.req.valid("query");
    const q = db.select().from(rooms);
    const rows = (status ? q.where(eq(rooms.status, status)) : q).orderBy(desc(rooms.createdAt)).all();
    return ok(c, rows.map((r) => toRoom(db, r, c.var.user, { withEvents: false })));
  })
  // SPEC-001 endpoint 20
  .post("/rooms/:code/payment/confirm", (c) => {
    const me = c.var.user;
    const room = findRoomByCode(db, c.req.param("code"));
    assertStatus(room, "SLIP_REVIEW");
    const now = nowIso();
    db.transaction((tx) => {
      tx.update(rooms).set({ status: "PAID_WAITING_DELIVERY", paymentConfirmedAt: now, updatedAt: now }).where(eq(rooms.id, room.id)).run();
      addEvent(tx, room.id, "PAYMENT_CONFIRMED", "ADMIN", me.id);
    });
    return ok(c, toRoom(db, findRoomByCode(db, room.code), me));
  })
  // SPEC-001 endpoint 21 — slip kept for the record, reason on the event
  .post("/rooms/:code/payment/reject", validate("json", rejectSchema), (c) => {
    const me = c.var.user;
    const { reason } = c.req.valid("json");
    const room = findRoomByCode(db, c.req.param("code"));
    assertStatus(room, "SLIP_REVIEW");
    const now = nowIso();
    db.transaction((tx) => {
      tx.update(rooms).set({ status: "WAITING_PAYMENT", rejectReason: reason, updatedAt: now }).where(eq(rooms.id, room.id)).run();
      addEvent(tx, room.id, "PAYMENT_REJECTED", "ADMIN", me.id, reason);
    });
    return ok(c, toRoom(db, findRoomByCode(db, room.code), me));
  })
  // SPEC-001 endpoint 22 — credit is derived; nothing else to write
  .post("/rooms/:code/payout", (c) => {
    const me = c.var.user;
    const room = findRoomByCode(db, c.req.param("code"));
    assertStatus(room, "WAITING_PAYOUT");
    const now = nowIso();
    db.transaction((tx) => {
      tx.update(rooms).set({ status: "COMPLETED", paidOutAt: now, completedAt: now, updatedAt: now }).where(eq(rooms.id, room.id)).run();
      addEvent(tx, room.id, "PAID_OUT", "ADMIN", me.id);
    });
    return ok(c, toRoom(db, findRoomByCode(db, room.code), me));
  })
  // SPEC-001 endpoint 23 — new rooms only (AC-5)
  .put("/fee-settings", validate("json", feeSettingsSchema), (c) => ok(c, updateSettings(db, c.req.valid("json"))))
  // SPEC-001 endpoint 24 — the same sweep as the interval, now
  .post("/jobs/auto-release", (c) => ok(c, { released: runAutoRelease() }));
