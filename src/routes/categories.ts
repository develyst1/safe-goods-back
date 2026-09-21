import { asc } from "drizzle-orm";
import { Hono } from "hono";
import { db } from "../db/client";
import { categories as categoriesTable } from "../db/schema";
import { ok } from "../lib/http";
import { requireAuth, type AuthEnv } from "../middleware/auth";

// SPEC-001 endpoint 5
export const categories = new Hono<AuthEnv>().get("/", requireAuth, async (c) =>
  ok(
    c,
    await db
      .select({ id: categoriesTable.id, kind: categoriesTable.kind, nameTh: categoriesTable.nameTh })
      .from(categoriesTable)
      .orderBy(asc(categoriesTable.sort), asc(categoriesTable.id)),
  ),
);
