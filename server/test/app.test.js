import test from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../src/app.js";
import { createSessionKey } from "../src/auth.js";
import { hashPassword } from "../src/users.js";

const password = "counter-password";
const adminRow = { id: 1, username: "admin", display_name: "Admin", role: "admin", active: true, session_version: 1, password_hash: await hashPassword(password) };

function testApp() {
  // Answers the user lookups the sign-in code makes; everything else gets a dummy row.
  const pool = { query: async (sql) => (/FROM users/.test(sql) ? { rows: [adminRow] } : { rows: [{ "?column?": 1 }] }) };
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
  const response = await app.inject({ method: "POST", url: "/api/login", payload: { username: "admin", password } });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().user.username, "admin");
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
  const wrong = await app.inject({ method: "POST", url: "/api/login", payload: { username: "admin", password: "nope" } });
  assert.equal(wrong.statusCode, 401);
  assert.equal(wrong.headers["set-cookie"], undefined);
  for (let i = 0; i < 9; i += 1) await app.inject({ method: "POST", url: "/api/login", payload: { username: "admin", password: "nope" } });
  const blocked = await app.inject({ method: "POST", url: "/api/login", payload: { username: "admin", password } });
  assert.equal(blocked.statusCode, 429);
});

test("signing in grants access and signing out removes it", async (t) => {
  const app = testApp();
  t.after(() => app.close());
  const cookie = await login(app);
  const session = await app.inject({ method: "GET", url: "/api/session", headers: { cookie } });
  assert.equal(session.json().authenticated, true);
  assert.equal(session.json().user.role, "admin");
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

test("branding is public so the sign-in page can show the logo, but settings are not", async (t) => {
  const app = testApp();
  t.after(() => app.close());
  const branding = await app.inject({ method: "GET", url: "/api/branding" });
  assert.equal(branding.statusCode, 200);
  const settings = await app.inject({ method: "GET", url: "/api/settings" });
  assert.equal(settings.statusCode, 401);
});

test("the installable-app manifest and icons are public", async (t) => {
  const app = testApp();
  t.after(() => app.close());
  const manifest = await app.inject({ method: "GET", url: "/api/app/manifest.webmanifest" });
  assert.equal(manifest.statusCode, 200);
  assert.match(manifest.headers["content-type"], /manifest\+json/);
  const body = manifest.json();
  assert.equal(body.display, "standalone");
  assert.ok(body.icons.some((icon) => icon.purpose === "maskable"));
  // With no logo saved yet, icons fall back to the bundled DBRepairs icons.
  const icon = await app.inject({ method: "GET", url: "/api/app/icon-192.png" });
  assert.equal(icon.statusCode, 302);
  assert.equal(icon.headers.location, "/icons/icon-192.png");
  const unknown = await app.inject({ method: "GET", url: "/api/app/secrets.png" });
  assert.equal(unknown.statusCode, 404);
});
