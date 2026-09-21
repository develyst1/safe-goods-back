import type { Context } from "hono";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { db } from "../db/client";
import { files } from "../db/schema";
import { env } from "../env";
import { toFileRef } from "../serializers/room";
import { AppError } from "./http";
import { uuid } from "./ids";
import { now } from "./time";

// SPEC-001 endpoints 13/14: image/jpeg | image/png | image/webp, ≤ 5 MB, multipart field `file`.
const EXT_BY_MIME: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024; // 5 242 880

export const storeUpload = async (c: Context, opts: { roomId: string; kind: "SLIP" | "EVIDENCE"; uploadedBy: string }) => {
  const body = await c.req.parseBody();
  const file = body["file"];
  if (!(file instanceof File)) throw new AppError(400, "VALIDATION_ERROR", "multipart field `file` is required");
  const ext = EXT_BY_MIME[file.type];
  if (!ext) throw new AppError(400, "VALIDATION_ERROR", `unsupported file type ${file.type || "(none)"}; allowed: image/jpeg, image/png, image/webp`);
  if (file.size > MAX_UPLOAD_BYTES) throw new AppError(400, "VALIDATION_ERROR", `file too large (${file.size} bytes); max ${MAX_UPLOAD_BYTES}`);

  const id = uuid();
  const relPath = join(opts.roomId, `${id}.${ext}`);
  mkdirSync(join(env.UPLOAD_DIR, opts.roomId), { recursive: true });
  await Bun.write(join(env.UPLOAD_DIR, relPath), file);

  const row = {
    id,
    roomId: opts.roomId,
    kind: opts.kind,
    uploadedBy: opts.uploadedBy,
    fileName: file.name,
    storagePath: relPath,
    mimeType: file.type,
    sizeBytes: file.size,
    createdAt: now(),
  };
  await db.insert(files).values(row);
  return toFileRef(row);
};

export const absoluteUploadPath = (storagePath: string) => join(env.UPLOAD_DIR, storagePath);
