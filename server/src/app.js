import Fastify from "fastify";
import { createPostgresBackup, isPostgresBackup, restorePostgresBackup } from "./backup.js";
import { customerInput, partInput, pathId, repairInput, SETTING_LIMITS, settingsInput, ValidationError } from "./validation.js";
import { exportPortableBackup, importPortableBackup, PortableBackupError } from "./portable.js";
import { createLoginLimiter, issueSession, readCookie, SESSION_COOKIE, sessionCookie, verifySession } from "./auth.js";
import { ADMIN_USERNAME, findUserById, findUserByUsername, hashPassword, listUsers, newPassword, publicUser, userInput, verifyPassword } from "./users.js";
import { registerChatRoutes } from "./chat.js";
import { createPhotoStore, registerPhotoRoutes, removeFiles, startAutoPrune } from "./photos.js";
import { audit, diff, registerAuditRoutes } from "./audit.js";
import { invoiceSelect, registerBillingRoutes } from "./billing.js";
import { registerContractRoutes, slaHours, startScheduler } from "./contracts.js";
import { registerReportRoutes } from "./reports.js";
import { registerRecordRoutes } from "./records.js";
import { registerShopFloorRoutes } from "./shopfloor.js";
import { vaultKey } from "./vault.js";

const repairSelect = `SELECT r.*, c.name customer_name, c.email customer_email, c.phone customer_phone, c.mobile customer_mobile,
    c.company customer_company, s.code status_code, s.label_key status_label_key,
    (SELECT COUNT(*) FROM repair_parts p WHERE p.repair_id = r.id AND p.status IN ('needed','ordered'))::integer parts_pending,
    (SELECT COUNT(*) FROM repair_photos ph WHERE ph.repair_id = r.id)::integer photo_count,
    (SELECT a.name FROM assets a WHERE a.id = r.asset_id) asset_name,
    (SELECT p.repair_number FROM repairs p WHERE p.id = r.parent_repair_id) parent_repair_number,
    (SELECT COUNT(*) FROM repairs k WHERE k.parent_repair_id = r.id)::integer comeback_count
  FROM repairs r
  JOIN customers c ON c.id = r.customer_id
  JOIN repair_statuses s ON s.id = r.status_id`;

/** Saves the optional server-edition fields of a repair (equipment, intake checklist, data backup). */
async function saveRepairExtras(db, repairId, customerId, extras) {
  const fields = Object.keys(extras ?? {});
  if (!fields.length) return;
  if (extras.asset_id) {
    const asset = await db.query("SELECT customer_id FROM assets WHERE id=$1", [extras.asset_id]);
    if (!asset.rowCount || asset.rows[0].customer_id !== customerId) throw new ValidationError("The equipment belongs to another customer");
  }
  const values = fields.map((field) => (field === "intake_checklist" && extras[field] ? JSON.stringify(extras[field]) : extras[field]));
  await db.query(`UPDATE repairs SET ${fields.map((field, i) => `${field}=$${i + 1}`).join(", ")} WHERE id=$${fields.length + 1}`, [...values, repairId]);
}

// Customer columns plus repair statistics for lists and profiles.
const customerSelect = `SELECT c.id, c.name, c.company, c.tax_number, c.phone, c.mobile, c.email, c.address, c.notes,
    c.customer_type, c.contact_person, c.preferred_contact, c.tags, c.is_retainer, c.retainer_plan,
    c.retainer_monthly_fee, c.retainer_renewal_date, c.created_at, c.updated_at,
    COALESCE(st.repair_count, 0)::integer repair_count, COALESCE(st.open_repairs, 0)::integer open_repairs,
    COALESCE(st.total_billed, 0)::double precision total_billed, st.last_repair_at
  FROM customers c
  LEFT JOIN (
    SELECT r.customer_id, COUNT(*) repair_count,
      COUNT(*) FILTER (WHERE s.code NOT IN ('DELIVERED','CANCELLED')) open_repairs,
      SUM(COALESCE(r.final_value, 0)) total_billed, MAX(r.opened_at) last_repair_at
    FROM repairs r JOIN repair_statuses s ON s.id = r.status_id GROUP BY r.customer_id
  ) st ON st.customer_id = c.id`;

const partSelect = `SELECT p.*, r.repair_number, r.customer_id, c.name customer_name, r.device_type, r.brand, r.model
  FROM repair_parts p
  JOIN repairs r ON r.id = p.repair_id
  JOIN customers c ON c.id = r.customer_id`;

