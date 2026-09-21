import { beforeAll, describe, expect, test } from "bun:test";
import { app } from "../app";
import { env } from "../env";
import { api, PNG, readJson, resetDb, upload } from "../test/helpers";

beforeAll(resetDb);

const register = async (name: string) => {
  const res = await api("/auth/register", { body: { displayName: name, email: `${name.toLowerCase()}-pay@local.test`, password: "password1" } });
  return (await readJson(res)).data.token as string;
};
const login = async (email: string, password: string) => (await readJson(await api("/auth/login", { body: { email, password } }))).data.token as string;

let A: string; // seller
let B: string; // buyer
let C: string; // outsider
let ADMIN: string;
let code: string;

beforeAll(async () => {
  [A, B, C] = await Promise.all([register("Pa"), register("Pb"), register("Pc")]);
  ADMIN = await login(env.ADMIN_EMAIL, env.ADMIN_PASSWORD);
  const open = await api("/rooms", { token: A, body: { myRole: "SELLER", categoryId: 1, description: "Skin", priceMode: "FEE_ADDED", feePayer: "BUYER", enteredPrice: 100 } });
  code = (await readJson(open)).data.code;
  await api(`/rooms/${code}/join`, { token: B, method: "POST" });
});

describe("payment-in (SPEC-001 endpoints 13, 18–21)", () => {
  test("seller / outsider cannot upload a slip → 403", async () => {
    expect((await upload(`/rooms/${code}/slip`, A, { bytes: PNG, type: "image/png", name: "slip.png" })).status).toBe(403);
    expect((await upload(`/rooms/${code}/slip`, C, { bytes: PNG, type: "image/png", name: "slip.png" })).status).toBe(403);
  });

  test("bad file type / too large → 400 VALIDATION_ERROR, room untouched", async () => {
    const txt = await upload(`/rooms/${code}/slip`, B, { bytes: Buffer.from("hello"), type: "text/plain", name: "slip.txt" });
    expect(txt.status).toBe(400);
    expect((await readJson(txt)).error.code).toBe("VALIDATION_ERROR");
    const big = await upload(`/rooms/${code}/slip`, B, { bytes: new Uint8Array(5 * 1024 * 1024 + 1), type: "image/png", name: "big.png" });
    expect(big.status).toBe(400);
    expect((await readJson(await api(`/rooms/${code}`, { token: B }))).data.status).toBe("WAITING_PAYMENT");
  });

  let slipId: string;

  test("buyer uploads slip → SLIP_REVIEW with FileRef (AC-9)", async () => {
    const res = await upload(`/rooms/${code}/slip`, B, { bytes: PNG, type: "image/png", name: "slip.png" });
    expect(res.status).toBe(200);
    const room = (await readJson(res)).data;
    expect(room.status).toBe("SLIP_REVIEW");
    expect(room.payment.rejectReason).toBeNull();
    expect(room.payment.slip).toMatchObject({ kind: "SLIP", fileName: "slip.png", mimeType: "image/png", sizeBytes: PNG.length });
    expect(room.payment.slip.url).toBe(`/api/v1/files/${room.payment.slip.id}`);
    expect(room.events.at(-1)).toMatchObject({ type: "SLIP_UPLOADED", actorRole: "BUYER" });
    slipId = room.payment.slip.id;

    const again = await upload(`/rooms/${code}/slip`, B, { bytes: PNG, type: "image/png", name: "slip.png" });
    expect(again.status).toBe(409); // not WAITING_PAYMENT any more
  });

  test("files: member 200 with content-type; outsider 403; unknown 404; no token 401", async () => {
    const asB = await app.request(`/api/v1/files/${slipId}`, { headers: { authorization: `Bearer ${B}` } });
    expect(asB.status).toBe(200);
    expect(asB.headers.get("content-type")).toBe("image/png");
    expect(asB.headers.get("cache-control")).toBe("private, no-store");
    expect(new Uint8Array(await asB.arrayBuffer())).toEqual(new Uint8Array(PNG));
    expect((await app.request(`/api/v1/files/${slipId}`, { headers: { authorization: `Bearer ${A}` } })).status).toBe(200);
    expect((await app.request(`/api/v1/files/${slipId}`, { headers: { authorization: `Bearer ${ADMIN}` } })).status).toBe(200);
    expect((await app.request(`/api/v1/files/${slipId}`, { headers: { authorization: `Bearer ${C}` } })).status).toBe(403);
    expect((await app.request(`/api/v1/files/00000000-0000-4000-8000-000000000000`, { headers: { authorization: `Bearer ${B}` } })).status).toBe(404);
    expect((await app.request(`/api/v1/files/not-a-uuid`, { headers: { authorization: `Bearer ${B}` } })).status).toBe(404);
    expect((await app.request(`/api/v1/files/${slipId}`)).status).toBe(401);
  });

  test("admin list: filter by status, events: [], myRole ADMIN; normal user → 403 (AC-27)", async () => {
    const res = await api("/admin/rooms?status=SLIP_REVIEW", { token: ADMIN });
    expect(res.status).toBe(200);
    const list = (await readJson(res)).data;
    expect(list.map((r: { code: string }) => r.code)).toContain(code);
    expect(list[0].events).toEqual([]);
    expect(list[0].myRole).toBe("ADMIN");
    expect((await readJson(await api("/admin/rooms", { token: ADMIN }))).data.length).toBeGreaterThanOrEqual(list.length);
    expect((await api("/admin/rooms?status=NOPE", { token: ADMIN })).status).toBe(400);
    expect((await api("/admin/rooms?status=SLIP_REVIEW", { token: B })).status).toBe(403);
    expect((await api(`/admin/rooms/${code}/payment/confirm`, { token: B, method: "POST" })).status).toBe(403);
  });

  test("reject → WAITING_PAYMENT with reason; re-upload clears it; confirm → PAID_WAITING_DELIVERY (AC-10, AC-11)", async () => {
    const rej = await api(`/admin/rooms/${code}/payment/reject`, { token: ADMIN, body: { reason: "ยอดไม่ตรง" } });
    expect(rej.status).toBe(200);
    const rejected = (await readJson(rej)).data;
    expect(rejected.status).toBe("WAITING_PAYMENT");
    expect(rejected.payment.rejectReason).toBe("ยอดไม่ตรง");
    expect(rejected.payment.slip.id).toBe(slipId); // kept for the record
    expect(rejected.events.at(-1)).toMatchObject({ type: "PAYMENT_REJECTED", actorRole: "ADMIN", note: "ยอดไม่ตรง" });
    expect((await api(`/admin/rooms/${code}/payment/reject`, { token: ADMIN, body: { reason: "" } })).status).toBe(400);
    expect((await api(`/admin/rooms/${code}/payment/confirm`, { token: ADMIN, method: "POST" })).status).toBe(409); // not SLIP_REVIEW

    const re = await upload(`/rooms/${code}/slip`, B, { bytes: PNG, type: "image/jpeg", name: "slip2.jpg" });
    const reRoom = (await readJson(re)).data;
    expect(reRoom.status).toBe("SLIP_REVIEW");
    expect(reRoom.payment.rejectReason).toBeNull();
    expect(reRoom.payment.slip.id).not.toBe(slipId);

    const conf = await api(`/admin/rooms/${code}/payment/confirm`, { token: ADMIN, method: "POST" });
    expect(conf.status).toBe(200);
    const confirmed = (await readJson(conf)).data;
    expect(confirmed.status).toBe("PAID_WAITING_DELIVERY");
    expect(confirmed.payment.confirmedAt).toEqual(expect.any(String));
    expect(confirmed.canCancel).toBe(false);
    expect(confirmed.events.at(-1)).toMatchObject({ type: "PAYMENT_CONFIRMED", actorRole: "ADMIN", actorDisplayName: env.ADMIN_DISPLAY_NAME });
  });

  test("after confirm: cancel → 409 INVALID_STATE (AC-13); reject → 409", async () => {
    const res = await api(`/rooms/${code}/cancel`, { token: B, method: "POST" });
    expect(res.status).toBe(409);
    expect((await readJson(res)).error.code).toBe("INVALID_STATE");
    expect((await api(`/admin/rooms/${code}/payment/reject`, { token: ADMIN, body: { reason: "late" } })).status).toBe(409);
  });
});
