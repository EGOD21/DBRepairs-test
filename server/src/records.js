import { audit, diff } from "./audit.js";
import { nextNumber, transaction } from "./billing.js";
import { documentType } from "./photos.js";
import { decryptSecret, encryptSecret } from "./vault.js";
import { choice, date, flag, id, object, pathId, text, ValidationError, webUrl, wholeNumber } from "./validation.js";

export const ASSET_KINDS = ["desktop", "laptop", "server", "nas", "switch", "router", "firewall", "access_point", "printer", "ups", "phone", "tablet", "vm", "other"];
export const NETWORK_KINDS = ["subnet", "vlan", "wifi", "dns", "dhcp", "gateway", "vpn", "port_forward", "isp", "other"];
export const WIPE_METHODS = ["nist_clear", "nist_purge", "crypto_erase", "dod_3pass", "single_pass", "degauss", "shred", "drill"];
const MAX_FILE_BYTES = 25 * 1024 * 1024;
const notFound = () => Object.assign(new Error("Not found"), { statusCode: 404 });

export function assetInput(value) {
  const body = object(value);
  const t = (field, max = 200) => text(body[field], field, { max });
  return {
    customer_id: id(body.customer_id, "customer_id"),
    kind: choice(body.kind, "kind", ASSET_KINDS, "other"),
    name: text(body.name, "name", { required: true, max: 200 }),
    brand: t("brand"), model: t("model"), serial_number: t("serial_number"), asset_tag: t("asset_tag"), os: t("os"), cpu: t("cpu"),
    ram: t("ram"), storage: t("storage"), ip_address: t("ip_address", 100), mac_address: t("mac_address", 100), location: t("location"),
    purchase_date: date(body.purchase_date, "purchase_date"),
    warranty_end: date(body.warranty_end, "warranty_end"),
    notes: text(body.notes, "notes", { max: 8000 }),
    status: choice(body.status, "status", ["active", "retired"], "active"),
  };
}
const assetColumns = ["customer_id", "kind", "name", "brand", "model", "serial_number", "asset_tag", "os", "cpu", "ram", "storage", "ip_address", "mac_address",
  "location", "purchase_date", "warranty_end", "notes", "status"];

export function networkInput(value) {
  const body = object(value);
  if (!Array.isArray(body.items ?? [])) throw new ValidationError("items must be a list");
  const items = (body.items ?? []).map((item, index) => {
    const row = object(item);
    return { position: index, kind: choice(row.kind, "kind", NETWORK_KINDS, "other"), name: text(row.name, "name", { required: true, max: 200 }),
      value: text(row.value, "value", { max: 2000 }), notes: text(row.notes, "notes", { max: 2000 }) };
  });
  if (items.length > 300) throw new ValidationError("At most 300 network entries");
  return { isp: text(body.isp, "isp", { max: 200 }), wan_ip: text(body.wan_ip, "wan_ip", { max: 200 }), notes: text(body.notes, "notes", { max: 20000 }), items };
}

export function credentialInput(value, creating) {
  const body = object(value);
  const secret = typeof body.secret === "string" ? body.secret : "";
  if (secret.length > 4000) throw new ValidationError("The password is too long");
  return {
    customer_id: id(body.customer_id, "customer_id"),
    asset_id: body.asset_id ? id(body.asset_id, "asset_id") : null,
    label: text(body.label, "label", { required: true, max: 200 }),
    username: text(body.username, "username", { max: 500 }),
    // Leaving the password empty while editing keeps the saved one.
    secret: secret || (creating ? "" : null),
    url: body.url ? webUrl(body.url, "url") : null,
    notes: text(body.notes, "notes", { max: 4000 }),
  };
}

export function wipeInput(value) {
  const body = object(value);
  const completed = body.completed_at ? new Date(body.completed_at) : new Date();
  if (Number.isNaN(completed.getTime())) throw new ValidationError("completed_at must be a date and time");
  return {
    customer_id: id(body.customer_id, "customer_id"),
    repair_id: body.repair_id ? id(body.repair_id, "repair_id") : null,
    asset_id: body.asset_id ? id(body.asset_id, "asset_id") : null,
    drive_model: text(body.drive_model, "drive_model", { max: 200 }),
    drive_serial: text(body.drive_serial, "drive_serial", { required: true, max: 200 }),
    capacity: text(body.capacity, "capacity", { max: 100 }),
    interface: text(body.interface, "interface", { max: 100 }),
    method: choice(body.method, "method", WIPE_METHODS, "nist_clear"),
    tool: text(body.tool, "tool", { max: 200 }),
    passes: wholeNumber(body.passes, "passes", { min: 1, max: 100 }),
    completed_at: completed.toISOString(),
    result: choice(body.result, "result", ["passed", "failed"], "passed"),
    verified: flag(body.verified),
    technician: text(body.technician, "technician", { max: 200 }),
    notes: text(body.notes, "notes", { max: 4000 }),
  };
}