const customerColumns = "name, company, tax_number, phone, mobile, email, address, notes, customer_type, contact_person, preferred_contact, tags, is_retainer, retainer_plan, retainer_monthly_fee, retainer_renewal_date";
const customerValues = (c) => [c.name, c.company, c.taxNumber, c.phone, c.mobile, c.email, c.address, c.notes, c.customerType, c.contactPerson,
  c.preferredContact, c.tags, c.isRetainer, c.retainerPlan, c.retainerMonthlyFee, c.retainerRenewalDate];

const publicPaths = new Set(["/api/health", "/api/session", "/api/login", "/api/logout", "/api/branding"]);
// The installable-app manifest and icons are fetched by the phone before anyone signs in.
// Calendar feeds are read by calendar apps, which cannot sign in; their URL carries a secret token.
const isPublicPath = (path) => publicPaths.has(path) || path.startsWith("/api/app/") || path.startsWith("/api/calendar/");

// Home-screen icon files: setting key, fallback image in /icons, size.
const appIcons = {
  "icon-192.png": { key: "app.icon192", fallback: "/icons/icon-192.png" },
  "icon-512.png": { key: "app.icon512", fallback: "/icons/icon-512.png" },
  "maskable-512.png": { key: "app.iconMaskable", fallback: "/icons/maskable-512.png" },
  "apple-touch-icon.png": { key: "app.iconApple", fallback: "/icons/apple-touch-icon.png" },
};

function replyNotFound(reply) {
  return reply.code(404).send({ error: "Not found" });
}

