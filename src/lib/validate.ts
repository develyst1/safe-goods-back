import { zValidator } from "@hono/zod-validator";
import type { ValidationTargets } from "hono";
import type { ZodType } from "zod";
import { AppError } from "./http";

// zValidator with the SPEC-001 failure shape: 400 VALIDATION_ERROR, details = zod issues.
export const validate = <T extends ZodType, Target extends keyof ValidationTargets>(target: Target, schema: T) =>
  zValidator(target, schema, (result) => {
    if (!result.success) {
      throw new AppError(400, "VALIDATION_ERROR", "invalid request", result.error.issues);
    }
  });
