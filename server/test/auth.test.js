import test from "node:test";
import assert from "node:assert/strict";
import { createLoginLimiter, createSessionKey, issueSession, passwordMatches, readCookie, verifySession } from "../src/auth.js";

const key = createSessionKey("correct horse battery staple");

test("password comparison accepts only the exact password", () => {
  assert.equal(passwordMatches("shop-password", "shop-password"), true);
  assert.equal(passwordMatches("shop-passwor", "shop-password"), false);
  assert.equal(passwordMatches(undefined, "shop-password"), false);
});

test("issued sessions verify until they expire", () => {
  const now = Date.now();
  const { token, maxAge } = issueSession(key, now);
  assert.equal(verifySession(key, token, now), true);
  assert.equal(verifySession(key, token, now + maxAge * 1000 + 1), false);
});

test("sessions are rejected after tampering or a password change", () => {
  const { token } = issueSession(key);
  const [, nonce, signature] = token.split(".");
  assert.equal(verifySession(key, `99999999999999.${nonce}.${signature}`), false);
  assert.equal(verifySession(createSessionKey("a different password"), token), false);
  assert.equal(verifySession(key, "garbage"), false);
  assert.equal(verifySession(key, undefined), false);
});

test("cookies are read by name", () => {
  assert.equal(readCookie("a=1; dbrepairs_session=abc.def.ghi; b=2", "dbrepairs_session"), "abc.def.ghi");
  assert.equal(readCookie("other=1", "dbrepairs_session"), undefined);
  assert.equal(readCookie(undefined, "dbrepairs_session"), undefined);
});

test("login limiter blocks repeated failures until the window passes", () => {
  const limiter = createLoginLimiter({ maxAttempts: 3, windowMs: 1000 });
  for (let i = 0; i < 3; i += 1) limiter.fail("10.0.0.5", 0);
  assert.equal(limiter.blocked("10.0.0.5", 10), true);
  assert.equal(limiter.blocked("10.0.0.6", 10), false);
  assert.equal(limiter.blocked("10.0.0.5", 1001), false);
  limiter.fail("10.0.0.7", 0);
  limiter.reset("10.0.0.7");
  assert.equal(limiter.blocked("10.0.0.7", 0), false);
});
