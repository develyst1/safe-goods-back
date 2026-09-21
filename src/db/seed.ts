// `bun run seed` — idempotent (SPEC-001 §Data Model → Seed).
import { eq } from "drizzle-orm";
import { env } from "../env";
import { uuid } from "../lib/ids";
import { nowIso } from "../lib/time";
import { db } from "./client";
import { categories, settings, users } from "./schema";

export const seed = async () => {
  const now = nowIso();

  db.insert(categories)
    .values([
      { id: 1, kind: "IN_GAME", nameTh: "ไอเทม/ไอดีเกม", sort: 1 },
      { id: 2, kind: "PHYSICAL", nameTh: "สินค้าส่งพัสดุ", sort: 2 },
    ])
    .onConflictDoNothing()
    .run();

  db.insert(settings).values({ id: 1, feeRatePercent: 20, feeMinimum: 20, updatedAt: now }).onConflictDoNothing().run();

  const email = env.ADMIN_EMAIL.toLowerCase();
  const existing = db.select({ id: users.id }).from(users).where(eq(users.email, email)).get();
  if (!existing) {
    db.insert(users)
      .values({
        id: uuid(),
        email,
        passwordHash: await Bun.password.hash(env.ADMIN_PASSWORD, { algorithm: "argon2id" }),
        displayName: env.ADMIN_DISPLAY_NAME,
        role: "ADMIN",
        createdAt: now,
        updatedAt: now,
      })
      .run();
  }

  const c = db.select().from(categories).all().length;
  const s = db.select().from(settings).get();
  const admins = db.select({ email: users.email, role: users.role }).from(users).where(eq(users.role, "ADMIN")).all();
  console.log(`seeded: categories=${c} settings=${JSON.stringify(s)} admins=${JSON.stringify(admins)}`);
};

if (import.meta.main) await seed();
