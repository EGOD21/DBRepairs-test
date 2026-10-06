import test from "node:test";
import assert from "node:assert/strict";
import { ensureAdmin, hashPassword, userInput, verifyPassword } from "../src/users.js";
import { ValidationError } from "../src/validation.js";

test("passwords are hashed with a salt and verify only when correct", async () => {
  const a = await hashPassword("bench-tech-2026");
  const b = await hashPassword("bench-tech-2026");
  assert.notEqual(a, b);
  assert.equal(await verifyPassword("bench-tech-2026", a), true);
  assert.equal(await verifyPassword("bench-tech-2025", a), false);
  assert.equal(await verifyPassword("anything", "not-a-hash"), false);
});

test("user input requires a valid username and an 8+ character password", () => {
  assert.equal(userInput({ username: "sam.t", displayName: "Sam", role: "tech", password: "longenough" }, { creating: true }).username, "sam.t");
  assert.throws(() => userInput({ username: "sam t", displayName: "Sam", role: "tech", password: "longenough" }, { creating: true }), ValidationError);
  assert.throws(() => userInput({ username: "sam", displayName: "Sam", role: "tech", password: "short" }, { creating: true }), ValidationError);
  assert.throws(() => userInput({ username: "sam", displayName: "Sam", role: "owner", password: "longenough" }, { creating: true }), ValidationError);
  assert.equal(userInput({ displayName: "Sam", role: "tech" }, { creating: false }).password, null);
});

test("the admin account follows DBREPAIRS_PASSWORD", async () => {
  const queries = [];
  let row = null;
  const pool = { async query(sql, params) {
    queries.push(sql);
    if (sql.startsWith("SELECT")) return { rows: row ? [row] : [] };
    if (sql.startsWith("INSERT")) row = { id: 1, username: "admin", role: "admin", active: true, password_hash: params[2], session_version: 1 };
    if (sql.startsWith("UPDATE")) row = { ...row, password_hash: params[0], session_version: row.session_version + 1 };
    return { rows: [] };
  } };
  await ensureAdmin(pool, "first-password");
  assert.equal(await verifyPassword("first-password", row.password_hash), true);
  await ensureAdmin(pool, "first-password");
  assert.equal(row.session_version, 1, "unchanged password keeps sessions");
  await ensureAdmin(pool, "second-password");
  assert.equal(await verifyPassword("second-password", row.password_hash), true);
  assert.equal(row.session_version, 2, "a new password ends old sessions");
});
