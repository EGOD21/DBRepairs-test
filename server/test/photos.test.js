import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createPhotoStore, imageType, isStoredName, pruneInput } from "../src/photos.js";

const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1]);
const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d]);
const webp = Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBPVP8 ")]);

test("photos are recognized by their content, not their claimed type", () => {
  assert.equal(imageType(jpeg).contentType, "image/jpeg");
  assert.equal(imageType(png).contentType, "image/png");
  assert.equal(imageType(webp).contentType, "image/webp");
  assert.equal(imageType(Buffer.from("<svg onload=alert(1)></svg>")), null);
  assert.equal(imageType(Buffer.from("GIF89a......")), null);
  assert.equal(imageType(null), null);
});

test("stored file names cannot point outside the photos folder", () => {
  assert.ok(isStoredName("ab/ab345678-1234-1234-1234-123456789012.jpg"));
  assert.ok(isStoredName("ab/ab345678-1234-1234-1234-123456789012.thumb.jpg"));
  assert.ok(!isStoredName("../etc/passwd"));
  assert.ok(!isStoredName("ab/../../x.jpg"));
  assert.ok(!isStoredName("/abs/path.jpg"));
});

test("prune requests are validated", () => {
  assert.deepEqual(pruneInput({ target: "archived" }), { target: "archived", olderThanDays: 0, repairNumber: null });
  assert.equal(pruneInput({ target: "closed", olderThanDays: 30 }).olderThanDays, 30);
  assert.throws(() => pruneInput({ target: "everything" }), /target/);
  assert.throws(() => pruneInput({ target: "closed", olderThanDays: -1 }), /olderThanDays/);
  assert.throws(() => pruneInput({ target: "closed", olderThanDays: "1; DROP" }), /olderThanDays/);
});

test("the photo store writes, finds and removes files in its own folder", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "dbrepairs-photos-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const store = createPhotoStore(path.join(dir, "photos"));
  assert.equal(await store.available(), true);
  const name = await store.write(jpeg, "jpg");
  assert.ok(isStoredName(name));
  assert.deepEqual(await store.read(name), jpeg);
  assert.equal(await store.exists(name), true);
  // New files are skipped by the orphan scan until the grace period passes.
  assert.deepEqual(await store.list(), []);
  const old = new Date(Date.now() - 2 * 60 * 60 * 1000);
  await fs.utimes(path.join(dir, "photos", name), old, old);
  assert.deepEqual(await store.list(), [name]);
  assert.equal(await store.remove([name, name]), 1);
  assert.equal(await store.exists(name), false);
  assert.ok((await store.disk()).total > 0);
  await assert.rejects(() => store.read("../secret.jpg"), /Invalid photo file name/);
});

test("a missing photos folder setting means storage is unavailable", async () => {
  assert.equal(await createPhotoStore(null).available(), false);
});
