import { app } from "./app";
import "./db/client"; // opens the database and applies pending migrations
import { env } from "./env";
import { runAutoRelease } from "./jobs/autoRelease";

const server = Bun.serve({ port: env.PORT, fetch: app.fetch });
console.log(`safe-goods-back listening on http://localhost:${server.port}`);

// SPEC-001 3-day timer: sweep every SWEEP_INTERVAL_MS; log only when something was released.
setInterval(() => {
  const released = runAutoRelease();
  if (released > 0) console.log(`[auto-release] ${new Date().toISOString()} released=${released}`);
}, env.SWEEP_INTERVAL_MS);
