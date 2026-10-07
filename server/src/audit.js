import { pathId } from "./validation.js";

const MAX_VALUE = 500;

const shorten = (value) => {
  if (value == null || value === "") return null;
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text.length > MAX_VALUE ? `${text.slice(0, MAX_VALUE)}…` : value;
};

/** Field-by-field differences between two rows: { field: [before, after] }. */
export function diff(before, after, fields = Object.keys(after ?? {})) {
  const changes = {};
  for (const field of fields) {
    const a = before?.[field] ?? null;
    const b = after?.[field] ?? null;
    const same = typeof a === "number" || typeof b === "number" ? Number(a) === Number(b) && (a === null) === (b === null) : String(a ?? "") === String(b ?? "");
    if (!same) changes[field] = [shorten(a), shorten(b)];
  }
  return changes;
}

/**
 * Records one change. `db` is the pool or the transaction's client, so the
 * entry is saved (or rolled back) together with the change itself.
 */
export async function audit(db, request, { action, entity, entityId = null, repairId = null, customerId = null, summary = null, changes = null }) {
  if (changes && !Object.keys(changes).length && action === "update") return;
  const user = request?.user;
  await db.query(`INSERT INTO audit_log (user_id, user_name, action, entity, entity_id, repair_id, customer_id, summary, changes)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
  [user?.id ?? null, user ? user.display_name || user.username : "system", action, entity, entityId, repairId, customerId,
    summary ? String(summary).slice(0, 500) : null, changes ? JSON.stringify(changes) : null]);
}

const auditSelect = "SELECT id, at, user_id, user_name, action, entity, entity_id, repair_id, customer_id, summary, changes FROM audit_log";

export function registerAuditRoutes(app, pool, requireAdmin) {
  // History of one repair or customer, shown on its page to everyone.
  app.get("/api/repairs/:id/activity", async (request) =>
    (await pool.query(`${auditSelect} WHERE repair_id=$1 ORDER BY id DESC LIMIT 200`, [pathId(request.params.id)])).rows);

  app.get("/api/customers/:id/activity", async (request) =>
    (await pool.query(`${auditSelect} WHERE customer_id=$1 ORDER BY id DESC LIMIT 200`, [pathId(request.params.id)])).rows);

  // The full log, newest first, 100 at a time (admins).
  app.get("/api/audit", async (request) => {
    requireAdmin(request);
    const filters = [];
    const params = [];
    const add = (sql, value) => { params.push(value); filters.push(sql.replaceAll("?", `$${params.length}`)); };
    const q = request.query ?? {};
    if (q.before) add("id < ?", pathId(q.before, "before"));
    if (q.userId) add("user_id = ?", pathId(q.userId, "userId"));
    if (typeof q.entity === "string" && /^[a-z_]{1,40}$/.test(q.entity)) add("entity = ?", q.entity);
    if (typeof q.search === "string" && q.search.trim()) add("(summary ILIKE ? OR user_name ILIKE ?)", `%${q.search.trim().slice(0, 100)}%`);
    if (typeof q.from === "string" && /^\d{4}-\d{2}-\d{2}$/.test(q.from)) add("at >= ?::date", q.from);
    if (typeof q.to === "string" && /^\d{4}-\d{2}-\d{2}$/.test(q.to)) add("at < ?::date + 1", q.to);
    const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
    return (await pool.query(`${auditSelect} ${where} ORDER BY id DESC LIMIT 100`, params)).rows;
  });
}
