// `bun run db:migrate` — applies pending migrations (createDb does it) and lists the tables.
import { env } from "../env";
import { sqlite } from "./client";

const tables = sqlite
  .query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
  .all()
  .map((r) => r.name);
console.log(`migrated ${env.DATABASE_PATH}: ${tables.join(", ")}`);
