import { app } from "./app";
import { pingDb } from "./db/client";
import { env, maskDatabaseUrl } from "./env";
import { runAutoRelease } from "./jobs/autoRelease";

// Fail fast (SPEC-002 AC-6): no listener until the database answers SELECT 1.
try {
  await pingDb();
} catch (e) {
  // postgres.js wraps a refused socket in an AggregateError with an empty message and the code on `code`.
  const err = e as { message?: string; code?: string; errors?: Array<{ message?: string }> };
  const message = [err.code, err.message || err.errors?.[0]?.message].filter(Boolean).join(" ") || String(e);
  console.error(`cannot connect to DATABASE_URL: ${maskDatabaseUrl(message)} (${maskDatabaseUrl(env.DATABASE_URL)})`);
  process.exit(1);
}

const server = Bun.serve({ port: env.PORT, fetch: app.fetch });
console.log(`safe-goods-back listening on http://localhost:${server.port}`);

// SPEC-001 3-day timer: sweep every SWEEP_INTERVAL_MS; log only when something was released; never let the interval die.
setInterval(async () => {
  try {
    const released = await runAutoRelease();
    if (released > 0) console.log(`[auto-release] ${new Date().toISOString()} released=${released}`);
  } catch (e) {
    console.error(`[auto-release] failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}, env.SWEEP_INTERVAL_MS);
