import { Hono } from "hono";
import { cors } from "hono/cors";
import { env } from "./env";
import { AppError, fail } from "./lib/http";
import { admin } from "./routes/admin";
import { auth } from "./routes/auth";
import { categories } from "./routes/categories";
import { fee } from "./routes/fee";
import { filesRoute } from "./routes/files";
import { health } from "./routes/health";
import { roomsRoute } from "./routes/rooms";

export const app = new Hono();

app.use("*", cors({ origin: env.CORS_ORIGIN }));

// SPEC-001 §Envelope & errors. Later TASKs mount their routers here under /api/v1.
const api = new Hono();
api.route("/health", health);
api.route("/auth", auth);
api.route("/categories", categories);
api.route("/fee", fee);
api.route("/rooms", roomsRoute);
api.route("/files", filesRoute);
api.route("/admin", admin);
app.route("/api/v1", api);

app.notFound((c) => fail(c, "NOT_FOUND", 404, `no route for ${c.req.method} ${c.req.path}`));

app.onError((err, c) => {
  if (err instanceof AppError) return fail(c, err.code, err.status, err.message, err.details);
  console.error(err); // stack to stderr only, never to the body
  return fail(c, "INTERNAL", 500, "internal error");
});
