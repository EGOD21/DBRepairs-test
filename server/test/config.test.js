import test from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "../src/config.js";

const login = { DBREPAIRS_PASSWORD: "counter-password" };

test("configuration requires a database URL", () => {
  assert.throws(() => loadConfig({ ...login }), /DATABASE_URL or PGHOST/);
});

test("configuration applies safe defaults", () => {
  const config = loadConfig({ DATABASE_URL: "postgres://db/test", ...login });
  assert.equal(config.host, "0.0.0.0");
  assert.equal(config.port, 3000);
  assert.deepEqual(config.database, { connectionString: "postgres://db/test" });
  assert.equal(config.databasePoolSize, 10);
  assert.equal(config.trustProxy, false);
  assert.equal(config.auth.password, "counter-password");
});

test("configuration accepts separate PostgreSQL variables", () => {
  assert.deepEqual(loadConfig({ PGHOST: "db", PGDATABASE: "repairs", PGUSER: "app", PGPASSWORD: "secret", ...login }).database, {
    host: "db", port: 5432, database: "repairs", user: "app", password: "secret",
  });
});

test("configuration requires a login password of at least 8 characters", () => {
  assert.throws(() => loadConfig({ DATABASE_URL: "postgres://db/test" }), /DBREPAIRS_PASSWORD is required/);
  assert.throws(() => loadConfig({ DATABASE_URL: "postgres://db/test", DBREPAIRS_PASSWORD: "short" }), /at least 8/);
});

test("configuration refuses the example passwords", () => {
  assert.throws(() => loadConfig({ DATABASE_URL: "postgres://db/test", DBREPAIRS_PASSWORD: "CHANGE-THIS-LOGIN-PASSWORD" }), /example value/);
  assert.throws(() => loadConfig({ PGHOST: "db", PGDATABASE: "d", PGUSER: "u", PGPASSWORD: "CHANGE-THIS-APP-PASSWORD", ...login }), /example value/);
  assert.throws(() => loadConfig({ PGHOST: "db", PGDATABASE: "d", PGUSER: "u", PGPASSWORD: "replace-with-a-long-random-password", ...login }), /example value/);
});
