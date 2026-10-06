import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createPool, migrate } from "./db.js";
import { ensureAdmin } from "./users.js";

const config = loadConfig();
const pool = createPool(config);

async function close(signal) {
  app.log.info({ signal }, "Shutting down");
  await app.close();
  await pool.end();
  process.exit(0);
}

async function prepareDatabase() {
  await migrate(pool);
  await ensureAdmin(pool, config.auth.password);
}

await prepareDatabase();
const app = buildApp({ pool, config, migrateDatabase: prepareDatabase });
process.on("SIGTERM", () => void close("SIGTERM"));
process.on("SIGINT", () => void close("SIGINT"));
await app.listen({ host: config.host, port: config.port });
