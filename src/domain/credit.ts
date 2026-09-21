// Credit is derived, never stored (SPEC-001 §Technical decisions).
import { and, count, eq, or } from "drizzle-orm";
import type { Db } from "../db/client";
import { rooms } from "../db/schema";

export const goodCloseCount = async (db: Db, userId: string): Promise<number> => {
  const [row] = await db
    .select({ n: count() })
    .from(rooms)
    .where(and(eq(rooms.status, "COMPLETED"), or(eq(rooms.buyerId, userId), eq(rooms.sellerId, userId))));
  return row?.n ?? 0;
};