export function buildApp({ pool, config, logger = true, migrateDatabase }) {
  const app = Fastify({ logger, trustProxy: config.trustProxy, bodyLimit: 3_200_000 });
  let restoring = false;

  app.addContentTypeParser("application/octet-stream", { parseAs: "buffer", bodyLimit: 256 * 1024 * 1024 }, (_request, body, done) => {
    done(null, body);
  });

  const loginLimiter = createLoginLimiter();
  app.decorateRequest("user", null);

  async function currentUser(request) {
    const session = verifySession(config.auth.sessionKey, readCookie(request.headers.cookie, SESSION_COOKIE));
    if (!session) return null;
    const user = await findUserById(pool, session.userId);
    return user && user.active && user.session_version === session.version ? user : null;
  }

  const requireAdmin = (request) => {
    if (request.user?.role !== "admin") throw Object.assign(new Error("Only an admin can do this"), { statusCode: 403 });
  };

  app.addHook("onRequest", async (request, reply) => {
    const path = request.url.split("?")[0];
    // Browsers label requests coming from other websites; never act on those.
    if (request.headers["sec-fetch-site"] === "cross-site") {
      return reply.code(403).send({ error: "Cross-site requests are not allowed" });
    }
    if (restoring && path !== "/api/health") {
      return reply.code(503).send({ error: "Database restore in progress" });
    }
    if (isPublicPath(path)) return;
    request.user = await currentUser(request);
    if (!request.user) return reply.code(401).send({ error: "Authentication required" });
  });

  app.addHook("onSend", async (_request, reply, payload) => {
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("X-Frame-Options", "SAMEORIGIN");
    reply.header("Referrer-Policy", "same-origin");
    return payload;
  });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ValidationError) return reply.code(400).send({ error: error.message });
    if (error instanceof PortableBackupError) return reply.code(400).send({ error: error.message });
    if (error.statusCode && ((error.statusCode >= 400 && error.statusCode < 500) || error.statusCode === 503)) {
      return reply.code(error.statusCode).send({ error: error.message });
    }
    if (error.code === "23503") return reply.code(409).send({ error: "This record is still in use" });
    if (error.code === "23505") return reply.code(409).send({ error: "That already exists (the number or code is taken)" });
    request.log.error(error);
    return reply.code(500).send({ error: "Internal server error" });
  });

  app.get("/api/health", async () => {
    if (restoring) return { status: "restoring" };
    await pool.query("SELECT 1");
    return { status: "ok" };
  });

  app.get("/api/session", async (request) => {
    const user = await currentUser(request);
    return user ? { authenticated: true, user: publicUser(user) } : { authenticated: false };
  });

  app.post("/api/login", async (request, reply) => {
    const username = typeof request.body?.username === "string" && request.body.username.trim() ? request.body.username.trim() : ADMIN_USERNAME;
    // Throttle per account as well as per address: behind Tailscale Serve every
    // request arrives from the same local address.
    const limiterKey = `${request.ip}|${username.toLowerCase()}`;
    if (loginLimiter.blocked(limiterKey)) return reply.code(429).send({ error: "Too many failed attempts. Try again later" });
    const user = await findUserByUsername(pool, username);
    if (!user || !user.active || !(await verifyPassword(request.body?.password, user.password_hash))) {
      loginLimiter.fail(limiterKey);
      return reply.code(401).send({ error: "Wrong username or password" });
    }
    loginLimiter.reset(limiterKey);
    const { token, maxAge } = issueSession(config.auth.sessionKey, { userId: user.id, version: user.session_version });
    return reply.header("Set-Cookie", sessionCookie(token, { maxAge, secure: request.protocol === "https" })).code(200).send({ user: publicUser(user) });
  });

  app.post("/api/logout", async (request, reply) =>
    reply.header("Set-Cookie", sessionCookie("", { maxAge: 0, secure: request.protocol === "https" })).code(204).send());

  app.get("/api/users", async (request) => { requireAdmin(request); return listUsers(pool); });

  app.post("/api/users", async (request, reply) => {
    requireAdmin(request);
    const input = userInput(request.body, { creating: true });
    if (await findUserByUsername(pool, input.username)) return reply.code(409).send({ error: "That username is already taken" });
    const result = await pool.query(`INSERT INTO users (username, display_name, password_hash, role, active) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [input.username, input.displayName, await hashPassword(input.password), input.role, input.active]);
    await audit(pool, request, { action: "create", entity: "user", entityId: result.rows[0].id, summary: `User ${input.username} (${input.role}) created` });
    return reply.code(201).send({ id: result.rows[0].id });
  });

  app.put("/api/users/:id", async (request, reply) => {
    requireAdmin(request);
    const id = pathId(request.params.id);
    const input = userInput(request.body, { creating: false });
    const existing = await findUserById(pool, id);
    if (!existing) return replyNotFound(reply);
    // The built-in admin and your own account stay active admins so nobody is locked out.
    if ((existing.username === ADMIN_USERNAME || id === request.user.id) && (input.role !== "admin" || !input.active)) {
      return reply.code(400).send({ error: "You cannot disable or demote this account" });
    }
    if (existing.username === ADMIN_USERNAME && input.password) {
      return reply.code(400).send({ error: "The admin password is set with DBREPAIRS_PASSWORD on the server" });
    }
    const endSessions = Boolean(input.password) || !input.active || input.role !== existing.role;
    await pool.query(`UPDATE users SET display_name=$1, role=$2, active=$3, password_hash=COALESCE($4, password_hash),
      session_version=session_version + $5, updated_at=now() WHERE id=$6`,
      [input.displayName, input.role, input.active, input.password ? await hashPassword(input.password) : null, endSessions ? 1 : 0, id]);
    const changes = diff(existing, { display_name: input.displayName, role: input.role, active: input.active }, ["display_name", "role", "active"]);
    if (input.password) changes.password = ["", "changed"];
    await audit(pool, request, { action: "update", entity: "user", entityId: id, summary: `User ${existing.username} updated`, changes });
    return reply.code(204).send();
  });

  app.put("/api/me/password", async (request, reply) => {
    if (request.user.username === ADMIN_USERNAME) return reply.code(400).send({ error: "The admin password is set with DBREPAIRS_PASSWORD on the server" });
    const user = await findUserByUsername(pool, request.user.username);
    if (!(await verifyPassword(request.body?.currentPassword, user.password_hash))) return reply.code(400).send({ error: "The current password is wrong" });
    const password = newPassword(request.body?.newPassword);
    const result = await pool.query("UPDATE users SET password_hash=$1, session_version=session_version+1, updated_at=now() WHERE id=$2 RETURNING session_version",
      [await hashPassword(password), user.id]);
    // Keep this browser signed in; other devices are signed out.
    const { token, maxAge } = issueSession(config.auth.sessionKey, { userId: user.id, version: result.rows[0].session_version });
    return reply.header("Set-Cookie", sessionCookie(token, { maxAge, secure: request.protocol === "https" })).code(204).send();
  });

  registerChatRoutes(app, pool, requireAdmin);
  registerAuditRoutes(app, pool, requireAdmin);
  registerBillingRoutes(app, pool, { requireAdmin, readSettings });
  registerContractRoutes(app, pool, { requireAdmin, readSettings });

  const photoStore = createPhotoStore(config.photosDir);
  registerPhotoRoutes(app, pool, { store: photoStore, requireAdmin, readSettings });
  registerReportRoutes(app, pool, { requireAdmin });
  registerShopFloorRoutes(app, pool, { requireAdmin, readSettings });
  registerRecordRoutes(app, pool, { requireAdmin, readSettings, store: photoStore, vaultKey: config.vaultKey ?? vaultKey(config.vaultSecret) });
  if (config.backgroundJobs) {
    const stopAutoPrune = startAutoPrune(pool, photoStore, readSettings, app.log);
    const stopScheduler = startScheduler(pool, readSettings, app.log);
    app.addHook("onClose", async () => { stopAutoPrune(); stopScheduler(); });
  }

  app.get("/api/customers", async (request) => {
    const search = typeof request.query?.search === "string" ? request.query.search.trim() : "";
    const term = `%${search}%`;
    return (await pool.query(`${customerSelect}
      WHERE $1 = '%%'
         OR c.name ILIKE $1
         OR COALESCE(c.company, '') ILIKE $1
         OR COALESCE(c.contact_person, '') ILIKE $1
         OR COALESCE(c.tax_number, '') ILIKE $1
         OR COALESCE(c.phone, '') ILIKE $1
         OR COALESCE(c.mobile, '') ILIKE $1
         OR COALESCE(c.email, '') ILIKE $1
         OR COALESCE(c.tags, '') ILIKE $1
      ORDER BY lower(c.name), c.id`, [term])).rows;
  });

  app.get("/api/customers/:id", async (request, reply) => {
    const result = await pool.query(`${customerSelect} WHERE c.id=$1`, [pathId(request.params.id)]);
    if (!result.rowCount) return replyNotFound(reply);
    return result.rows[0];
  });

  app.post("/api/customers", async (request, reply) => {
    const input = customerInput(request.body);
    const result = await pool.query(`INSERT INTO customers (${customerColumns})
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING id`, customerValues(input));
    await audit(pool, request, { action: "create", entity: "customer", entityId: result.rows[0].id, customerId: result.rows[0].id, summary: `Customer ${input.name} created` });
    return reply.code(201).send({ id: result.rows[0].id });
  });

  app.put("/api/customers/:id", async (request, reply) => {
    const id = pathId(request.params.id);
    const input = customerInput(request.body);
    const before = (await pool.query("SELECT * FROM customers WHERE id=$1", [id])).rows[0];
    if (!before) return replyNotFound(reply);
    await pool.query(`UPDATE customers SET (${customerColumns}, updated_at) =
      ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16, now()) WHERE id=$17`, [...customerValues(input), id]);
    const after = Object.fromEntries(customerColumns.split(", ").map((column, index) => [column, customerValues(input)[index]]));
    await audit(pool, request, { action: "update", entity: "customer", entityId: id, customerId: id, summary: `Customer ${input.name} updated`, changes: diff(before, after) });
    return reply.code(204).send();
  });

  app.delete("/api/customers/:id", async (request, reply) => {
    const id = pathId(request.params.id);
    const result = await pool.query("DELETE FROM customers WHERE id=$1 RETURNING name", [id]);
    if (!result.rowCount) return replyNotFound(reply);
    await audit(pool, request, { action: "delete", entity: "customer", entityId: id, customerId: id, summary: `Customer ${result.rows[0].name} deleted` });
    return reply.code(204).send();
  });

  app.get("/api/statuses", async () =>
    (await pool.query("SELECT id, code, label_key, sort_order FROM repair_statuses WHERE active=true ORDER BY sort_order")).rows);

  app.get("/api/repairs", async (request) => {
    const customerId = request.query?.customerId;
    if (customerId != null && customerId !== "") {
      return (await pool.query(`${repairSelect} WHERE r.customer_id=$1 ORDER BY r.id DESC`, [pathId(customerId, "customerId")])).rows;
    }
    return (await pool.query(`${repairSelect} ORDER BY r.id DESC`)).rows;
  });

  app.get("/api/repairs/:id", async (request, reply) => {
    const result = await pool.query(`${repairSelect} WHERE r.id=$1 LIMIT 1`, [pathId(request.params.id)]);
    if (!result.rowCount) return replyNotFound(reply);
    return result.rows[0];
  });

  // Intake details saved on their own from the repair page: equipment, backup choice, checklist.
  app.put("/api/repairs/:id/intake", async (request, reply) => {
    const id = pathId(request.params.id);
    const body = request.body && typeof request.body === "object" ? request.body : {};
    const { extras } = repairInput({ ...body, customer_id: 1, status_id: 1, reported_fault: "-" });
    const repair = (await pool.query("SELECT customer_id, repair_number, asset_id, data_backup FROM repairs WHERE id=$1", [id])).rows[0];
    if (!repair) return replyNotFound(reply);
    await saveRepairExtras(pool, id, repair.customer_id, extras);
    await audit(pool, request, { action: "update", entity: "repair", entityId: id, repairId: id, customerId: repair.customer_id, summary: `Intake details updated`,
      changes: diff(repair, extras, Object.keys(extras).filter((key) => key !== "intake_checklist")) });
    return reply.code(204).send();
  });

  app.get("/api/repairs/:id/history", async (request) =>
    (await pool.query(`SELECT h.id, h.status_id, s.code status_code, s.label_key status_label_key, h.changed_at, h.note
      FROM repair_status_history h JOIN repair_statuses s ON s.id=h.status_id
      WHERE h.repair_id=$1 ORDER BY h.id DESC`, [pathId(request.params.id)])).rows);

  const repairColumns = "customer_id,status_id,device_type,brand,model,serial_number,imei,reported_fault,accessories,general_condition,estimated_value,internal_notes,priority,due_date,technician,deposit,paid,warranty_days";
  const repairValues = (r) => [r.customer_id, r.status_id, r.device_type, r.brand, r.model, r.serial_number, r.imei, r.reported_fault,
    r.accessories, r.general_condition, r.estimated_value, r.internal_notes, r.priority, r.due_date, r.technician, r.deposit, r.paid, r.warranty_days];

  app.post("/api/repairs", async (request, reply) => {
    const input = repairInput(request.body);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const temporary = `TMP-${crypto.randomUUID()}`;
      const result = await client.query(`INSERT INTO repairs (repair_number,${repairColumns})
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
        RETURNING id, EXTRACT(YEAR FROM opened_at)::integer opened_year`, [temporary, ...repairValues(input)]);
      const { id, opened_year: openedYear } = result.rows[0];
      const repairNumber = `${openedYear}-${String(id).padStart(6, "0")}`;
      await client.query("UPDATE repairs SET repair_number=$1 WHERE id=$2", [repairNumber, id]);
      // Contract customers get a response deadline.
      const responseHours = await slaHours(client, input.customer_id);
      if (responseHours) await client.query("UPDATE repairs SET sla_due_at = now() + make_interval(hours => $1::integer) WHERE id=$2", [responseHours, id]);
      await client.query("INSERT INTO repair_status_history (repair_id,status_id) VALUES ($1,$2)", [id,input.status_id]);
      await saveRepairExtras(client, id, input.customer_id, input.extras);
      await audit(client, request, { action: "create", entity: "repair", entityId: id, repairId: id, customerId: input.customer_id, summary: `Repair ${repairNumber} created` });
      await client.query("COMMIT");
      return reply.code(201).send({ id });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  });

  app.put("/api/repairs/:id", async (request, reply) => {
    const id = pathId(request.params.id);
    const input = repairInput(request.body, true);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const current = await client.query("SELECT * FROM repairs WHERE id=$1 FOR UPDATE", [id]);
      if (!current.rowCount) {
        await client.query("ROLLBACK");
        return replyNotFound(reply);
      }
      await client.query(`UPDATE repairs SET (${repairColumns},diagnosis,work_performed,final_value,updated_at) =
        ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,now()),
        closed_at=CASE WHEN (SELECT code FROM repair_statuses WHERE id=$2) IN ('DELIVERED','CANCELLED') THEN COALESCE(closed_at,now()) ELSE NULL END
        WHERE id=$22`, [...repairValues(input), input.diagnosis, input.work_performed, input.final_value, id]);
      const before = current.rows[0];
      await saveRepairExtras(client, id, input.customer_id, input.extras);
      if (before.status_id !== input.status_id) {
        await client.query("INSERT INTO repair_status_history (repair_id,status_id,note) VALUES ($1,$2,$3)", [id,input.status_id,input.statusNote]);
        // Moving a repair on counts as the first response.
        await client.query("UPDATE repairs SET first_response_at = COALESCE(first_response_at, now()) WHERE id=$1", [id]);
      }
      const changes = diff(before, input, [...repairColumns.split(","), "diagnosis", "work_performed", "final_value"]);
      if (changes.status_id) {
        const names = (await client.query("SELECT id, code FROM repair_statuses WHERE id = ANY($1)", [[before.status_id, input.status_id]])).rows;
        const code = (statusId) => names.find((row) => row.id === statusId)?.code ?? statusId;
        changes.status_id = [code(before.status_id), code(input.status_id)];
      }
      await audit(client, request, { action: "update", entity: "repair", entityId: id, repairId: id, customerId: input.customer_id,
        summary: changes.status_id ? `Status ${changes.status_id[0]} → ${changes.status_id[1]}` : `Repair ${before.repair_number} updated`, changes });
      await client.query("COMMIT");
      return reply.code(204).send();
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  });

  // Status history and parts are removed with the repair (ON DELETE CASCADE).
  // Photos are deleted with ?photos=delete; otherwise they are kept as archived
  // photos that Settings > Storage can view or remove later.
  app.delete("/api/repairs/:id", async (request, reply) => {
    const id = pathId(request.params.id);
    const deletePhotos = request.query?.photos === "delete";
    const client = await pool.connect();
    let files = [];
    try {
      await client.query("BEGIN");
      if (deletePhotos) {
        files = (await client.query("DELETE FROM repair_photos WHERE repair_id=$1 RETURNING file_name, thumb_name", [id])).rows;
      } else {
        await client.query(`UPDATE repair_photos p SET archived_at=now(), customer_name=c.name
          FROM repairs r JOIN customers c ON c.id = r.customer_id WHERE r.id = p.repair_id AND p.repair_id=$1`, [id]);
      }
      await client.query("DELETE FROM signatures WHERE repair_id=$1 AND invoice_id IS NULL", [id]);
      const result = await client.query("DELETE FROM repairs WHERE id=$1 RETURNING repair_number, customer_id", [id]);
      if (!result.rowCount) {
        await client.query("ROLLBACK");
        return replyNotFound(reply);
      }
      await audit(client, request, { action: "delete", entity: "repair", entityId: id, repairId: id, customerId: result.rows[0].customer_id,
        summary: `Repair ${result.rows[0].repair_number} deleted${deletePhotos ? " with its photos" : ""}` });
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    // Files go only after the rows are committed, so a failure never leaves rows without files.
    await removeFiles(photoStore, files, request.log);
    return reply.code(204).send();
  });

  app.get("/api/parts", async (request) => {
    const status = request.query?.status;
    const filters = { open: "p.status IN ('needed','ordered')", needed: "p.status='needed'", ordered: "p.status='ordered'", all: "true" };
    const where = filters[status] ?? filters.open;
    return (await pool.query(`${partSelect} WHERE ${where} ORDER BY CASE p.status WHEN 'needed' THEN 0 WHEN 'ordered' THEN 1 ELSE 2 END, p.id DESC`)).rows;
  });

  app.get("/api/repairs/:id/parts", async (request) =>
    (await pool.query(`${partSelect} WHERE p.repair_id=$1 ORDER BY p.id`, [pathId(request.params.id)])).rows);

  const partColumns = "name,part_number,supplier,url,quantity,unit_cost,status,notes";
  const partValues = (p) => [p.name, p.part_number, p.supplier, p.url, p.quantity, p.unit_cost, p.status, p.notes];

  app.post("/api/repairs/:id/parts", async (request, reply) => {
    const repairId = pathId(request.params.id);
    const input = partInput(request.body);
    const result = await pool.query(`INSERT INTO repair_parts (repair_id,${partColumns},ordered_at,received_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,
        CASE WHEN $8 IN ('ordered','received','installed') THEN now() END,
        CASE WHEN $8 IN ('received','installed') THEN now() END) RETURNING id`, [repairId, ...partValues(input)]);
    await audit(pool, request, { action: "create", entity: "part", entityId: result.rows[0].id, repairId, summary: `Part added: ${input.name} (${input.status})` });
    return reply.code(201).send({ id: result.rows[0].id });
  });

  app.put("/api/parts/:id", async (request, reply) => {
    const input = partInput(request.body);
    const partId = pathId(request.params.id);
    const before = (await pool.query("SELECT * FROM repair_parts WHERE id=$1", [partId])).rows[0];
    if (!before) return replyNotFound(reply);
    const result = await pool.query(`UPDATE repair_parts SET (${partColumns},updated_at) = ($1,$2,$3,$4,$5,$6,$7,$8,now()),
      ordered_at = CASE WHEN $7 IN ('ordered','received','installed') THEN COALESCE(ordered_at, now()) ELSE NULL END,
      received_at = CASE WHEN $7 IN ('received','installed') THEN COALESCE(received_at, now()) ELSE NULL END
      WHERE id=$9`, [...partValues(input), partId]);
    if (!result.rowCount) return replyNotFound(reply);
    await audit(pool, request, { action: "update", entity: "part", entityId: partId, repairId: before.repair_id, summary: `Part ${input.name} updated`,
      changes: diff(before, input, partColumns.split(",")) });
    return reply.code(204).send();
  });

  app.delete("/api/parts/:id", async (request, reply) => {
    const result = await pool.query("DELETE FROM repair_parts WHERE id=$1 RETURNING repair_id, name, stock_item_id, quantity, status", [pathId(request.params.id)]);
    if (!result.rowCount) return replyNotFound(reply);
    // A part taken from stock by mistake goes back on the shelf.
    const removed = result.rows[0];
    if (removed.stock_item_id && removed.status === "installed") {
      await pool.query("UPDATE stock_items SET quantity = quantity + $1, updated_at=now() WHERE id=$2", [removed.quantity, removed.stock_item_id]);
      await pool.query("INSERT INTO stock_movements (item_id, change, reason, repair_id, user_id, note) VALUES ($1,$2,'returned',$3,$4,'Removed from repair')",
        [removed.stock_item_id, removed.quantity, removed.repair_id, request.user.id]);
    }
    await audit(pool, request, { action: "delete", entity: "part", entityId: pathId(request.params.id), repairId: result.rows[0].repair_id, summary: `Part removed: ${result.rows[0].name}` });
    return reply.code(204).send();
  });

  app.get("/api/dashboard", async () => {
    const [counts, recent, money] = await Promise.all([
      pool.query(`SELECT
        (SELECT COUNT(*) FROM repairs r JOIN repair_statuses s ON s.id=r.status_id WHERE s.code NOT IN ('DELIVERED','CANCELLED'))::integer open_repairs,
        (SELECT COUNT(*) FROM repairs r JOIN repair_statuses s ON s.id=r.status_id WHERE s.code='WAITING_CUSTOMER')::integer waiting_customer,
        (SELECT COUNT(*) FROM repairs r JOIN repair_statuses s ON s.id=r.status_id WHERE s.code='READY')::integer ready,
        (SELECT COUNT(*) FROM repairs r WHERE r.closed_at IS NOT NULL AND r.closed_at::date = CURRENT_DATE)::integer closed_today,
        (SELECT COUNT(*) FROM repairs r JOIN repair_statuses s ON s.id=r.status_id
          WHERE s.code NOT IN ('DELIVERED','CANCELLED') AND r.due_date < CURRENT_DATE)::integer overdue,
        (SELECT COUNT(*) FROM repair_parts p WHERE p.status='needed')::integer parts_to_order,
        (SELECT COUNT(*) FROM stock_items WHERE active AND reorder_level > 0 AND quantity <= reorder_level)::integer low_stock,
        (SELECT COUNT(*) FROM supplier_returns WHERE status IN ('to_ship','shipped'))::integer open_returns`),
      pool.query(`${repairSelect} ORDER BY r.id DESC LIMIT 8`),
      pool.query(`SELECT
          COALESCE(SUM(balance) FILTER (WHERE state IN ('unpaid','partial','overdue')), 0)::float8 outstanding,
          COALESCE(SUM(balance) FILTER (WHERE state = 'overdue'), 0)::float8 overdue_amount,
          COUNT(*) FILTER (WHERE state = 'overdue')::integer overdue_invoices,
          (SELECT COALESCE(SUM(minutes), 0) FROM time_entries WHERE invoice_id IS NULL AND billable)::integer unbilled_minutes,
          (SELECT COALESCE(SUM(amount), 0) FROM payments WHERE date_trunc('month', paid_at) = date_trunc('month', CURRENT_DATE))::float8 paid_this_month
        FROM (${invoiceSelect} WHERE i.kind = 'invoice') x`),
    ]);
    const row = counts.rows[0];
    return {
      stats: { openRepairs: row.open_repairs, waitingCustomer: row.waiting_customer, ready: row.ready, closedToday: row.closed_today,
        overdue: row.overdue, partsToOrder: row.parts_to_order, lowStock: row.low_stock, openReturns: row.open_returns },
      billing: money.rows[0],
      recent: recent.rows,
    };
  });

  const settingKeys = Object.keys(SETTING_LIMITS);

  async function readSettings(keys) {
    const rows = (await pool.query("SELECT key,value FROM app_settings WHERE key=ANY($1)", [keys])).rows;
    const values = new Map(rows.map((row) => [row.key, row.value]));
    return Object.fromEntries(keys.map((key) => [key, values.get(key) || ""]));
  }

  // Logo, name and colors are shown on the sign-in page, so they are public.
  app.get("/api/branding", async () => readSettings(["office.companyName", "office.logoDataUrl", "ui.theme", "billing.currency"]));

  app.get("/api/settings", async () => readSettings(settingKeys));

  // Web app manifest: lets phones install DBRepairs with the shop's name, colors and logo.
  app.get("/api/app/manifest.webmanifest", async (_request, reply) => {
    const settings = await readSettings(["office.companyName", "ui.theme"]);
    let theme = {};
    try { theme = JSON.parse(settings["ui.theme"] || "{}"); } catch { /* default colors */ }
    const color = (value, fallback) => (typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value) ? value : fallback);
    const name = settings["office.companyName"] || "DBRepairs";
    return reply.header("Content-Type", "application/manifest+json").header("Cache-Control", "no-cache").send(JSON.stringify({
      name,
      short_name: name.length > 14 ? name.slice(0, 14).trim() : name,
      description: "Repair shop manager",
      id: "/",
      start_url: "/",
      scope: "/",
      display: "standalone",
      orientation: "any",
      background_color: color(theme.background, "#f5f8fa"),
      theme_color: color(theme.sidebar, "#2d3e50"),
      icons: [
        { src: "/api/app/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
        { src: "/api/app/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
        { src: "/api/app/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      ],
      shortcuts: [
        { name: "New repair", url: "/#/repairs?filter=new", icons: [{ src: "/api/app/icon-192.png", sizes: "192x192" }] },
        { name: "Team chat", url: "/#/chat", icons: [{ src: "/api/app/icon-192.png", sizes: "192x192" }] },
      ],
    }));
  });

  // Serves the logo-based icon when one was made, otherwise the default DBRepairs icon.
  app.get("/api/app/:file", async (request, reply) => {
    const icon = appIcons[request.params.file];
    if (!icon) return replyNotFound(reply);
    const value = (await readSettings([icon.key]))[icon.key];
    const match = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(value);
    if (!match) return reply.redirect(icon.fallback, 302);
    return reply.header("Content-Type", "image/png").header("Cache-Control", "no-cache").send(Buffer.from(match[1], "base64"));
  });

  // The logo plus its four app icons can be several megabytes of base64.
  app.put("/api/settings", { bodyLimit: 16 * 1024 * 1024 }, async (request, reply) => {
    requireAdmin(request);
    const settings = settingsInput(request.body);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      for (const [key, value] of Object.entries(settings)) {
        await client.query(`INSERT INTO app_settings (key,value) VALUES ($1,$2)
          ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value`, [key, value]);
      }
      // Logos and icons are large, so only the names of changed settings are kept.
      await audit(client, request, { action: "update", entity: "settings", summary: `Settings changed: ${Object.keys(settings).join(", ").slice(0, 400)}` });
      await client.query("COMMIT");
      return reply.code(204).send();
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  });

  app.get("/api/backups/database", async (request, reply) => {
    requireAdmin(request);
    const backup = await createPostgresBackup(config.database);
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    return reply
      .header("Content-Type", "application/octet-stream")
      .header("Content-Disposition", `attachment; filename=DBRepairs-${stamp}.dump`)
      .send(backup);
  });

  app.put("/api/backups/database", { bodyLimit: 256 * 1024 * 1024 }, async (request, reply) => {
    requireAdmin(request);
    if (!isPostgresBackup(request.body)) return reply.code(400).send({ error: "Invalid PostgreSQL backup" });
    if (restoring) return reply.code(409).send({ error: "Another restore is already in progress" });
    restoring = true;
    try {
      await restorePostgresBackup(config.database, request.body);
      if (migrateDatabase) await migrateDatabase();
      // The restored data may not contain this user any more, so a failed log entry is ignored.
      await audit(pool, request, { action: "restore", entity: "backup", summary: "Database backup restored" }).catch(() => {});
      return reply.code(204).send();
    } finally {
      restoring = false;
    }
  });

  app.get("/api/backups/portable", async (request, reply) => {
    requireAdmin(request);
    const archive = await exportPortableBackup(pool);
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    return reply
      .header("Content-Type", "application/vnd.dbrepairs.backup+json")
      .header("Content-Disposition", `attachment; filename=DBRepairs-portable-${stamp}.dbrepairs`)
      .send(JSON.stringify(archive));
  });

  app.put("/api/backups/portable", { bodyLimit: 256 * 1024 * 1024 }, async (request, reply) => {
    requireAdmin(request);
    if (restoring) return reply.code(409).send({ error: "Another restore is already in progress" });
    restoring = true;
    try {
      await importPortableBackup(pool, request.body);
      await audit(pool, request, { action: "restore", entity: "backup", summary: "Portable backup restored" }).catch(() => {});
      return reply.code(204).send();
    } finally {
      restoring = false;
    }
  });

  return app;
}
