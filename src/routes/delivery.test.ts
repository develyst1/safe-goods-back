import { beforeAll, describe, expect, test } from "bun:test";
import { sql } from "../db/client";
import { env } from "../env";
import { runAutoRelease } from "../jobs/autoRelease";
import { api, PNG, readJson, resetDb, upload } from "../test/helpers";

beforeAll(resetDb);

// Raw UPDATE on the test DB: put a room's auto_release_at in the past (TASK-012 §2).
const makeDue = (code: string) => sql`UPDATE rooms SET auto_release_at = now() - interval '1 second' WHERE code = ${code}`;
const countEvents = async (code: string, type: string) =>
  Number((await sql`SELECT count(*)::int AS n FROM room_events e JOIN rooms r ON r.id = e.room_id WHERE r.code = ${code} AND e.type = ${type}`)[0]?.n ?? 0);

const register = async (name: string) => {
  const res = await api("/auth/register", { body: { displayName: name, email: `${name.toLowerCase()}-dlv@local.test`, password: "password1" } });
  return (await readJson(res)).data.token as string;
};
const login = async (email: string, password: string) => (await readJson(await api("/auth/login", { body: { email, password } }))).data.token as string;
const room = async (code: string, token: string) => (await readJson(await api(`/rooms/${code}`, { token }))).data;
const me = async (token: string) => (await readJson(await api("/auth/me", { token }))).data;

let A: string; // seller
let B: string; // buyer
let ADMIN: string;

// A room in PAID_WAITING_DELIVERY for the given category.
const paidRoom = async (categoryId: number) => {
  const open = await api("/rooms", { token: A, body: { myRole: "SELLER", categoryId, description: `cat ${categoryId}`, priceMode: "FEE_ADDED", feePayer: "BUYER", enteredPrice: 100 } });
  const code = (await readJson(open)).data.code as string;
  await api(`/rooms/${code}/join`, { token: B, method: "POST" });
  await upload(`/rooms/${code}/slip`, B, { bytes: PNG, type: "image/png", name: "slip.png" });
  const conf = await api(`/admin/rooms/${code}/payment/confirm`, { token: ADMIN, method: "POST" });
  expect((await readJson(conf)).data.status).toBe("PAID_WAITING_DELIVERY");
  return code;
};

beforeAll(async () => {
  [A, B] = await Promise.all([register("Da"), register("Db")]);
  ADMIN = await login(env.ADMIN_EMAIL, env.ADMIN_PASSWORD);
});

