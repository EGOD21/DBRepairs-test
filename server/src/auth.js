import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE = "dbrepairs_session";
const SESSION_SECONDS = 30 * 24 * 60 * 60;

function sha256(value) {
  return createHash("sha256").update(value, "utf8").digest();
}

export function passwordMatches(candidate, expected) {
  if (typeof candidate !== "string" || typeof expected !== "string") return false;
  return timingSafeEqual(sha256(candidate), sha256(expected));
}

// Sessions are signed with a key derived from the admin password (and the
// optional SESSION_SECRET), so changing DBREPAIRS_PASSWORD signs everybody out.
export function createSessionKey(password, secret = "") {
  return createHmac("sha256", "dbrepairs-session-v1").update(`${password}\0${secret}`).digest();
}

function sign(key, payload) {
  return createHmac("sha256", key).update(payload).digest();
}

// Token: userId.sessionVersion.expiresAt.nonce.signature
export function issueSession(key, { userId, version }, now = Date.now()) {
  const payload = `${userId}.${version}.${now + SESSION_SECONDS * 1000}.${randomBytes(16).toString("base64url")}`;
  return { token: `${payload}.${sign(key, payload).toString("base64url")}`, maxAge: SESSION_SECONDS };
}

/** Returns the signed-in user id and session version, or null for a bad or expired token. */
export function verifySession(key, token, now = Date.now()) {
  if (typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 5) return null;
  const [userId, version, expires, nonce, signature] = parts;
  const expected = sign(key, `${userId}.${version}.${expires}.${nonce}`);
  const given = Buffer.from(signature, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  const expiresAt = Number(expires);
  const id = Number(userId);
  const sessionVersion = Number(version);
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= now || !Number.isSafeInteger(id) || id < 1 || !Number.isSafeInteger(sessionVersion)) return null;
  return { userId: id, version: sessionVersion };
}

export function readCookie(header, name) {
  if (typeof header !== "string") return undefined;
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index > 0 && part.slice(0, index).trim() === name) return part.slice(index + 1).trim();
  }
  return undefined;
}

export function sessionCookie(token, { maxAge, secure }) {
  return `${SESSION_COOKIE}=${token}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Strict${secure ? "; Secure" : ""}`;
}

export function createLoginLimiter({ maxAttempts = 10, windowMs = 15 * 60 * 1000 } = {}) {
  const attempts = new Map();
  function current(ip, now) {
    const entry = attempts.get(ip);
    if (entry && entry.resetAt <= now) {
      attempts.delete(ip);
      return undefined;
    }
    return entry;
  }
  return {
    blocked(ip, now = Date.now()) {
      return (current(ip, now)?.count ?? 0) >= maxAttempts;
    },
    fail(ip, now = Date.now()) {
      if (attempts.size > 10_000) {
        for (const [key, entry] of attempts) if (entry.resetAt <= now) attempts.delete(key);
      }
      const entry = current(ip, now) ?? { count: 0, resetAt: now + windowMs };
      entry.count += 1;
      attempts.set(ip, entry);
    },
    reset(ip) {
      attempts.delete(ip);
    },
  };
}
