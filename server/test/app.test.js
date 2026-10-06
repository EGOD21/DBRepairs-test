import test from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../src/app.js";
import { createSessionKey } from "../src/auth.js";

const password = "counter-password";

function testApp() {
  const pool = { query: async () => ({ rows: [{ "?column?": 1 }] }) };
  return buildApp({
    pool,
    config: {
      trustProxy: false,
      database: { connectionString: "postgres://unused" },
      auth: { password, sessionKey: createSessionKey(password) },
    },
    logger: false,
  });
}

async function login(app) {
  const response = await app.inject({ method: "POST", url: "/api/login", payload: { password } });
  assert.equal(response.statusCode, 204);
  const cookie = response.headers["set-cookie"];
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Strict/);
  return cookie.split(";")[0];
}

test("health endpoint reports ready without signing in", async (t) => {
  const app = testApp();
  t.after(() => app.close());
  const response = await app.inject({ method: "GET", url: "/api/health" });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { status: "ok" });
  assert.equal(response.headers["x-content-type-options"], "nosniff");
});

test("data and backup endpoints require signing in", async (t) => {
  const app = testApp();
  t.after(() => app.close());
  for (const [method, url] of [["GET", "/api/customers"], ["GET", "/api/backups/database"], ["PUT", "/api/backups/database"], ["GET", "/api/backups/portable"]]) {
    const response = await app.inject({ method, url });
    assert.equal(response.statusCode, 401, `${method} ${url}`);
  }
  const session = await app.inject({ method: "GET", url: "/api/session" });
  assert.deepEqual(session.json(), { authenticated: false });
});

test("a wrong password is rejected and repeated failures are throttled", async (t) => {
  const app = testApp();
  t.after(() => app.close());
  const wrong = await app.inject({ method: "POST", url: "/api/login", payload: { password: "nope" } });
  assert.equal(wrong.statusCode, 401);
  assert.equal(wrong.headers["set-cookie"], undefined);
  for (let i = 0; i < 9; i += 1) await app.inject({ method: "POST", url: "/api/login", payload: { password: "nope" } });
  const blocked = await app.inject({ method: "POST", url: "/api/login", payload: { password } });
  assert.equal(blocked.statusCode, 429);
});

test("signing in grants access and signing out removes it", async (t) => {
  const app = testApp();
  t.after(() => app.close());
  const cookie = await login(app);
  const session = await app.inject({ method: "GET", url: "/api/session", headers: { cookie } });
  assert.deepEqual(session.json(), { authenticated: true });
  const customers = await app.inject({ method: "GET", url: "/api/customers", headers: { cookie } });
  assert.equal(customers.statusCode, 200);
  const logout = await app.inject({ method: "POST", url: "/api/logout", headers: { cookie } });
  assert.match(logout.headers["set-cookie"], /Max-Age=0/);
});

test("cross-site requests are refused even with a session", async (t) => {
  const app = testApp();
  t.after(() => app.close());
  const cookie = await login(app);
  const response = await app.inject({ method: "GET", url: "/api/customers", headers: { cookie, "sec-fetch-site": "cross-site" } });
  assert.equal(response.statusCode, 403);
});

test("invalid customer payload returns a client error", async (t) => {
  const app = testApp();
  t.after(() => app.close());
  const cookie = await login(app);
  const response = await app.inject({ method: "POST", url: "/api/customers", headers: { cookie }, payload: { name: " " } });
  assert.equal(response.statusCode, 400);
  assert.match(response.json().error, /name is required/);
});

test("restore rejects files that are not PostgreSQL dumps", async (t) => {
  const app = testApp();
  t.after(() => app.close());
  const cookie = await login(app);
  const response = await app.inject({
    method: "PUT",
    url: "/api/backups/database",
    headers: { cookie, "content-type": "application/octet-stream" },
    payload: Buffer.from("not a database"),
  });
  assert.equal(response.statusCode, 400);
  assert.match(response.json().error, /Invalid PostgreSQL backup/);
});
