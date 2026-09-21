import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { db } from "../db/client";
import { users } from "../db/schema";
import { AppError, ok } from "../lib/http";
import { uuid } from "../lib/ids";
import { signToken } from "../lib/jwt";
import { nowIso } from "../lib/time";
import { validate } from "../lib/validate";
import { requireAuth, type AuthEnv } from "../middleware/auth";
import { toMe } from "../serializers/user";

const registerSchema = z.object({
  displayName: z.string().min(1).max(50),
  email: z.email(),
  password: z.string().min(8).max(72),
});
const loginSchema = z.object({ email: z.string(), password: z.string() });

const findByEmail = (email: string) => db.select().from(users).where(eq(users.email, email)).get();

export const auth = new Hono<AuthEnv>()
  // SPEC-001 endpoint 2
  .post("/register", validate("json", registerSchema), async (c) => {
    const body = c.req.valid("json");
    const email = body.email.toLowerCase();
    if (findByEmail(email)) throw new AppError(409, "EMAIL_TAKEN", "email already registered");

    const now = nowIso();
    const row = {
      id: uuid(),
      email,
      passwordHash: await Bun.password.hash(body.password, { algorithm: "argon2id" }),
      displayName: body.displayName,
      role: "USER",
      createdAt: now,
      updatedAt: now,
    };
    db.insert(users).values(row).run();
    return ok(c, { token: await signToken(row), user: toMe(db, row) }, 201);
  })
  // SPEC-001 endpoint 3 — wrong email or wrong password → the same 401
  .post("/login", validate("json", loginSchema), async (c) => {
    const body = c.req.valid("json");
    const row = findByEmail(body.email.toLowerCase());
    const valid = row ? await Bun.password.verify(body.password, row.passwordHash) : false;
    if (!row || !valid) throw new AppError(401, "UNAUTHENTICATED", "invalid credentials");
    return ok(c, { token: await signToken(row), user: toMe(db, row) });
  })
  // SPEC-001 endpoint 4
  .get("/me", requireAuth, (c) => {
    const row = db.select().from(users).where(eq(users.id, c.var.user.id)).get();
    if (!row) throw new AppError(401, "UNAUTHENTICATED", "unknown user");
    return ok(c, toMe(db, row));
  });
