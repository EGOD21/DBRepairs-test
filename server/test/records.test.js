import test from "node:test";
import assert from "node:assert/strict";
import { decryptSecret, encryptSecret, vaultKey } from "../src/vault.js";
import { assetInput, credentialInput, networkInput, repairSignatureInput, wipeInput } from "../src/records.js";
import { documentType, isStoredName } from "../src/photos.js";
import { repairInput } from "../src/validation.js";

test("vault secrets round-trip and cannot be read with another key", () => {
  const key = vaultKey("correct horse battery staple");
  const stored = encryptSecret(key, "P@ssw0rd!é");
  assert.match(stored, /^v1:/);
  assert.notEqual(encryptSecret(key, "P@ssw0rd!é"), stored, "fresh IV every time");
  assert.equal(decryptSecret(key, stored), "P@ssw0rd!é");
  assert.throws(() => decryptSecret(vaultKey("a different long passphrase"), stored));
  const parts = stored.split(":");
  parts[3] = Buffer.from("tampered").toString("base64");
  assert.throws(() => decryptSecret(key, parts.join(":")));
  assert.equal(vaultKey(""), null);
  assert.throws(() => vaultKey("short"), /16 characters/);
});

test("client records are validated", () => {
  assert.equal(assetInput({ customer_id: 1, name: "DC01", kind: "server" }).kind, "server");
  assert.throws(() => assetInput({ customer_id: 1, name: "x", kind: "toaster" }), /kind/);
  assert.throws(() => assetInput({ customer_id: 1, name: "" }), /name is required/);
  const net = networkInput({ isp: "Comcast", items: [{ kind: "vlan", name: "VLAN 20", value: "10.0.20.0/24" }] });
  assert.equal(net.items[0].position, 0);
  assert.throws(() => networkInput({ items: [{ kind: "vlan", name: "" }] }), /name is required/);
  assert.equal(credentialInput({ customer_id: 1, label: "Router admin", secret: "" }, false).secret, null, "empty keeps the old password");
  assert.throws(() => credentialInput({ customer_id: 1, label: "x", url: "javascript:alert(1)" }, true), /url/);
  assert.equal(wipeInput({ customer_id: 1, drive_serial: "S3Z9NX0K", method: "nist_purge" }).result, "passed");
  assert.throws(() => wipeInput({ customer_id: 1, drive_serial: "" }), /drive_serial/);
  assert.throws(() => wipeInput({ customer_id: 1, drive_serial: "x", method: "magic" }), /method/);
  assert.throws(() => repairSignatureInput({ kind: "estimate", name: "A", signature: "data:image/png;base64,AA==" }), /kind/);
});

test("repairs accept the intake fields only when sent", () => {
  assert.deepEqual(repairInput({ customer_id: 1, status_id: 1, reported_fault: "x" }).extras, {});
  const extras = repairInput({ customer_id: 1, status_id: 1, reported_fault: "x", asset_id: "4", data_backup: "requested", intake_checklist: { Charger: true, Bag: 0 } }).extras;
  assert.deepEqual(extras, { asset_id: 4, data_backup: "requested", intake_checklist: { Charger: true, Bag: false } });
  assert.throws(() => repairInput({ customer_id: 1, status_id: 1, reported_fault: "x", data_backup: "maybe" }), /data_backup/);
});

test("customer documents accept PDFs and images only", () => {
  assert.equal(documentType(Buffer.from("%PDF-1.7\n%âãÏÓ")).contentType, "application/pdf");
  assert.equal(documentType(Buffer.from("<html><script>")), null);
  assert.ok(isStoredName("ab/ab345678-1234-1234-1234-123456789012.pdf"));
});
