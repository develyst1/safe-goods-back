import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { db } from "../db/client";
import { files, rooms } from "../db/schema";
import { absoluteUploadPath } from "../lib/files";
import { AppError } from "../lib/http";
import { requireAuth, type AuthEnv } from "../middleware/auth";
import { assertParty } from "../serializers/room";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// SPEC-001 endpoint 18 — the binary, not the envelope; member of the file's room or admin.
export const filesRoute = new Hono<AuthEnv>().get("/:id", requireAuth, async (c) => {
  const id = c.req.param("id");
  if (!UUID_RE.test(id)) throw new AppError(404, "NOT_FOUND", "file not found"); // a non-uuid id would be a Postgres cast error
  const [file] = await db.select().from(files).where(eq(files.id, id));
  if (!file) throw new AppError(404, "NOT_FOUND", "file not found");
  const [room] = await db.select().from(rooms).where(eq(rooms.id, file.roomId));
  if (!room) throw new AppError(404, "NOT_FOUND", "file not found");
  assertParty(room, c.var.user, "BUYER", "SELLER", "ADMIN");

  const blob = Bun.file(absoluteUploadPath(file.storagePath));
  if (!(await blob.exists())) throw new AppError(404, "NOT_FOUND", "file missing on disk");
  return new Response(blob, {
    headers: { "content-type": file.mimeType, "content-length": String(file.sizeBytes), "cache-control": "private, no-store" },
  });
});
