import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { pathId, ValidationError } from "./validation.js";

// Phones resize photos before uploading, so this is only a safety limit.
export const MAX_PHOTO_BYTES = 25 * 1024 * 1024;
const MAX_THUMB_BYTES = 2 * 1024 * 1024;
// Files younger than this may still be part of an upload, so the orphan check skips them.
const ORPHAN_GRACE_MS = 60 * 60 * 1000;
const AUTO_PRUNE_INTERVAL_MS = 6 * 60 * 60 * 1000;

/** Recognizes JPEG, PNG and WebP by their first bytes, whatever the browser claims. */
export function imageType(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return null;
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return { contentType: "image/jpeg", ext: "jpg" };
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { contentType: "image/png", ext: "png" };
  if (buffer.toString("latin1", 0, 4) === "RIFF" && buffer.toString("latin1", 8, 12) === "WEBP") return { contentType: "image/webp", ext: "webp" };
  return null;
}

/** Keeps stored names to "ab/<uuid>.<ext>" so a database row can never point outside the photos folder. */
export function isStoredName(name) {
  return typeof name === "string" && /^[0-9a-f]{2}\/[0-9a-f-]{36}(\.thumb)?\.(jpg|png|webp)$/.test(name);
}

export function pruneInput(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ValidationError("Expected a JSON object");
  if (!["archived", "closed"].includes(value.target)) throw new ValidationError("target must be archived or closed");
  const days = value.olderThanDays ?? 0;
  if (!Number.isInteger(days) || days < 0 || days > 36500) throw new ValidationError("olderThanDays must be a whole number of days");
  const repairNumber = value.repairNumber == null || value.repairNumber === "" ? null : String(value.repairNumber).slice(0, 100);
  return { target: value.target, olderThanDays: days, repairNumber };
}

function filename(request) {
  let name = "photo";
  try { name = decodeURIComponent(String(request.headers["x-filename"] ?? "photo")); } catch { /* keep default */ }
  return name.replace(/[\\/\r\n\0]/g, "_").trim().slice(0, 200) || "photo";
}

