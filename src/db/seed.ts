// `bun run seed` — idempotent (SPEC-001 §Data Model → Seed; SPEC-002 → ON CONFLICT DO NOTHING).
import { eq, sql as dsql } from "drizzle-orm";
import { env } from "../env";
import { uuid } from "../lib/ids";
import { now } from "../lib/time";
import { closeDb, db } from "./client";
import { categories, settings, users } from "./schema";

export const seed = async () => {
  const at = now();

  await db
    .insert(categories)
    .values([
      { id: 1, kind: "IN_GAME", nameTh: "ไอเทม/ไอดีเกม", sort: 1 },
      { id: 2, kind: "PHYSICAL", nameTh: "สินค้าส่งพัสดุ", sort: 2 },
    ])
    .onConflictDoNothing();

  await db.insert(settings).values({ id: 1, feeRatePercent: 20, feeMinimum: 20, updatedAt: at }).onConflictDoNothing();

  const email = env.ADMIN_EMAIL.toLowerCase();
  const [existing] = await db.select({ id: users.id }).from(users).where(eq(dsql`lower(${users.email})`, email));
  if (!existing) {
    await db
      .insert(users)
      .values({
        id: uuid(),
        email,
        passwordHash: await Bun.password.hash(env.ADMIN_PASSWORD, { algorithm: "argon2id" }),
        displayName: env.ADMIN_DISPLAY_NAME,
        role: "ADMIN",
        createdAt: at,
        updatedAt: at,
      })
      .onConflictDoNothing();
  }

  const c = (await db.select().from(categories)).length;
  const [s] = await db.select().from(settings);
  const admins = await db.select({ email: users.email, role: users.role }).from(users).where(eq(users.role, "ADMIN"));
  console.log(`seeded: categories=${c} settings=${JSON.stringify(s)} admins=${JSON.stringify(admins)}`);
};

if (import.meta.main) {
  await seed();
  await closeDb();
}