describe("delivery → payout (SPEC-001 endpoints 14–17, 22–24)", () => {
  let R1: string; // IN_GAME
  let R2: string; // PHYSICAL

  test("R1 IN_GAME: deliver without evidence → 422; evidence keeps status; deliver → DELIVERED_WAITING_CONFIRM with timer (AC-14, AC-15)", async () => {
    R1 = await paidRoom(1);
    const noEvidence = await api(`/rooms/${R1}/deliver`, { token: A, body: {} });
    expect(noEvidence.status).toBe(422);
    expect((await readJson(noEvidence)).error.code).toBe("EVIDENCE_REQUIRED");

    expect((await upload(`/rooms/${R1}/evidence`, B, { bytes: PNG, type: "image/png", name: "e.png" })).status).toBe(403); // buyer cannot
    const ev = await upload(`/rooms/${R1}/evidence`, A, { bytes: PNG, type: "image/png", name: "e.png" });
    expect(ev.status).toBe(200);
    const withEvidence = (await readJson(ev)).data;
    expect(withEvidence.status).toBe("PAID_WAITING_DELIVERY");
    expect(withEvidence.delivery.evidence).toHaveLength(1);
    expect(withEvidence.delivery.evidence[0]).toMatchObject({ kind: "EVIDENCE", fileName: "e.png" });
    expect(withEvidence.events.map((e: { type: string }) => e.type)).not.toContain("DELIVERED");

    expect((await api(`/rooms/${R1}/deliver`, { token: B, body: {} })).status).toBe(403);
    const before = Date.now();
    const dlv = await api(`/rooms/${R1}/deliver`, { token: A, body: {} });
    expect(dlv.status).toBe(200);
    const delivered = (await readJson(dlv)).data;
    expect(delivered.status).toBe("DELIVERED_WAITING_CONFIRM");
    expect(delivered.delivery.deliveredAt).toEqual(expect.any(String));
    const expectedRelease = before + env.AUTO_RELEASE_SECONDS * 1000;
    expect(Math.abs(Date.parse(delivered.autoReleaseAt) - expectedRelease)).toBeLessThan(5000);
    expect(delivered.events.at(-1)).toMatchObject({ type: "DELIVERED", actorRole: "SELLER" });
    expect((await api(`/rooms/${R1}/deliver`, { token: A, body: {} })).status).toBe(409);
  });

  test("R2 PHYSICAL: deliver needs courier + trackingNumber → SHIPPED_WAITING_PARCEL without timer (AC-16, AC-17)", async () => {
    R2 = await paidRoom(2);
    await upload(`/rooms/${R2}/evidence`, A, { bytes: PNG, type: "image/png", name: "e.png" });
    const noTracking = await api(`/rooms/${R2}/deliver`, { token: A, body: {} });
    expect(noTracking.status).toBe(422);
    expect((await readJson(noTracking)).error.code).toBe("TRACKING_REQUIRED");
    expect((await api(`/rooms/${R2}/deliver`, { token: A, body: { courier: "Kerry", trackingNumber: "  " } })).status).toBe(422);

    const shipped = (await readJson(await api(`/rooms/${R2}/deliver`, { token: A, body: { courier: "Kerry", trackingNumber: "KE123" } }))).data;
    expect(shipped.status).toBe("SHIPPED_WAITING_PARCEL");
    expect(shipped.autoReleaseAt).toBeNull();
    expect(shipped.delivery).toMatchObject({ courier: "Kerry", trackingNumber: "KE123" });
  });

  test("R2: received before parcel arrives → 409; buyer parcel-arrived → timer; received → WAITING_PAYOUT by BUYER (AC-18, AC-19)", async () => {
    expect((await api(`/rooms/${R2}/received`, { token: B, method: "POST" })).status).toBe(409);
    expect((await api(`/rooms/${R2}/parcel-arrived`, { token: A, method: "POST" })).status).toBe(403); // seller cannot

    const arrived = (await readJson(await api(`/rooms/${R2}/parcel-arrived`, { token: B, method: "POST" }))).data;
    expect(arrived.status).toBe("PARCEL_ARRIVED_WAITING_CONFIRM");
    expect(arrived.autoReleaseAt).toEqual(expect.any(String));
    expect(arrived.delivery.parcelArrivedAt).toEqual(expect.any(String));
    expect(arrived.events.at(-1)).toMatchObject({ type: "PARCEL_ARRIVED", actorRole: "BUYER" });

    expect((await api(`/rooms/${R2}/received`, { token: A, method: "POST" })).status).toBe(403);
    const received = (await readJson(await api(`/rooms/${R2}/received`, { token: B, method: "POST" }))).data;
    expect(received).toMatchObject({ status: "WAITING_PAYOUT", releasedBy: "BUYER", autoReleaseAt: null });
    expect(received.releasedAt).toEqual(expect.any(String));
    expect(received.events.at(-1)).toMatchObject({ type: "RECEIVED_CONFIRMED", actorRole: "BUYER" });
  });

  test("admin can mark parcel arrived on a third room → actorRole ADMIN", async () => {
    const R3 = await paidRoom(2);
    await upload(`/rooms/${R3}/evidence`, A, { bytes: PNG, type: "image/png", name: "e.png" });
    await api(`/rooms/${R3}/deliver`, { token: A, body: { courier: "Flash", trackingNumber: "FL1" } });
    const arrived = (await readJson(await api(`/rooms/${R3}/parcel-arrived`, { token: ADMIN, method: "POST" }))).data;
    expect(arrived.status).toBe("PARCEL_ARRIVED_WAITING_CONFIRM");
    expect(arrived.myRole).toBe("ADMIN");
    expect(arrived.events.at(-1)).toMatchObject({ type: "PARCEL_ARRIVED", actorRole: "ADMIN", actorDisplayName: env.ADMIN_DISPLAY_NAME });
  });

  test("auto-release: future → 0; past → released by SYSTEM; second run → 0 (AC-20)", async () => {
    expect(await runAutoRelease()).toBe(0); // R1's autoReleaseAt is 3 days out
    expect((await room(R1, B)).status).toBe("DELIVERED_WAITING_CONFIRM");

    await makeDue(R1);

    expect((await api("/admin/jobs/auto-release", { token: B, method: "POST" })).status).toBe(403);
    const job = await api("/admin/jobs/auto-release", { token: ADMIN, method: "POST" });
    expect((await readJson(job)).data).toEqual({ released: 1 });
    const released = await room(R1, B);
    expect(released).toMatchObject({ status: "WAITING_PAYOUT", releasedBy: "SYSTEM", autoReleaseAt: null });
    expect(released.events.at(-1)).toMatchObject({ type: "AUTO_RELEASED", actorRole: "SYSTEM", actorDisplayName: null });

    expect((await readJson(await api("/admin/jobs/auto-release", { token: ADMIN, method: "POST" }))).data).toEqual({ released: 0 });
  });

  test("status-guard race: two concurrent received → exactly one 200 + one 409, one RECEIVED_CONFIRMED event (SPEC-002 §Flow)", async () => {
    const R4 = await paidRoom(1);
    await upload(`/rooms/${R4}/evidence`, A, { bytes: PNG, type: "image/png", name: "e.png" });
    await api(`/rooms/${R4}/deliver`, { token: A, body: {} });
    const [x, y] = await Promise.all([api(`/rooms/${R4}/received`, { token: B, method: "POST" }), api(`/rooms/${R4}/received`, { token: B, method: "POST" })]);
    expect([x.status, y.status].sort()).toEqual([200, 409]);
    const lost = x.status === 409 ? x : y;
    expect((await readJson(lost)).error.code).toBe("INVALID_STATE");
    expect(await countEvents(R4, "RECEIVED_CONFIRMED")).toBe(1);
    expect(await room(R4, B)).toMatchObject({ status: "WAITING_PAYOUT", releasedBy: "BUYER" });
  });

  test("auto-release with two due rooms → 2, again → 0, two AUTO_RELEASED events", async () => {
    const codes = [await paidRoom(1), await paidRoom(1)];
    for (const cd of codes) {
      await upload(`/rooms/${cd}/evidence`, A, { bytes: PNG, type: "image/png", name: "e.png" });
      expect((await readJson(await api(`/rooms/${cd}/deliver`, { token: A, body: {} }))).data.status).toBe("DELIVERED_WAITING_CONFIRM");
      await makeDue(cd);
    }
    expect(await runAutoRelease()).toBe(2);
    expect(await runAutoRelease()).toBe(0);
    for (const cd of codes) {
      expect(await countEvents(cd, "AUTO_RELEASED")).toBe(1);
      expect(await room(cd, B)).toMatchObject({ status: "WAITING_PAYOUT", releasedBy: "SYSTEM", autoReleaseAt: null });
    }
  });

  test("payout → COMPLETED; both parties' goodCloseCount +1; closed room rejects every action (AC-21, AC-22, AC-25)", async () => {
    const beforeA = (await me(A)).credit.goodCloseCount;
    const beforeB = (await me(B)).credit.goodCloseCount;

    expect((await api(`/admin/rooms/${R1}/payout`, { token: B, method: "POST" })).status).toBe(403);
    const paid = (await readJson(await api(`/admin/rooms/${R1}/payout`, { token: ADMIN, method: "POST" }))).data;
    expect(paid.status).toBe("COMPLETED");
    expect(paid.paidOutAt).toEqual(expect.any(String));
    expect(paid.completedAt).toBe(paid.paidOutAt);
    expect(paid.events.at(-1)).toMatchObject({ type: "PAID_OUT", actorRole: "ADMIN" });
    expect(paid.buyer.credit.goodCloseCount).toBe(beforeB + 1);
    expect(paid.seller.credit.goodCloseCount).toBe(beforeA + 1);
    expect((await me(A)).credit.goodCloseCount).toBe(beforeA + 1);
    expect((await me(B)).credit.goodCloseCount).toBe(beforeB + 1);

    const statuses = await Promise.all([
      api(`/rooms/${R1}/deliver`, { token: A, body: {} }),
      api(`/rooms/${R1}/received`, { token: B, method: "POST" }),
      api(`/rooms/${R1}/cancel`, { token: B, method: "POST" }),
      api(`/rooms/${R1}/parcel-arrived`, { token: B, method: "POST" }),
      upload(`/rooms/${R1}/slip`, B, { bytes: PNG, type: "image/png", name: "slip.png" }),
      api(`/admin/rooms/${R1}/payout`, { token: ADMIN, method: "POST" }),
      upload(`/rooms/${R1}/evidence`, A, { bytes: PNG, type: "image/png", name: "e.png" }),
      api(`/rooms/${R1}/join`, { token: A, method: "POST" }),
    ]);
    expect(statuses.map((r) => r.status)).toEqual([409, 409, 409, 409, 409, 409, 409, 409]);
    for (const r of statuses) expect((await readJson(r)).error.code).toBe("INVALID_STATE");
  });

  test("fee settings: PUT changes quotes for new rooms only; existing rooms keep frozen amounts (AC-5)", async () => {
    expect((await api("/admin/fee-settings", { token: B, method: "PUT", body: { feeRatePercent: 10, feeMinimum: 30 } })).status).toBe(403);
    expect((await api("/admin/fee-settings", { token: ADMIN, method: "PUT", body: { feeRatePercent: 101, feeMinimum: 30 } })).status).toBe(400);

    const put = await api("/admin/fee-settings", { token: ADMIN, method: "PUT", body: { feeRatePercent: 10, feeMinimum: 30 } });
    expect((await readJson(put)).data).toEqual({ feeRatePercent: 10, feeMinimum: 30 });
    expect((await readJson(await api("/fee/settings", { token: A }))).data).toEqual({ feeRatePercent: 10, feeMinimum: 30 });
    expect((await readJson(await api("/fee/quote", { body: { priceMode: "FEE_ADDED", feePayer: "BUYER", enteredPrice: 100 } }))).data.fee).toBe(30);
    expect((await room(R1, A)).amounts).toMatchObject({ fee: 20, feeRatePercent: 20, feeMinimum: 20 });

    const restore = await api("/admin/fee-settings", { token: ADMIN, method: "PUT", body: { feeRatePercent: 20, feeMinimum: 20 } });
    expect((await readJson(restore)).data).toEqual({ feeRatePercent: 20, feeMinimum: 20 });
  });
});
