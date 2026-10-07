import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";

const VERSION = "v1";

/**
 * Turns VAULT_KEY into a 256-bit key. Any long passphrase works; the same
 * value must be used forever, or saved passwords can no longer be read.
 */
export function vaultKey(secret) {
  if (!secret) return null;
  if (secret.length < 16) throw new Error("VAULT_KEY must be at least 16 characters long");
  return scryptSync(secret, "dbrepairs-vault-v1", 32);
}

/** AES-256-GCM: "v1:<iv>:<tag>:<ciphertext>", all base64. */
export function encryptSecret(key, plain) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([cipher.update(String(plain), "utf8"), cipher.final()]);
  return [VERSION, iv.toString("base64"), cipher.getAuthTag().toString("base64"), data.toString("base64")].join(":");
}

export function decryptSecret(key, stored) {
  const [version, iv, tag, data] = String(stored).split(":");
  if (version !== VERSION || !iv || !tag || data === undefined) throw new Error("Unknown secret format");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64")), decipher.final()]).toString("utf8");
}