export function repairSignatureInput(value) {
  const body = object(value);
  const kind = choice(body.kind, "kind", ["intake", "pickup"], null);
  if (!kind) throw new ValidationError("kind must be intake or pickup");
  const name = text(body.name, "name", { required: true, max: 200 });
  const image = typeof body.signature === "string" ? body.signature : "";
  if (!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(image) || image.length > 600_000) throw new ValidationError("A signature is required");
  return { kind, name, image };
}

const assetSelect = `SELECT a.*, c.name customer_name,
    (SELECT COUNT(*) FROM repairs r WHERE r.asset_id = a.id)::integer repair_count,
    (SELECT COUNT(*) FROM credentials k WHERE k.asset_id = a.id)::integer credential_count
  FROM assets a JOIN customers c ON c.id = a.customer_id`;
const credentialSelect = `SELECT k.id, k.customer_id, k.asset_id, a.name asset_name, k.label, k.username, k.url, k.notes, (k.secret IS NOT NULL AND k.secret <> '') has_secret,
    k.created_at, k.updated_at
  FROM credentials k LEFT JOIN assets a ON a.id = k.asset_id`;
const wipeSelect = `SELECT w.*, c.name customer_name, c.company customer_company, r.repair_number, a.name asset_name, u.display_name created_by_name
  FROM data_wipes w JOIN customers c ON c.id = w.customer_id LEFT JOIN repairs r ON r.id = w.repair_id
  LEFT JOIN assets a ON a.id = w.asset_id LEFT JOIN users u ON u.id = w.created_by`;

