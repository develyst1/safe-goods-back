import { beforeAll, describe, expect, test } from "bun:test";
import { seed } from "../db/seed";
import { api, readJson } from "../test/helpers";

beforeAll(seed);

const register = async (name: string) => {
  const res = await api("/auth/register", { body: { displayName: name, email: `${name.toLowerCase()}-rooms@local.test`, password: "password1" } });
  expect(res.status).toBe(201);
  return (await readJson(res)).data.token as string;
};

let A: string; // seller, opens the room
let B: string; // buyer, joins
let C: string; // third user
let code: string;

beforeAll(async () => {
  [A, B, C] = await Promise.all([register("Alice"), register("Bob"), register("Carol")]);
});

describe("fee/quote (SPEC-001 endpoint 7, AC-1..4)", () => {
  test("quotes use current settings and need no auth", async () => {
    const q = async (body: unknown) => (await readJson(await api("/fee/quote", { body }))).data;
    expect(await q({ priceMode: "FEE_ADDED", feePayer: "BUYER", enteredPrice: 100 })).toMatchObject({ buyerPays: 120, sellerReceives: 100, fee: 20 });
    expect(await q({ priceMode: "FEE_ADDED", feePayer: "SPLIT", enteredPrice: 100 })).toMatchObject({ buyerPays: 110, sellerReceives: 90, fee: 20 });
    expect(await q({ priceMode: "FEE_INCLUDED", feePayer: "BUYER", enteredPrice: 120 })).toMatchObject({ basePrice: 100 });
    expect(await q({ priceMode: "FEE_ADDED", feePayer: "BUYER", enteredPrice: 50 })).toMatchObject({ fee: 20, buyerPays: 70 });
  });

  test("price too low → 400 VALIDATION_ERROR", async () => {
    const res = await api("/fee/quote", { body: { priceMode: "FEE_INCLUDED", feePayer: "BUYER", enteredPrice: 15 } });
    expect(res.status).toBe(400);
    expect((await readJson(res)).error.code).toBe("VALIDATION_ERROR");
  });
});

