import test from "node:test";
import assert from "node:assert/strict";
import { createDecipheriv, createECDH, createPublicKey, hkdfSync, randomBytes, verify } from "node:crypto";
import { encryptPayload, generateVapidKeys, vapidAuthorization } from "../src/webpush.js";

test("push payloads decrypt on the receiving side (RFC 8291)", () => {
  // The browser's side of the subscription.
  const browser = createECDH("prime256v1");
  browser.generateKeys();
  const auth = randomBytes(16);
  const subscription = { p256dh: browser.getPublicKey().toString("base64url"), auth: auth.toString("base64url") };
  const record = encryptPayload(subscription, JSON.stringify({ title: "Repair 2026-000142", body: "Ready ✓" }));

  const salt = record.subarray(0, 16);
  assert.equal(record.readUInt32BE(16), 4096);
  const keyLength = record.readUInt8(20);
  const serverPublic = record.subarray(21, 21 + keyLength);
  const ciphertext = record.subarray(21 + keyLength);
  const shared = browser.computeSecret(serverPublic);
  const ikm = Buffer.from(hkdfSync("sha256", shared, auth, Buffer.concat([Buffer.from("WebPush: info\0"), browser.getPublicKey(), serverPublic]), 32));
  const cek = Buffer.from(hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: aes128gcm\0"), 16));
  const nonce = Buffer.from(hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: nonce\0"), 12));
  const decipher = createDecipheriv("aes-128-gcm", cek, nonce);
  decipher.setAuthTag(ciphertext.subarray(-16));
  const plain = Buffer.concat([decipher.update(ciphertext.subarray(0, -16)), decipher.final()]);
  assert.equal(plain.at(-1), 2, "last-record delimiter");
  assert.deepEqual(JSON.parse(plain.subarray(0, -1).toString()), { title: "Repair 2026-000142", body: "Ready ✓" });
});

test("VAPID tokens are valid ES256 JWTs for the push service", () => {
  const { jwk, publicKey } = generateVapidKeys();
  assert.equal(Buffer.from(publicKey, "base64url").length, 65);
  const header = vapidAuthorization({ endpoint: "https://fcm.googleapis.com/fcm/send/abc", jwk, publicKey, subject: "mailto:shop@example.com", now: 1_800_000_000_000 });
  const [, token, key] = /^vapid t=([^,]+), k=(.+)$/.exec(header);
  assert.equal(key, publicKey);
  const [h, c, s] = token.split(".");
  const claims = JSON.parse(Buffer.from(c, "base64url").toString());
  assert.equal(claims.aud, "https://fcm.googleapis.com");
  assert.equal(claims.exp, 1_800_000_000 + 12 * 3600);
  const publicJwk = { kty: "EC", crv: "P-256", x: jwk.x, y: jwk.y };
  assert.ok(verify("sha256", Buffer.from(`${h}.${c}`), { key: createPublicKey({ key: publicJwk, format: "jwk" }), dsaEncoding: "ieee-p1363" }, Buffer.from(s, "base64url")));
  assert.throws(() => encryptPayload({ p256dh: "AAAA", auth: "AAAA" }, "x"), /Invalid push subscription/);
});
