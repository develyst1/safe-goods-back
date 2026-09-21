import { eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { db } from "../db/client";
import { users } from "../db/schema";
import { AppError, ok } from "../lib/http";
import { uuid } from "../lib/ids";
import { signToken } from "../lib/jwt";
import { isUniqueViolation } from "../lib/pg";
import { now } from "../lib/time";
import { validate } from "../lib/validate";
import { requireAuth, type AuthEnv } from "../middleware/auth";
import { toMe } from "../serializers/user";

const registerSchema = z.object({
  displayName: z.string().min(1).max(50),
  email: z.email(),
  password: z.string().min(8).max(72),
});
const loginSchema = z.object({ email: z.string(), password: z.string() });

// Case-insensitive (SPEC-002 §Email case): stored lower-cased, looked up on lower(email), unique index on lower(email).
const findByEmail = async (email: string) => (await db.select().from(users).where(eq(sql`lower(${users.email})`, email.toLowerCase())))[0];

export const auth = new Hono<AuthEnv>()
  // SPEC-001 endpoint 2
  .post("/register", validate("json", registerSchema), async (c) => {
    const body = c.req.valid("json");
    const email = body.email.toLowerCase();
    if (await findByEmail(email)) throw new AppError(409, "EMAIL_TAKEN", "email already registered");

    const at = now();
    const row = {
      id: uuid(),
      email,
      passwordHash: await Bun.password.hash(body.password, { algorithm: "argon2id" }),
      displayName: body.displayName,
      role: "USER",
      createdAt: at,
      updatedAt: at,
    };
    try {
      await db.insert(users).values(row);
    } catch (e) {
      if (isUniqueViolation(e, "users_email_lower")) throw new AppError(409, "EMAIL_TAKEN", "email already registered"); // lost a race
      throw e;
    }
    return ok(c, { token: await signToken(row), user: await toMe(db, row) }, 201);
  })
  // SPEC-001 endpoint 3 — wrong email or wrong password → the same 401
  .post("/login", validate("json", loginSchema), async (c) => {
    const body = c.req.valid("json");
    const row = await findByEmail(body.email);
    const valid = row ? await Bun.password.verify(body.password, row.passwordHash) : false;
    if (!row || !valid) throw new AppError(401, "UNAUTHENTICATED", "invalid credentials");
    return ok(c, { token: await signToken(row), user: await toMe(db, row) });
  })
  // SPEC-001 endpoint 4
  .get("/me", requireAuth, async (c) => {
    const [row] = await db.select().from(users).where(eq(users.id, c.var.user.id));
    if (!row) throw new AppError(401, "UNAUTHENTICATED", "unknown user");
    return ok(c, await toMe(db, row));
  });
