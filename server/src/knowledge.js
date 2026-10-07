import { audit } from "./audit.js";
import { flag, id, object, pathId, text, ValidationError } from "./validation.js";

const notFound = () => Object.assign(new Error("Not found"), { statusCode: 404 });

export function articleInput(value) {
  const body = object(value);
  return {
    title: text(body.title, "title", { required: true, max: 300 }),
    body: text(body.body, "body", { max: 100_000 }) ?? "",
    tags: text(body.tags, "tags", { max: 500 }),
    device_type: text(body.device_type, "device_type", { max: 200 }),
  };
}

export function templateInput(value) {
  const body = object(value);
  const items = (text(body.items, "items", { required: true, max: 8000 }) ?? "").split("\n").map((line) => line.replace(/^[-*•]\s*/, "").trim()).filter(Boolean);
  if (!items.length) throw new ValidationError("Add at least one checklist item");
  if (items.length > 100) throw new ValidationError("At most 100 items");
  return { name: text(body.name, "name", { required: true, max: 200 }), device_type: text(body.device_type, "device_type", { max: 200 }), items: items.join("\n"),
    active: body.active === undefined ? true : flag(body.active) };
}

/** Words worth searching for: drops short and very common words. */
export function keywords(...values) {
  const stop = new Set(["the", "and", "for", "with", "not", "does", "doesn", "won", "will", "after", "when", "from", "this", "that", "has", "have", "are", "was", "but", "its"]);
  return [...new Set(values.filter(Boolean).join(" ").toLowerCase().split(/[^a-z0-9à-ÿ]+/).filter((word) => word.length > 2 && !stop.has(word)))].slice(0, 12);
}

const articleSelect = `SELECT k.id, k.title, k.body, k.tags, k.device_type, k.created_at, k.updated_at, c.display_name created_by_name, u.display_name updated_by_name
  FROM kb_articles k LEFT JOIN users c ON c.id = k.created_by LEFT JOIN users u ON u.id = k.updated_by`;