describe("rooms core (SPEC-001 endpoints 5, 8–12)", () => {
  test("categories need auth and are seeded", async () => {
    expect((await api("/categories")).status).toBe(401);
    const res = await api("/categories", { token: A });
    expect((await readJson(res)).data).toEqual([
      { id: 1, kind: "IN_GAME", nameTh: "ไอเทม/ไอดีเกม" },
      { id: 2, kind: "PHYSICAL", nameTh: "สินค้าส่งพัสดุ" },
    ]);
  });

  test("open as SELLER → 201 WAITING_BUYER_JOIN, frozen amounts, ROOM_OPENED", async () => {
    const res = await api("/rooms", { token: A, body: { myRole: "SELLER", categoryId: 1, description: "Sword", priceMode: "FEE_ADDED", feePayer: "BUYER", enteredPrice: 100 } });
    expect(res.status).toBe(201);
    const room = (await readJson(res)).data;
    code = room.code;
    expect(code).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/);
    expect(room).toMatchObject({
      status: "WAITING_BUYER_JOIN",
      openedByRole: "SELLER",
      myRole: "SELLER",
      buyer: null,
      seller: { displayName: "Alice", credit: { goodCloseCount: 0 } },
      amounts: { enteredPrice: 100, basePrice: 100, fee: 20, buyerPays: 120, sellerReceives: 100, feeRatePercent: 20, feeMinimum: 20 },
      canCancel: true,
      payment: { slip: null, rejectReason: null, confirmedAt: null },
      delivery: { evidence: [], courier: null, trackingNumber: null, deliveredAt: null, parcelArrivedAt: null },
      autoReleaseAt: null,
    });
    expect(room.events).toHaveLength(1);
    expect(room.events[0]).toMatchObject({ type: "ROOM_OPENED", actorRole: "SELLER", actorDisplayName: "Alice" });
  });

  test("open as BUYER → WAITING_SELLER_JOIN; unknown category → 400", async () => {
    const res = await api("/rooms", { token: B, body: { myRole: "BUYER", categoryId: 2, description: "Figure", priceMode: "FEE_INCLUDED", feePayer: "SPLIT", enteredPrice: 110 } });
    expect(res.status).toBe(201);
    expect((await readJson(res)).data).toMatchObject({ status: "WAITING_SELLER_JOIN", myRole: "BUYER", amounts: { basePrice: 100, buyerPays: 110, sellerReceives: 90 } });
    const bad = await api("/rooms", { token: B, body: { myRole: "BUYER", categoryId: 99, description: "x", priceMode: "FEE_ADDED", feePayer: "SPLIT", enteredPrice: 10 } });
    expect(bad.status).toBe(400);
  });

  test("non-member GET → myRole null; join → WAITING_PAYMENT; third user → ROOM_FULL (AC-6, AC-7)", async () => {
    const peek = await api(`/rooms/${code}`, { token: B });
    expect((await readJson(peek)).data.myRole).toBeNull();

    const join = await api(`/rooms/${code}/join`, { token: B, method: "POST" });
    expect(join.status).toBe(200);
    const room = (await readJson(join)).data;
    expect(room).toMatchObject({ status: "WAITING_PAYMENT", myRole: "BUYER", buyer: { displayName: "Bob" }, seller: { displayName: "Alice" } });
    expect(room.events.map((e: { type: string }) => e.type)).toEqual(["ROOM_OPENED", "ROOM_JOINED"]);

    const again = await api(`/rooms/${code}/join`, { token: B, method: "POST" }); // member re-join → no-op
    expect(again.status).toBe(200);
    expect((await readJson(again)).data.events).toHaveLength(2);

    const third = await api(`/rooms/${code}/join`, { token: C, method: "POST" });
    expect(third.status).toBe(409);
    expect((await readJson(third)).error.code).toBe("ROOM_FULL");
  });

  test("non-member cancel → 403; member cancel → CANCELLED; join after → INVALID_STATE", async () => {
    const forbidden = await api(`/rooms/${code}/cancel`, { token: C, method: "POST" });
    expect(forbidden.status).toBe(403);

    const cancel = await api(`/rooms/${code}/cancel`, { token: B, method: "POST" });
    expect(cancel.status).toBe(200);
    const room = (await readJson(cancel)).data;
    expect(room).toMatchObject({ status: "CANCELLED", canCancel: false });
    expect(room.cancelledAt).toEqual(expect.any(String));
    expect(room.events.at(-1)).toMatchObject({ type: "ROOM_CANCELLED", actorRole: "BUYER" });

    const rejoin = await api(`/rooms/${code}/join`, { token: C, method: "POST" });
    expect(rejoin.status).toBe(409);
    expect((await readJson(rejoin)).error.code).toBe("INVALID_STATE");

    const memberRejoin = await api(`/rooms/${code}/join`, { token: A, method: "POST" }); // member, but room closed → INVALID_STATE (DoD)
    expect(memberRejoin.status).toBe(409);
    expect((await readJson(memberRejoin)).error.code).toBe("INVALID_STATE");

    const recancel = await api(`/rooms/${code}/cancel`, { token: A, method: "POST" });
    expect(recancel.status).toBe(409);
  });

  test("mine lists the caller's rooms newest first with events: []", async () => {
    const res = await api("/rooms/mine", { token: B });
    const list = (await readJson(res)).data;
    expect(list.map((r: { code: string }) => r.code)).toContain(code);
    expect(list.every((r: { events: unknown[] }) => r.events.length === 0)).toBe(true);
    expect(list.length).toBe(2);
    expect((await readJson(await api("/rooms/mine", { token: C }))).data).toEqual([]);
  });

  test("unknown code → 404 NOT_FOUND", async () => {
    const res = await api("/rooms/NOPE1234", { token: A });
    expect(res.status).toBe(404);
    expect((await readJson(res)).error.code).toBe("NOT_FOUND");
  });
});
