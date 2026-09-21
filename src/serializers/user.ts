import type { Db } from "../db/client";
import type { users } from "../db/schema";
import { goodCloseCount } from "../domain/credit";

type UserRow = typeof users.$inferSelect;

// SPEC-001 §Shared shapes → Me
export const toMe = async (db: Db, u: UserRow) => ({
  id: u.id,
  email: u.email,
  displayName: u.displayName,
  role: u.role as "USER" | "ADMIN",
  credit: { goodCloseCount: await goodCloseCount(db, u.id) },
});

// SPEC-001 §Shared shapes → UserPublic
export const toUserPublic = async (db: Db, u: Pick<UserRow, "id" | "displayName">) => ({
  id: u.id,
  displayName: u.displayName,
  credit: { goodCloseCount: await goodCloseCount(db, u.id) },
});
