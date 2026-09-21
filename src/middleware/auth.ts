import { eq } from "drizzle-orm";
import { createMiddleware } from "hono/factory";
import { db } from "../db/client";
import { users } from "../db/schema";
import { AppError } from "../lib/http";
import { verifyToken } from "../lib/jwt";

export type AuthUser = { id: string; role: "USER" | "ADMIN"; displayName: string };
export type AuthEnv = { Variables: { user: AuthUser } };

// `Authorization: Bearer <jwt>` → c.var.user, else 401 UNAUTHENTICATED.
export const requireAuth = createMiddleware<AuthEnv>(async (c, next) => {
  const header = c.req.header("authorization") ?? "";
  const [scheme, token] = header.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !token) throw new AppError(401, "UNAUTHENTICATED", "missing bearer token");

  let sub: string;
  try {
    sub = (await verifyToken(token)).sub;
  } catch {
    throw new AppError(401, "UNAUTHENTICATED", "invalid or expired token");
  }

  const [row] = await db.select({ id: users.id, role: users.role, displayName: users.displayName }).from(users).where(eq(users.id, sub));
  if (!row) throw new AppError(401, "UNAUTHENTICATED", "unknown user");
  c.set("user", { id: row.id, role: row.role as AuthUser["role"], displayName: row.displayName });
  await next();
});

// After requireAuth: 403 FORBIDDEN unless ADMIN (AC-27).
export const requireAdmin = createMiddleware<AuthEnv>(async (c, next) => {
  if (c.var.user.role !== "ADMIN") throw new AppError(403, "FORBIDDEN", "admin only");
  await next();
});
