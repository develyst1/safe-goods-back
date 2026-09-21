import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

// Error codes fixed by SPEC-001 §Envelope & errors.
export type ErrorCode =
  | "VALIDATION_ERROR"
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "EMAIL_TAKEN"
  | "ROOM_FULL"
  | "INVALID_STATE"
  | "EVIDENCE_REQUIRED"
  | "TRACKING_REQUIRED"
  | "INTERNAL";

export class AppError extends Error {
  constructor(
    public readonly status: ContentfulStatusCode,
    public readonly code: ErrorCode,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export const ok = (c: Context, data: unknown, status: ContentfulStatusCode = 200) =>
  c.json({ success: true, data }, status);

export const fail = (
  c: Context,
  code: ErrorCode,
  status: ContentfulStatusCode,
  message: string,
  details?: unknown,
) => c.json({ success: false, error: { code, message, ...(details !== undefined ? { details } : {}) } }, status);
