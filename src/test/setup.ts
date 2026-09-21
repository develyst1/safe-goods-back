// bun test preload: every test runs against a fresh in-memory SQLite (set before src/env.ts loads).
process.env.DATABASE_PATH = ":memory:";
process.env.JWT_SECRET = "test-secret";
process.env.UPLOAD_DIR = `${require("node:os").tmpdir()}/safe-goods-test-uploads`;
