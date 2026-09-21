import { Hono } from "hono";
import { z } from "zod";
import { db } from "../db/client";
import { getSettings } from "../db/settings";
import { computeFee } from "../domain/fee";
import { ok } from "../lib/http";
import { validate } from "../lib/validate";
import { requireAuth, type AuthEnv } from "../middleware/auth";

export const priceModeSchema = z.enum(["FEE_ADDED", "FEE_INCLUDED"]);
export const feePayerSchema = z.enum(["SELLER", "BUYER", "SPLIT"]);
export const enteredPriceSchema = z.number().int().min(1);

const quoteSchema = z.object({ priceMode: priceModeSchema, feePayer: feePayerSchema, enteredPrice: enteredPriceSchema });

export const fee = new Hono<AuthEnv>()
  // SPEC-001 endpoint 6
  .get("/settings", requireAuth, (c) => ok(c, getSettings(db)))
  // SPEC-001 endpoint 7 — no auth; uses the CURRENT settings
  .post("/quote", validate("json", quoteSchema), (c) => {
    const body = c.req.valid("json");
    const s = getSettings(db);
    return ok(c, computeFee({ ...body, ratePercent: s.feeRatePercent, minimum: s.feeMinimum }));
  });