export function registerRecordRoutes(app, pool, { requireAdmin, readSettings, store, vaultKey }) {
  async function sameCustomer(db, table, rowId, customerId, field) {
    if (!rowId) return;
    const row = await db.query(`SELECT customer_id FROM ${table} WHERE id=$1`, [rowId]);
    if (!row.rowCount) throw new ValidationError(`${field} does not exist`);
    if (row.rows[0].customer_id !== customerId) throw new ValidationError(`${field} belongs to another customer`);
  }

  // ---------- Assets ----------
  app.get("/api/assets", async (request) => {
    const q = request.query ?? {};
    const params = [];
    const filters = [];
    if (q.customerId) { params.push(pathId(q.customerId, "customerId")); filters.push(`a.customer_id = $${params.length}`); }
    if (typeof q.search === "string" && q.search.trim()) {
      params.push(`%${q.search.trim().slice(0, 100)}%`);
      filters.push(`(a.name ILIKE $${params.length} OR COALESCE(a.serial_number,'') ILIKE $${params.length} OR COALESCE(a.asset_tag,'') ILIKE $${params.length}
        OR COALESCE(a.ip_address,'') ILIKE $${params.length} OR COALESCE(a.model,'') ILIKE $${params.length} OR c.name ILIKE $${params.length})`);
    }
    return (await pool.query(`${assetSelect} ${filters.length ? `WHERE ${filters.join(" AND ")}` : ""} ORDER BY a.status, a.kind, lower(a.name) LIMIT 1000`, params)).rows;
  });

  app.get("/api/assets/:id", async (request) => {
    const assetId = pathId(request.params.id);
    const asset = (await pool.query(`${assetSelect} WHERE a.id=$1`, [assetId])).rows[0];
    if (!asset) throw notFound();
    const [repairs, plans, wipes] = await Promise.all([
      pool.query(`SELECT r.id, r.repair_number, r.opened_at, r.closed_at, r.reported_fault, s.code status_code, s.label_key status_label_key
        FROM repairs r JOIN repair_statuses s ON s.id = r.status_id WHERE r.asset_id=$1 ORDER BY r.id DESC`, [assetId]),
      pool.query("SELECT id, title, frequency, interval_count, next_due, active FROM maintenance_plans WHERE asset_id=$1 ORDER BY next_due", [assetId]),
      pool.query("SELECT id, certificate_number, drive_serial, method, completed_at, result FROM data_wipes WHERE asset_id=$1 ORDER BY id DESC", [assetId]),
    ]);
    return { ...asset, repairs: repairs.rows, plans: plans.rows, wipes: wipes.rows };
  });

  app.post("/api/assets", async (request, reply) => {
    const input = assetInput(request.body);
    const created = await pool.query(`INSERT INTO assets (${assetColumns.join(",")}) VALUES (${assetColumns.map((_, i) => `$${i + 1}`).join(",")}) RETURNING id`,
      assetColumns.map((column) => input[column]));
    await audit(pool, request, { action: "create", entity: "asset", entityId: created.rows[0].id, customerId: input.customer_id, summary: `Equipment "${input.name}" added` });
    return reply.code(201).send((await pool.query(`${assetSelect} WHERE a.id=$1`, [created.rows[0].id])).rows[0]);
  });

  app.put("/api/assets/:id", async (request) => {
    const assetId = pathId(request.params.id);
    const input = assetInput(request.body);
    const before = (await pool.query("SELECT * FROM assets WHERE id=$1", [assetId])).rows[0];
    if (!before) throw notFound();
    await pool.query(`UPDATE assets SET ${assetColumns.map((column, i) => `${column}=$${i + 1}`).join(", ")}, updated_at=now() WHERE id=$${assetColumns.length + 1}`,
      [...assetColumns.map((column) => input[column]), assetId]);
    await audit(pool, request, { action: "update", entity: "asset", entityId: assetId, customerId: input.customer_id, summary: `Equipment "${input.name}" updated`,
      changes: diff(before, input, assetColumns) });
    return (await pool.query(`${assetSelect} WHERE a.id=$1`, [assetId])).rows[0];
  });

  app.delete("/api/assets/:id", async (request, reply) => {
    const assetId = pathId(request.params.id);
    const asset = (await pool.query("DELETE FROM assets WHERE id=$1 RETURNING customer_id, name", [assetId])).rows[0];
    if (!asset) throw notFound();
    await audit(pool, request, { action: "delete", entity: "asset", entityId: assetId, customerId: asset.customer_id, summary: `Equipment "${asset.name}" deleted` });
    return reply.code(204).send();
  });

  // ---------- Network notes and documents ----------
  app.get("/api/customers/:id/network", async (request) => {
    const customerId = pathId(request.params.id);
    const [network, items, files] = await Promise.all([
      pool.query("SELECT * FROM customer_networks WHERE customer_id=$1", [customerId]),
      pool.query("SELECT * FROM network_items WHERE customer_id=$1 ORDER BY position, id", [customerId]),
      pool.query(`SELECT f.id, f.original_name, f.content_type, f.size, f.caption, f.created_at, u.display_name uploaded_by_name
        FROM customer_files f LEFT JOIN users u ON u.id = f.uploaded_by WHERE f.customer_id=$1 ORDER BY f.id`, [customerId]),
    ]);
    return { network: network.rows[0] ?? null, items: items.rows, files: files.rows };
  });

  app.put("/api/customers/:id/network", async (request, reply) => {
    const customerId = pathId(request.params.id);
    const input = networkInput(request.body);
    await transaction(pool, async (client) => {
      const exists = await client.query("SELECT 1 FROM customers WHERE id=$1", [customerId]);
      if (!exists.rowCount) throw notFound();
      await client.query(`INSERT INTO customer_networks (customer_id, isp, wan_ip, notes, updated_at, updated_by) VALUES ($1,$2,$3,$4,now(),$5)
        ON CONFLICT (customer_id) DO UPDATE SET isp=EXCLUDED.isp, wan_ip=EXCLUDED.wan_ip, notes=EXCLUDED.notes, updated_at=now(), updated_by=EXCLUDED.updated_by`,
      [customerId, input.isp, input.wan_ip, input.notes, request.user.display_name || request.user.username]);
      await client.query("DELETE FROM network_items WHERE customer_id=$1", [customerId]);
      for (const item of input.items) {
        await client.query("INSERT INTO network_items (customer_id, position, kind, name, value, notes) VALUES ($1,$2,$3,$4,$5,$6)",
          [customerId, item.position, item.kind, item.name, item.value, item.notes]);
      }
      await audit(client, request, { action: "update", entity: "network", entityId: customerId, customerId, summary: `Network notes updated (${input.items.length} entries)` });
    });
    return reply.code(204).send();
  });

  app.post("/api/customers/:id/files", { bodyLimit: MAX_FILE_BYTES }, async (request, reply) => {
    const customerId = pathId(request.params.id);
    if (!(await store.available())) return reply.code(503).send({ error: "File storage is not set up on the server. Check PHOTOS_DIR and the photos volume" });
    const type = documentType(request.body);
    if (!type) return reply.code(400).send({ error: "Files must be JPEG, PNG, WebP or PDF" });
    const exists = await pool.query("SELECT 1 FROM customers WHERE id=$1", [customerId]);
    if (!exists.rowCount) return reply.code(404).send({ error: "Not found" });
    let name = "file";
    try { name = decodeURIComponent(String(request.headers["x-filename"] ?? "file")); } catch { /* keep default */ }
    name = name.replace(/[\\/\r\n\0]/g, "_").trim().slice(0, 200) || "file";
    const fileName = await store.write(request.body, type.ext);
    try {
      const created = await pool.query(`INSERT INTO customer_files (customer_id, file_name, original_name, content_type, size, uploaded_by)
        VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, original_name, content_type, size, caption, created_at`, [customerId, fileName, name, type.contentType, request.body.length, request.user.id]);
      await audit(pool, request, { action: "create", entity: "file", entityId: created.rows[0].id, customerId, summary: `Document "${name}" added` });
      return reply.code(201).send(created.rows[0]);
    } catch (error) {
      await store.remove([fileName]);
      throw error;
    }
  });

  app.get("/api/files/:id", async (request, reply) => {
    const file = (await pool.query("SELECT * FROM customer_files WHERE id=$1", [pathId(request.params.id)])).rows[0];
    if (!file) throw notFound();
    let data;
    try { data = await store.read(file.file_name); } catch (error) { if (error.code === "ENOENT") return reply.code(404).send({ error: "The file is missing from storage" }); throw error; }
    const name = file.original_name || `document-${file.id}`;
    const ascii = name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
    const download = request.query?.download === "1";
    return reply.header("Content-Type", file.content_type)
      .header("Content-Disposition", `${download ? "attachment" : "inline"}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`)
      // Images open sandboxed. PDFs need the browser's viewer, which a sandbox blocks; nosniff keeps them PDFs.
      .header("Content-Security-Policy", file.content_type === "application/pdf" ? "default-src 'none'; object-src 'self'; frame-ancestors 'self'" : "default-src 'none'; img-src 'self'; sandbox")
      .header("Cache-Control", "private, max-age=31536000, immutable").send(data);
  });

  app.delete("/api/files/:id", async (request, reply) => {
    const fileId = pathId(request.params.id);
    const file = (await pool.query("DELETE FROM customer_files WHERE id=$1 RETURNING *", [fileId])).rows[0];
    if (!file) throw notFound();
    await store.remove([file.file_name]).catch(() => {});
    await audit(pool, request, { action: "delete", entity: "file", entityId: fileId, customerId: file.customer_id, summary: `Document "${file.original_name}" deleted` });
    return reply.code(204).send();
  });

  // ---------- Password vault ----------
  const requireVault = () => {
    if (!vaultKey) throw Object.assign(new Error("The password vault is off. Set VAULT_KEY on the server to turn it on"), { statusCode: 503 });
  };
  const requireVaultAccess = async (request) => {
    if (request.user.role === "admin") return;
    const settings = await readSettings(["vault.techAccess"]);
    if (settings["vault.techAccess"] === "0") throw Object.assign(new Error("Only an admin can use the password vault"), { statusCode: 403 });
  };

  app.get("/api/vault/status", async () => ({ enabled: Boolean(vaultKey) }));

  app.get("/api/credentials", async (request) => {
    const q = request.query ?? {};
    if (q.customerId) return (await pool.query(`${credentialSelect} WHERE k.customer_id=$1 ORDER BY lower(k.label)`, [pathId(q.customerId, "customerId")])).rows;
    if (q.assetId) return (await pool.query(`${credentialSelect} WHERE k.asset_id=$1 ORDER BY lower(k.label)`, [pathId(q.assetId, "assetId")])).rows;
    throw new ValidationError("customerId or assetId is required");
  });

  app.post("/api/credentials", async (request, reply) => {
    requireVault();
    await requireVaultAccess(request);
    const input = credentialInput(request.body, true);
    await sameCustomer(pool, "assets", input.asset_id, input.customer_id, "asset_id");
    const created = await pool.query(`INSERT INTO credentials (customer_id, asset_id, label, username, secret, url, notes, created_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
    [input.customer_id, input.asset_id, input.label, input.username, input.secret ? encryptSecret(vaultKey, input.secret) : null, input.url, input.notes, request.user.id]);
    await audit(pool, request, { action: "create", entity: "credential", entityId: created.rows[0].id, customerId: input.customer_id, summary: `Password "${input.label}" saved` });
    return reply.code(201).send((await pool.query(`${credentialSelect} WHERE k.id=$1`, [created.rows[0].id])).rows[0]);
  });

  app.put("/api/credentials/:id", async (request) => {
    requireVault();
    await requireVaultAccess(request);
    const credentialId = pathId(request.params.id);
    const input = credentialInput(request.body, false);
    await sameCustomer(pool, "assets", input.asset_id, input.customer_id, "asset_id");
    const result = await pool.query(`UPDATE credentials SET customer_id=$1, asset_id=$2, label=$3, username=$4, url=$5, notes=$6,
        secret = COALESCE($7, secret), updated_at=now() WHERE id=$8`,
    [input.customer_id, input.asset_id, input.label, input.username, input.url, input.notes, input.secret ? encryptSecret(vaultKey, input.secret) : null, credentialId]);
    if (!result.rowCount) throw notFound();
    await audit(pool, request, { action: "update", entity: "credential", entityId: credentialId, customerId: input.customer_id,
      summary: `Password "${input.label}" updated${input.secret ? " (new password)" : ""}` });
    return (await pool.query(`${credentialSelect} WHERE k.id=$1`, [credentialId])).rows[0];
  });

  app.delete("/api/credentials/:id", async (request, reply) => {
    await requireVaultAccess(request);
    const credentialId = pathId(request.params.id);
    const row = (await pool.query("DELETE FROM credentials WHERE id=$1 RETURNING customer_id, label", [credentialId])).rows[0];
    if (!row) throw notFound();
    await audit(pool, request, { action: "delete", entity: "credential", entityId: credentialId, customerId: row.customer_id, summary: `Password "${row.label}" deleted` });
    return reply.code(204).send();
  });

  // Showing a password is always written to the activity log.
  app.post("/api/credentials/:id/reveal", async (request) => {
    requireVault();
    await requireVaultAccess(request);
    const credentialId = pathId(request.params.id);
    const row = (await pool.query("SELECT customer_id, label, secret FROM credentials WHERE id=$1", [credentialId])).rows[0];
    if (!row) throw notFound();
    let secret = "";
    if (row.secret) {
      try { secret = decryptSecret(vaultKey, row.secret); } catch {
        throw Object.assign(new Error("This password cannot be read with the current VAULT_KEY"), { statusCode: 409 });
      }
    }
    await audit(pool, request, { action: "view", entity: "credential", entityId: credentialId, customerId: row.customer_id, summary: `Password "${row.label}" viewed` });
    return { secret };
  });

  // ---------- Intake and pickup signatures ----------
  app.get("/api/repairs/:id/signatures", async (request) =>
    (await pool.query(`SELECT id, kind, signer_name, image, signed_at FROM signatures WHERE repair_id=$1 AND kind IN ('intake','pickup') ORDER BY id`,
      [pathId(request.params.id)])).rows);

  app.post("/api/repairs/:id/signatures", { bodyLimit: 1_000_000 }, async (request, reply) => {
    const repairId = pathId(request.params.id);
    const input = repairSignatureInput(request.body);
    const repair = (await pool.query("SELECT customer_id, repair_number FROM repairs WHERE id=$1", [repairId])).rows[0];
    if (!repair) throw notFound();
    const created = await transaction(pool, async (client) => {
      // A new signature of the same kind replaces the old one.
      await client.query("DELETE FROM signatures WHERE repair_id=$1 AND kind=$2 AND invoice_id IS NULL", [repairId, input.kind]);
      const row = await client.query(`INSERT INTO signatures (kind, repair_id, signer_name, image, created_by) VALUES ($1,$2,$3,$4,$5)
        RETURNING id, kind, signer_name, image, signed_at`, [input.kind, repairId, input.name, input.image, request.user.id]);
      await audit(client, request, { action: "sign", entity: "repair", entityId: repairId, repairId, customerId: repair.customer_id,
        summary: `${input.kind === "intake" ? "Intake" : "Pickup"} signed by ${input.name}` });
      return row.rows[0];
    });
    return reply.code(201).send(created);
  });

  // ---------- Drive wipe certificates ----------
  app.get("/api/wipes", async (request) => {
    const q = request.query ?? {};
    const params = [];
    const filters = [];
    if (q.customerId) { params.push(pathId(q.customerId, "customerId")); filters.push(`w.customer_id = $${params.length}`); }
    if (q.repairId) { params.push(pathId(q.repairId, "repairId")); filters.push(`w.repair_id = $${params.length}`); }
    return (await pool.query(`${wipeSelect} ${filters.length ? `WHERE ${filters.join(" AND ")}` : ""} ORDER BY w.completed_at DESC, w.id DESC LIMIT 1000`, params)).rows;
  });

  app.get("/api/wipes/:id", async (request) => {
    const wipe = (await pool.query(`${wipeSelect} WHERE w.id=$1`, [pathId(request.params.id)])).rows[0];
    if (!wipe) throw notFound();
    return wipe;
  });

  const wipeColumns = ["customer_id", "repair_id", "asset_id", "drive_model", "drive_serial", "capacity", "interface", "method", "tool", "passes", "completed_at",
    "result", "verified", "technician", "notes"];

  app.post("/api/wipes", async (request, reply) => {
    const input = wipeInput(request.body);
    const settings = await readSettings(["wipe.prefix"]);
    const wipeId = await transaction(pool, async (client) => {
      await sameCustomer(client, "repairs", input.repair_id, input.customer_id, "repair_id");
      await sameCustomer(client, "assets", input.asset_id, input.customer_id, "asset_id");
      const number = await nextNumber(client, "wipe", settings["wipe.prefix"] || "WIPE-");
      const created = await client.query(`INSERT INTO data_wipes (certificate_number, ${wipeColumns.join(",")}, created_by)
        VALUES ($1, ${wipeColumns.map((_, i) => `$${i + 2}`).join(",")}, $${wipeColumns.length + 2}) RETURNING id`,
      [number, ...wipeColumns.map((column) => input[column]), request.user.id]);
      await audit(client, request, { action: "create", entity: "wipe", entityId: created.rows[0].id, repairId: input.repair_id, customerId: input.customer_id,
        summary: `Drive ${input.drive_serial} wiped (${input.method}, ${input.result}) — certificate ${number}` });
      return created.rows[0].id;
    });
    return reply.code(201).send((await pool.query(`${wipeSelect} WHERE w.id=$1`, [wipeId])).rows[0]);
  });

  app.put("/api/wipes/:id", async (request) => {
    const wipeId = pathId(request.params.id);
    const input = wipeInput(request.body);
    await transaction(pool, async (client) => {
      const before = (await client.query("SELECT * FROM data_wipes WHERE id=$1 FOR UPDATE", [wipeId])).rows[0];
      if (!before) throw notFound();
      await sameCustomer(client, "repairs", input.repair_id, input.customer_id, "repair_id");
      await sameCustomer(client, "assets", input.asset_id, input.customer_id, "asset_id");
      await client.query(`UPDATE data_wipes SET ${wipeColumns.map((column, i) => `${column}=$${i + 1}`).join(", ")} WHERE id=$${wipeColumns.length + 1}`,
        [...wipeColumns.map((column) => input[column]), wipeId]);
      await audit(client, request, { action: "update", entity: "wipe", entityId: wipeId, repairId: input.repair_id, customerId: input.customer_id,
        summary: `Certificate ${before.certificate_number} updated`, changes: diff(before, input, wipeColumns.filter((c) => c !== "completed_at")) });
    });
    return (await pool.query(`${wipeSelect} WHERE w.id=$1`, [wipeId])).rows[0];
  });

  app.delete("/api/wipes/:id", async (request, reply) => {
    requireAdmin(request);
    const wipeId = pathId(request.params.id);
    const row = (await pool.query("DELETE FROM data_wipes WHERE id=$1 RETURNING customer_id, repair_id, certificate_number", [wipeId])).rows[0];
    if (!row) throw notFound();
    await audit(pool, request, { action: "delete", entity: "wipe", entityId: wipeId, repairId: row.repair_id, customerId: row.customer_id, summary: `Certificate ${row.certificate_number} deleted` });
    return reply.code(204).send();
  });
}