function contentDisposition(kind, name) {
  const ascii = name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

const photoColumns = `p.id, p.repair_id, p.repair_number, p.customer_name, p.original_name, p.content_type, p.size, p.thumb_size,
  (p.thumb_name IS NOT NULL) has_thumb, p.caption, p.created_at, p.archived_at, u.display_name uploaded_by_name`;
const photoSelect = `SELECT ${photoColumns} FROM repair_photos p LEFT JOIN users u ON u.id = p.uploaded_by`;

// Which photos each prune target removes. $1 is the age in days.
const pruneWhere = {
  archived: "p.repair_id IS NULL AND COALESCE(p.archived_at, p.created_at) <= now() - make_interval(days => $1)",
  closed: `p.repair_id IN (SELECT r.id FROM repairs r JOIN repair_statuses s ON s.id = r.status_id
    WHERE s.code IN ('DELIVERED','CANCELLED') AND COALESCE(r.closed_at, r.updated_at) <= now() - make_interval(days => $1))`,
};

/**
 * Photo files live in their own folder (a separate Docker volume), named by
 * random ids. The database only stores the names, so the folder can be backed
 * up, moved or wiped on its own.
 */
export function createPhotoStore(dir) {
  const root = dir ? path.resolve(dir) : null;
  let ready = null;
  const full = (name) => {
    if (!root || !isStoredName(name)) throw new Error("Invalid photo file name");
    return path.join(root, name);
  };

  return {
    root,
    /** Checks once that the folder exists and can be written; later calls reuse the answer. */
    async available() {
      if (!root) return false;
      ready ??= (async () => {
        try {
          await fs.mkdir(root, { recursive: true });
          await fs.access(root, fs.constants.W_OK);
          return true;
        } catch {
          return false;
        }
      })();
      const ok = await ready;
      if (!ok) ready = null;
      return ok;
    },
    async write(buffer, ext, thumb = false, base = randomUUID()) {
      const name = `${base.slice(0, 2)}/${base}${thumb ? ".thumb" : ""}.${ext}`;
      await fs.mkdir(path.dirname(full(name)), { recursive: true });
      await fs.writeFile(full(name), buffer, { flag: "wx", mode: 0o640 });
      return name;
    },
    read: async (name) => fs.readFile(full(name)),
    async exists(name) {
      try { await fs.access(full(name)); return true; } catch { return false; }
    },
    async remove(names) {
      let removed = 0;
      for (const name of names) {
        if (!name) continue;
        try { await fs.unlink(full(name)); removed += 1; } catch (error) { if (error.code !== "ENOENT") throw error; }
      }
      return removed;
    },
    /** Every stored file older than the grace period, as "ab/name" paths. */
    async list() {
      if (!root) return [];
      const names = [];
      const cutoff = Date.now() - ORPHAN_GRACE_MS;
      for (const folder of await fs.readdir(root, { withFileTypes: true })) {
        if (!folder.isDirectory() || !/^[0-9a-f]{2}$/.test(folder.name)) continue;
        for (const file of await fs.readdir(path.join(root, folder.name))) {
          const name = `${folder.name}/${file}`;
          if (!isStoredName(name)) continue;
          const stat = await fs.stat(full(name));
          if (stat.mtimeMs < cutoff) names.push(name);
        }
      }
      return names;
    },
    async disk() {
      if (!root) return null;
      try {
        const stats = await fs.statfs(root);
        return { free: stats.bavail * stats.bsize, total: stats.blocks * stats.bsize };
      } catch {
        return null;
      }
    },
  };
}

/** Deletes photo rows matching a WHERE clause, then their files once the rows are gone. */
export async function deletePhotos(pool, store, where, params) {
  const result = await pool.query(`DELETE FROM repair_photos p WHERE ${where} RETURNING p.file_name, p.thumb_name, p.size + p.thumb_size bytes`, params);
  await removeFiles(store, result.rows);
  return { deleted: result.rowCount, bytes: result.rows.reduce((sum, row) => sum + Number(row.bytes), 0) };
}

export async function removeFiles(store, rows, log) {
  try {
    await store.remove(rows.flatMap((row) => [row.file_name, row.thumb_name]));
  } catch (error) {
    // The rows are already gone; leftover files show up as orphans in the storage check.
    log?.warn({ err: error }, "Could not remove some photo files");
  }
}

export async function prunePhotos(pool, store, { target, olderThanDays, repairNumber }) {
  const params = [olderThanDays];
  let where = pruneWhere[target];
  if (target === "archived" && repairNumber) {
    params.push(repairNumber);
    where += " AND p.repair_number = $2";
  }
  return deletePhotos(pool, store, where, params);
}

export function registerPhotoRoutes(app, pool, { store, requireAdmin, readSettings }) {
  const requireStore = async () => {
    if (!(await store.available())) {
      throw Object.assign(new Error("Photo storage is not set up on the server. Check PHOTOS_DIR and the photos volume"), { statusCode: 503 });
    }
  };
  const loadPhoto = async (id) => {
    const result = await pool.query("SELECT * FROM repair_photos WHERE id=$1", [pathId(id)]);
    if (!result.rowCount) throw Object.assign(new Error("Not found"), { statusCode: 404 });
    return result.rows[0];
  };

  // Photos kept after their repair was deleted, grouped by the repair they came from.
  app.get("/api/photos/archived", async () =>
    (await pool.query(`SELECT p.repair_number, MAX(p.customer_name) customer_name, COUNT(*)::integer count,
        SUM(p.size + p.thumb_size)::bigint bytes, MAX(COALESCE(p.archived_at, p.created_at)) archived_at,
        json_agg(p.id ORDER BY p.id) ids
      FROM repair_photos p WHERE p.repair_id IS NULL GROUP BY p.repair_number ORDER BY archived_at DESC`)).rows);

  app.get("/api/repairs/:id/photos", async (request) =>
    (await pool.query(`${photoSelect} WHERE p.repair_id=$1 ORDER BY p.id`, [pathId(request.params.id)])).rows);

  // One photo per request, sent as the raw body. The browser uploads a small
  // preview separately (POST /api/photos/:id/thumbnail) right after.
  app.post("/api/repairs/:id/photos", { bodyLimit: MAX_PHOTO_BYTES }, async (request, reply) => {
    await requireStore();
    const repairId = pathId(request.params.id);
    const type = imageType(request.body);
    if (!type) return reply.code(400).send({ error: "Photos must be JPEG, PNG or WebP images" });
    const repair = await pool.query("SELECT r.repair_number, c.name customer_name FROM repairs r JOIN customers c ON c.id = r.customer_id WHERE r.id=$1", [repairId]);
    if (!repair.rowCount) return reply.code(404).send({ error: "Not found" });
    const caption = typeof request.headers["x-caption"] === "string" ? safeDecode(request.headers["x-caption"]).trim().slice(0, 500) || null : null;
    const fileName = await store.write(request.body, type.ext);
    try {
      const result = await pool.query(`INSERT INTO repair_photos (repair_id, repair_number, customer_name, file_name, original_name, content_type, size, caption, uploaded_by)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [repairId, repair.rows[0].repair_number, repair.rows[0].customer_name, fileName, filename(request), type.contentType, request.body.length, caption, request.user.id]);
      const photo = await pool.query(`${photoSelect} WHERE p.id=$1`, [result.rows[0].id]);
      return reply.code(201).send(photo.rows[0]);
    } catch (error) {
      await store.remove([fileName]);
      throw error;
    }
  });

  app.post("/api/photos/:id/thumbnail", { bodyLimit: MAX_THUMB_BYTES }, async (request, reply) => {
    await requireStore();
    const photo = await loadPhoto(request.params.id);
    const type = imageType(request.body);
    if (!type) return reply.code(400).send({ error: "Thumbnails must be JPEG, PNG or WebP images" });
    // Previews are cached for good, so each photo gets exactly one.
    if (photo.thumb_name) return reply.code(409).send({ error: "This photo already has a preview" });
    const base = photo.file_name.slice(3).replace(/\.[a-z]+$/, "");
    const thumbName = await store.write(request.body, type.ext, true, base);
    const result = await pool.query("UPDATE repair_photos SET thumb_name=$1, thumb_size=$2 WHERE id=$3 AND thumb_name IS NULL", [thumbName, request.body.length, photo.id]);
    if (!result.rowCount) await store.remove([thumbName]);
    return reply.code(204).send();
  });

  app.get("/api/photos/:id", async (request, reply) => {
    await requireStore();
    const photo = await loadPhoto(request.params.id);
    const thumb = request.query?.size === "thumb" && photo.thumb_name;
    let data;
    try {
      data = await store.read(thumb ? photo.thumb_name : photo.file_name);
    } catch (error) {
      if (error.code === "ENOENT") return reply.code(404).send({ error: "The photo file is missing from storage" });
      throw error;
    }
    const download = request.query?.download === "1";
    const name = photo.original_name || `${photo.repair_number}-${photo.id}.jpg`;
    return reply
      .header("Content-Type", thumb ? imageType(data)?.contentType ?? "image/jpeg" : photo.content_type)
      .header("Content-Disposition", contentDisposition(download ? "attachment" : "inline", name))
      .header("Content-Security-Policy", "default-src 'none'; img-src 'self'; sandbox")
      // Stored files never change (a new upload gets a new id), so browsers may keep them.
      .header("Cache-Control", "private, max-age=31536000, immutable")
      .send(data);
  });

  app.put("/api/photos/:id", async (request, reply) => {
    const caption = request.body?.caption;
    if (caption != null && typeof caption !== "string") throw new ValidationError("caption must be text");
    const result = await pool.query("UPDATE repair_photos SET caption=$1 WHERE id=$2", [caption?.trim().slice(0, 500) || null, pathId(request.params.id)]);
    if (!result.rowCount) return reply.code(404).send({ error: "Not found" });
    return reply.code(204).send();
  });

  app.delete("/api/photos/:id", async (request, reply) => {
    const result = await deletePhotos(pool, store, "p.id=$1", [pathId(request.params.id)]);
    if (!result.deleted) return reply.code(404).send({ error: "Not found" });
    return reply.code(204).send();
  });

  // Deletes several photos at once (the gallery's select mode).
  app.post("/api/photos/delete", async (request) => {
    const ids = Array.isArray(request.body?.ids) ? request.body.ids.map((id) => pathId(id, "ids")) : [];
    if (!ids.length || ids.length > 1000) throw new ValidationError("Choose between 1 and 1000 photos");
    return deletePhotos(pool, store, "p.id = ANY($1)", [ids]);
  });

  app.delete("/api/repairs/:id/photos", async (request) =>
    deletePhotos(pool, store, "p.repair_id=$1", [pathId(request.params.id)]));

  app.get("/api/storage", async () => {
    const totals = await pool.query(`SELECT
        COUNT(*)::integer count, COALESCE(SUM(p.size + p.thumb_size), 0)::bigint bytes,
        COUNT(*) FILTER (WHERE p.repair_id IS NULL)::integer archived_count,
        COALESCE(SUM(p.size + p.thumb_size) FILTER (WHERE p.repair_id IS NULL), 0)::bigint archived_bytes,
        COUNT(*) FILTER (WHERE s.code IN ('DELIVERED','CANCELLED'))::integer closed_count,
        COALESCE(SUM(p.size + p.thumb_size) FILTER (WHERE s.code IN ('DELIVERED','CANCELLED')), 0)::bigint closed_bytes
      FROM repair_photos p LEFT JOIN repairs r ON r.id = p.repair_id LEFT JOIN repair_statuses s ON s.id = r.status_id`);
    const row = totals.rows[0];
    const settings = await readSettings(["photos.autoDeleteDays"]);
    return {
      available: await store.available(),
      path: store.root,
      disk: await store.disk(),
      photos: { count: row.count, bytes: Number(row.bytes) },
      archived: { count: row.archived_count, bytes: Number(row.archived_bytes) },
      closed: { count: row.closed_count, bytes: Number(row.closed_bytes) },
      autoDeleteDays: Number(settings["photos.autoDeleteDays"]) || 0,
    };
  });

  app.post("/api/storage/prune", async (request) => {
    requireAdmin(request);
    return prunePhotos(pool, store, pruneInput(request.body));
  });

  // Finds photo rows whose file is gone and files no row points to; with
  // { fix: true } it removes both.
  app.post("/api/storage/verify", async (request) => {
    requireAdmin(request);
    await requireStore();
    const rows = (await pool.query("SELECT id, repair_number, file_name, thumb_name FROM repair_photos ORDER BY id")).rows;
    const known = new Set();
    const missing = [];
    for (const row of rows) {
      known.add(row.file_name);
      if (row.thumb_name) known.add(row.thumb_name);
      if (!(await store.exists(row.file_name))) missing.push({ id: row.id, repair_number: row.repair_number });
    }
    const orphans = (await store.list()).filter((name) => !known.has(name));
    if (request.body?.fix === true) {
      if (missing.length) await pool.query("DELETE FROM repair_photos WHERE id = ANY($1)", [missing.map((photo) => photo.id)]);
      await store.remove(orphans);
    }
    return { checked: rows.length, missing, orphans: orphans.length, fixed: request.body?.fix === true };
  });
}

function safeDecode(value) {
  try { return decodeURIComponent(value); } catch { return value; }
}

/** Deletes photos older than the "photos.autoDeleteDays" setting every few hours. */
export function startAutoPrune(pool, store, readSettings, log) {
  const run = async () => {
    try {
      const days = Number((await readSettings(["photos.autoDeleteDays"]))["photos.autoDeleteDays"]) || 0;
      if (days <= 0 || !(await store.available())) return;
      for (const target of ["closed", "archived"]) {
        const result = await prunePhotos(pool, store, { target, olderThanDays: days, repairNumber: null });
        if (result.deleted) log.info({ target, ...result }, "Removed old repair photos");
      }
    } catch (error) {
      log.warn({ err: error }, "Automatic photo cleanup failed");
    }
  };
  const first = setTimeout(run, 60_000);
  const timer = setInterval(run, AUTO_PRUNE_INTERVAL_MS);
  first.unref?.();
  timer.unref?.();
  return () => { clearTimeout(first); clearInterval(timer); };
}
