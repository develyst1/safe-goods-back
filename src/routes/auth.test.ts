import { beforeAll, describe, expect, test } from "bun:test";
import { env } from "../env";
import { api, readJson, resetDb } from "../test/helpers";

beforeAll(resetDb);

const creds = { displayName: "Tanya", email: "T1@local.test", password: "password1" };

describe("auth (SPEC-001 endpoints 2–4)", () => {
  test("register → login → me happy path; password hash never leaks", async () => {
    const reg = await api("/auth/register", { body: creds });
    expect(reg.status).toBe(201);
    const regBody = await readJson(reg);
    expect(regBody.success).toBe(true);
    expect(typeof regBody.data.token).toBe("string");
    expect(regBody.data.user).toEqual({
      id: expect.any(String),
      email: "t1@local.test",
      displayName: "Tanya",
      role: "USER",
      credit: { goodCloseCount: 0 },
    });
    expect(JSON.stringify(regBody)).not.toContain("argon2");

    const login = await api("/auth/login", { body: { email: creds.email, password: creds.password } });
    expect(login.status).toBe(200);
    const loginBody = await readJson(login);
    expect(loginBody.data.user.id).toBe(regBody.data.user.id);
    expect(JSON.stringify(loginBody)).not.toContain("argon2");

    const me = await api("/auth/me", { token: loginBody.data.token });
    expect(me.status).toBe(200);
    expect((await readJson(me)).data).toEqual(regBody.data.user);
  });

  test("duplicate email → 409 EMAIL_TAKEN (case-insensitive)", async () => {
    const res = await api("/auth/register", { body: { ...creds, email: "t1@LOCAL.test" } });
    expect(res.status).toBe(409);
    expect((await readJson(res)).error.code).toBe("EMAIL_TAKEN");
  });

  test("AC-4: mixed-case register, lower-case duplicate → 409 EMAIL_TAKEN; upper-case login → 200", async () => {
    const first = await api("/auth/register", { body: { displayName: "Tanya", email: "Tanya-Seller@qa.test", password: "password1" } });
    expect(first.status).toBe(201);
    expect((await readJson(first)).data.user.email).toBe("tanya-seller@qa.test");
    const dup = await api("/auth/register", { body: { displayName: "Tanya", email: "tanya-seller@qa.test", password: "password1" } });
    expect(dup.status).toBe(409);
    expect((await readJson(dup)).error.code).toBe("EMAIL_TAKEN");
    const login = await api("/auth/login", { body: { email: "TANYA-SELLER@qa.test", password: "password1" } });
    expect(login.status).toBe(200);
    expect((await readJson(login)).data.user.email).toBe("tanya-seller@qa.test");
  });

  test("register validation → 400", async () => {
    const res = await api("/auth/register", { body: { displayName: "", email: "nope", password: "short" } });
    expect(res.status).toBe(400);
    expect((await readJson(res)).error.code).toBe("VALIDATION_ERROR");
  });

  test("login: wrong password and unknown email → the same 401 UNAUTHENTICATED", async () => {
    const wrongPw = await api("/auth/login", { body: { email: creds.email, password: "wrong-password" } });
    const noUser = await api("/auth/login", { body: { email: "nobody@local.test", password: "password1" } });
    expect(wrongPw.status).toBe(401);
    expect(noUser.status).toBe(401);
    expect((await readJson(wrongPw)).error).toEqual({ code: "UNAUTHENTICATED", message: "invalid credentials" });
    expect((await readJson(noUser)).error).toEqual({ code: "UNAUTHENTICATED", message: "invalid credentials" });
  });

  test("seeded admin logs in with role ADMIN", async () => {
    const res = await api("/auth/login", { body: { email: env.ADMIN_EMAIL, password: env.ADMIN_PASSWORD } });
    expect(res.status).toBe(200);
    expect((await readJson(res)).data.user.role).toBe("ADMIN");
  });

  test("me: no token → 401; garbage token → 401", async () => {
    const none = await api("/auth/me");
    const garbage = await api("/auth/me", { token: "garbage.token.here" });
    expect(none.status).toBe(401);
    expect(garbage.status).toBe(401);
    expect((await readJson(garbage)).error.code).toBe("UNAUTHENTICATED");
  });
});
