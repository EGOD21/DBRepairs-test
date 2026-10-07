import { createCipheriv, createECDH, createPrivateKey, generateKeyPairSync, hkdfSync, randomBytes, sign } from "node:crypto";

/**
 * Web Push without extra packages: VAPID (RFC 8292) to identify the server and
 * aes128gcm payload encryption (RFC 8291) so only the subscribed browser can
 * read the notification.
 */
const b64url = (buffer) => Buffer.from(buffer).toString("base64url");

/** A new VAPID key pair, stored once in the database. */
export function generateVapidKeys() {
  const { privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const jwk = privateKey.export({ format: "jwk" });
  return { jwk, publicKey: b64url(Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x, "base64url"), Buffer.from(jwk.y, "base64url")])) };
}

export function vapidAuthorization({ endpoint, jwk, publicKey, subject, now = Date.now() }) {
  const audience = new URL(endpoint).origin;
  const header = b64url(JSON.stringify({ typ: "JWT", alg: "ES256" }));
  const claims = b64url(JSON.stringify({ aud: audience, exp: Math.floor(now / 1000) + 12 * 3600, sub: subject }));
  const signature = sign("sha256", Buffer.from(`${header}.${claims}`), { key: createPrivateKey({ key: jwk, format: "jwk" }), dsaEncoding: "ieee-p1363" });
  return `vapid t=${header}.${claims}.${b64url(signature)}, k=${publicKey}`;
}

/** Encrypts one notification for one subscription (single record, aes128gcm). */
export function encryptPayload({ p256dh, auth }, plaintext, { salt = randomBytes(16), serverKeys } = {}) {
  const uaPublic = Buffer.from(p256dh, "base64url");
  const authSecret = Buffer.from(auth, "base64url");
  if (uaPublic.length !== 65 || authSecret.length !== 16) throw new Error("Invalid push subscription keys");
  const ecdh = serverKeys ?? createECDH("prime256v1");
  if (!serverKeys) ecdh.generateKeys();
  const asPublic = ecdh.getPublicKey();
  const shared = ecdh.computeSecret(uaPublic);
  const ikm = Buffer.from(hkdfSync("sha256", shared, authSecret, Buffer.concat([Buffer.from("WebPush: info\0"), uaPublic, asPublic]), 32));
  const cek = Buffer.from(hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: aes128gcm\0"), 16));
  const nonce = Buffer.from(hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: nonce\0"), 12));
  const cipher = createCipheriv("aes-128-gcm", cek, nonce);
  // 0x02 marks the last (only) record.
  const body = Buffer.concat([cipher.update(Buffer.concat([Buffer.from(plaintext, "utf8"), Buffer.from([2])])), cipher.final(), cipher.getAuthTag()]);
  const header = Buffer.alloc(21);
  salt.copy(header, 0);
  header.writeUInt32BE(4096, 16);
  header.writeUInt8(asPublic.length, 20);
  return Buffer.concat([header, asPublic, body]);
}

/** Sends one push. Returns "gone" when the browser has dropped the subscription. */
export async function sendPush(subscription, payload, { jwk, publicKey, subject }) {
  const response = await fetch(subscription.endpoint, {
    method: "POST",
    headers: {
      Authorization: vapidAuthorization({ endpoint: subscription.endpoint, jwk, publicKey, subject }),
      "Content-Encoding": "aes128gcm",
      "Content-Type": "application/octet-stream",
      TTL: "86400",
      Urgency: "normal",
    },
    body: encryptPayload(subscription, JSON.stringify(payload)),
    signal: AbortSignal.timeout(15_000),
  });
  if (response.status === 404 || response.status === 410) return "gone";
  if (!response.ok) throw new Error(`Push service answered ${response.status}`);
  return "sent";
}