export function registerKnowledgeRoutes(app, pool, { requireAdmin }) {
  // ---------- Knowledge base ----------
  app.get("/api/kb", async (request) => {
    const search = typeof request.query?.search === "string" ? request.query.search.trim().slice(0, 200) : "";
    if (!search) return (await pool.query(`${articleSelect} ORDER BY k.updated_at DESC LIMIT 500`)).rows;
    const words = keywords(search);
    const terms = words.length ? words : [search.toLowerCase()];
    // Each matching word scores; the title counts most.
    const params = terms.map((word) => `%${word}%`);
    const score = terms.map((_, i) => `(CASE WHEN k.title ILIKE $${i + 1} THEN 3 ELSE 0 END + CASE WHEN COALESCE(k.tags,'') ILIKE $${i + 1} OR COALESCE(k.device_type,'') ILIKE $${i + 1} THEN 2 ELSE 0 END + CASE WHEN k.body ILIKE $${i + 1} THEN 1 ELSE 0 END)`).join(" + ");
    return (await pool.query(`SELECT * FROM (SELECT x.*, (${score}) score FROM (${articleSelect}) x JOIN kb_articles k ON k.id = x.id) s WHERE score > 0 ORDER BY score DESC, updated_at DESC LIMIT 100`, params)).rows;
  });

  // Articles that may help with this repair, by device and fault words.
  app.get("/api/repairs/:id/kb", async (request) => {
    const repair = (await pool.query("SELECT device_type, brand, model, reported_fault FROM repairs WHERE id=$1", [pathId(request.params.id)])).rows[0];
    if (!repair) throw notFound();
    const words = keywords(repair.device_type, repair.brand, repair.model, repair.reported_fault);
    if (!words.length) return [];
    const params = words.map((word) => `%${word}%`);
    const score = words.map((_, i) => `(CASE WHEN k.title ILIKE $${i + 1} THEN 3 ELSE 0 END + CASE WHEN COALESCE(k.tags,'') ILIKE $${i + 1} OR COALESCE(k.device_type,'') ILIKE $${i + 1} THEN 2 ELSE 0 END)`).join(" + ");
    return (await pool.query(`SELECT k.id, k.title, k.tags, k.device_type, (${score}) score FROM kb_articles k WHERE (${score}) >= 2 ORDER BY score DESC, k.updated_at DESC LIMIT 5`, params)).rows;
  });

  app.get("/api/kb/:id", async (request) => {
    const article = (await pool.query(`${articleSelect} WHERE k.id=$1`, [pathId(request.params.id)])).rows[0];
    if (!article) throw notFound();
    return article;
  });

  app.post("/api/kb", async (request, reply) => {
    const input = articleInput(request.body);
    const created = await pool.query(`INSERT INTO kb_articles (title, body, tags, device_type, created_by, updated_by) VALUES ($1,$2,$3,$4,$5,$5) RETURNING id`,
      [input.title, input.body, input.tags, input.device_type, request.user.id]);
    await audit(pool, request, { action: "create", entity: "kb", entityId: created.rows[0].id, summary: `Article "${input.title}" written` });
    return reply.code(201).send((await pool.query(`${articleSelect} WHERE k.id=$1`, [created.rows[0].id])).rows[0]);
  });

  app.put("/api/kb/:id", async (request) => {
    const articleId = pathId(request.params.id);
    const input = articleInput(request.body);
    const result = await pool.query("UPDATE kb_articles SET title=$1, body=$2, tags=$3, device_type=$4, updated_by=$5, updated_at=now() WHERE id=$6",
      [input.title, input.body, input.tags, input.device_type, request.user.id, articleId]);
    if (!result.rowCount) throw notFound();
    await audit(pool, request, { action: "update", entity: "kb", entityId: articleId, summary: `Article "${input.title}" edited` });
    return (await pool.query(`${articleSelect} WHERE k.id=$1`, [articleId])).rows[0];
  });

  app.delete("/api/kb/:id", async (request, reply) => {
    const articleId = pathId(request.params.id);
    const row = (await pool.query("DELETE FROM kb_articles WHERE id=$1 RETURNING title", [articleId])).rows[0];
    if (!row) throw notFound();
    await audit(pool, request, { action: "delete", entity: "kb", entityId: articleId, summary: `Article "${row.title}" deleted` });
    return reply.code(204).send();
  });

  // ---------- Checklist templates ----------
  app.get("/api/checklists", async () => (await pool.query("SELECT * FROM checklist_templates ORDER BY active DESC, lower(name)")).rows);

  app.post("/api/checklists", async (request, reply) => {
    requireAdmin(request);
    const input = templateInput(request.body);
    const created = await pool.query("INSERT INTO checklist_templates (name, device_type, items, active) VALUES ($1,$2,$3,$4) RETURNING *",
      [input.name, input.device_type, input.items, input.active]);
    return reply.code(201).send(created.rows[0]);
  });

  app.put("/api/checklists/:id", async (request) => {
    requireAdmin(request);
    const input = templateInput(request.body);
    const result = await pool.query("UPDATE checklist_templates SET name=$1, device_type=$2, items=$3, active=$4, updated_at=now() WHERE id=$5 RETURNING *",
      [input.name, input.device_type, input.items, input.active, pathId(request.params.id)]);
    if (!result.rowCount) throw notFound();
    return result.rows[0];
  });

  app.delete("/api/checklists/:id", async (request, reply) => {
    requireAdmin(request);
    const result = await pool.query("DELETE FROM checklist_templates WHERE id=$1", [pathId(request.params.id)]);
    if (!result.rowCount) throw notFound();
    return reply.code(204).send();
  });

  // ---------- Checklists on a repair ----------
  app.get("/api/repairs/:id/checklists", async (request) =>
    (await pool.query("SELECT * FROM repair_checklists WHERE repair_id=$1 ORDER BY id", [pathId(request.params.id)])).rows);

  app.post("/api/repairs/:id/checklists", async (request, reply) => {
    const repairId = pathId(request.params.id);
    const template = (await pool.query("SELECT * FROM checklist_templates WHERE id=$1", [id(request.body?.template_id, "template_id")])).rows[0];
    if (!template) throw new ValidationError("That checklist does not exist");
    const repair = (await pool.query("SELECT customer_id FROM repairs WHERE id=$1", [repairId])).rows[0];
    if (!repair) throw notFound();
    const items = template.items.split("\n").filter(Boolean).map((label) => ({ label, done: false }));
    const created = await pool.query("INSERT INTO repair_checklists (repair_id, name, items) VALUES ($1,$2,$3) RETURNING *", [repairId, template.name, JSON.stringify(items)]);
    await audit(pool, request, { action: "create", entity: "checklist", entityId: created.rows[0].id, repairId, customerId: repair.customer_id, summary: `Checklist "${template.name}" added` });
    return reply.code(201).send(created.rows[0]);
  });

  // Ticks or unticks one item, remembering who and when.
  app.put("/api/repair-checklists/:id/items/:index", async (request) => {
    const checklistId = pathId(request.params.id);
    const index = Number(request.params.index);
    const row = (await pool.query("SELECT * FROM repair_checklists WHERE id=$1", [checklistId])).rows[0];
    if (!row) throw notFound();
    const items = Array.isArray(row.items) ? row.items : [];
    if (!Number.isInteger(index) || index < 0 || index >= items.length) throw new ValidationError("No such item");
    const done = flag(request.body?.done);
    const note = text(request.body?.note, "note", { max: 500 });
    items[index] = { ...items[index], done, note: note ?? items[index].note ?? null,
      by: done ? request.user.display_name || request.user.username : null, at: done ? new Date().toISOString() : null };
    const updated = await pool.query("UPDATE repair_checklists SET items=$1 WHERE id=$2 RETURNING *", [JSON.stringify(items), checklistId]);
    return updated.rows[0];
  });

  app.delete("/api/repair-checklists/:id", async (request, reply) => {
    const row = (await pool.query("DELETE FROM repair_checklists WHERE id=$1 RETURNING repair_id, name", [pathId(request.params.id)])).rows[0];
    if (!row) throw notFound();
    await audit(pool, request, { action: "delete", entity: "checklist", repairId: row.repair_id, summary: `Checklist "${row.name}" removed` });
    return reply.code(204).send();
  });
}
