import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { z } from "zod";
import { app } from "./app";
import { AppError, ok } from "./lib/http";
import { validate } from "./lib/validate";

// Throwaway routes must be mounted before the first request (Hono freezes its router then).
const t = new Hono();
t.post("/v", validate("json", z.object({ n: z.number() })), (c) => ok(c, c.req.valid("json")));
t.get("/app-error", () => {
  throw new AppError(409, "ROOM_FULL", "room already has a buyer and a seller");
});
t.get("/boom", () => {
  throw new Error("secret stack");
});
app.route("/test", t);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const readJson = (r: Response): Promise<any> => r.json();
const json = (body: unknown) => ({ method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });

describe("envelope (SPEC-001 §Envelope & errors)", () => {
  test("GET /api/v1/health", async () => {
    const res = await app.request("/api/v1/health");
    expect(res.status).toBe(200);
    const body = await readJson(res);
    expect(body.success).toBe(true);
    expect(body.data.ok).toBe(true);
    expect(typeof body.data.time).toBe("string");
  });

  test("unknown route → 404 NOT_FOUND", async () => {
    const res = await app.request("/api/v1/nope");
    expect(res.status).toBe(404);
    expect(await readJson(res)).toMatchObject({ success: false, error: { code: "NOT_FOUND" } });
  });

  test("zod failure → 400 VALIDATION_ERROR with issues", async () => {
    const bad = await app.request("/test/v", json({ n: "x" }));
    expect(bad.status).toBe(400);
    const body = await readJson(bad);
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(Array.isArray(body.error.details)).toBe(true);

    const good = await app.request("/test/v", json({ n: 1 }));
    expect(await readJson(good)).toEqual({ success: true, data: { n: 1 } });
  });

  test("AppError → its status + code; unknown error → 500 INTERNAL without the stack", async () => {
    const appErr = await app.request("/test/app-error");
    expect(appErr.status).toBe(409);
    expect((await readJson(appErr)).error.code).toBe("ROOM_FULL");

    const boom = await app.request("/test/boom");
    expect(boom.status).toBe(500);
    const body = await readJson(boom);
    expect(body.error.code).toBe("INTERNAL");
    expect(JSON.stringify(body)).not.toContain("secret stack");
  });
});
