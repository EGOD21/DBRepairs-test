import { randomBytes } from "node:crypto";
import { audit, diff } from "./audit.js";
import { transaction } from "./billing.js";
import { choice, date, flag, id, money, object, pathId, text, ValidationError, webUrl, wholeNumber } from "./validation.js";

export const STOCK_REASONS = ["received", "used", "adjusted", "returned", "sold", "damaged"];
export const RETURN_STATUSES = ["to_ship", "shipped", "replaced", "credited", "rejected", "closed"];
export const APPOINTMENT_KINDS = ["onsite", "remote", "dropoff", "pickup", "other"];
const notFound = () => Object.assign(new Error("Not found"), { statusCode: 404 });
const conflict = (message) => Object.assign(new Error(message), { statusCode: 409 });

export function stockInput(value) {
  const body = object(value);
  const t = (field, max = 200) => text(body[field], field, { max });
  return {
    sku: t("sku", 100), name: text(body.name, "name", { required: true, max: 300 }), category: t("category"), brand: t("brand"),
    part_number: t("part_number"), barcode: t("barcode"), supplier: t("supplier"), url: body.url ? webUrl(body.url) : null,
    cost: money(body.cost, "cost"), price: money(body.price, "price"),
    reorder_level: wholeNumber(body.reorder_level, "reorder_level", { min: 0, max: 100000 }) ?? 0,
    reorder_quantity: wholeNumber(body.reorder_quantity, "reorder_quantity", { min: 1, max: 100000 }),
    location: t("location"), notes: text(body.notes, "notes", { max: 4000 }), active: body.active === undefined ? true : flag(body.active),
  };
}
const stockColumns = ["sku", "name", "category", "brand", "part_number", "barcode", "supplier", "url", "cost", "price", "reorder_level", "reorder_quantity", "location", "notes", "active"];

export function adjustInput(value) {
  const body = object(value);
  const change = Number(body.change);
  if (!Number.isInteger(change) || change === 0 || Math.abs(change) > 100000) throw new ValidationError("change must be a whole number other than 0");
  return { change, reason: choice(body.reason, "reason", STOCK_REASONS, change > 0 ? "received" : "adjusted"), note: text(body.note, "note", { max: 500 }) };
}

export function returnInput(value) {
  const body = object(value);
  return {
    supplier: text(body.supplier, "supplier", { required: true, max: 200 }),
    supplier_rma: text(body.supplier_rma, "supplier_rma", { max: 100 }),
    item: text(body.item, "item", { required: true, max: 300 }),
    part_number: text(body.part_number, "part_number", { max: 200 }),
    serial_number: text(body.serial_number, "serial_number", { max: 200 }),
    quantity: wholeNumber(body.quantity, "quantity", { min: 1, max: 10000 }) ?? 1,
    reason: text(body.reason, "reason", { max: 2000 }),
    status: choice(body.status, "status", RETURN_STATUSES, "to_ship"),
    repair_id: body.repair_id ? id(body.repair_id, "repair_id") : null,
    repair_part_id: body.repair_part_id ? id(body.repair_part_id, "repair_part_id") : null,
    stock_item_id: body.stock_item_id ? id(body.stock_item_id, "stock_item_id") : null,
    shipped_at: date(body.shipped_at, "shipped_at"),
    tracking: text(body.tracking, "tracking", { max: 200 }),
    resolved_at: date(body.resolved_at, "resolved_at"),
    credit_amount: money(body.credit_amount, "credit_amount"),
    notes: text(body.notes, "notes", { max: 4000 }),
  };
}
const returnColumns = ["supplier", "supplier_rma", "item", "part_number", "serial_number", "quantity", "reason", "status", "repair_id", "repair_part_id", "stock_item_id",
  "shipped_at", "tracking", "resolved_at", "credit_amount", "notes"];

export function appointmentInput(value) {
  const body = object(value);
  const starts = new Date(body.starts_at);
  const ends = new Date(body.ends_at);
  if (Number.isNaN(starts.getTime()) || Number.isNaN(ends.getTime())) throw new ValidationError("starts_at and ends_at must be dates and times");
  if (ends < starts) throw new ValidationError("The end must be after the start");
  if (ends - starts > 14 * 86400_000) throw new ValidationError("Appointments can last at most 14 days");
  return {
    title: text(body.title, "title", { required: true, max: 200 }),
    kind: choice(body.kind, "kind", APPOINTMENT_KINDS, "onsite"),
    customer_id: body.customer_id ? id(body.customer_id, "customer_id") : null,
    repair_id: body.repair_id ? id(body.repair_id, "repair_id") : null,
    asset_id: body.asset_id ? id(body.asset_id, "asset_id") : null,
    user_id: body.user_id ? id(body.user_id, "user_id") : null,
    starts_at: starts.toISOString(), ends_at: ends.toISOString(),
    all_day: flag(body.all_day),
    address: text(body.address, "address", { max: 1000 }),
    travel_minutes: wholeNumber(body.travel_minutes, "travel_minutes", { min: 0, max: 1440 }),
    notes: text(body.notes, "notes", { max: 4000 }),
    status: choice(body.status, "status", ["scheduled", "done", "cancelled"], "scheduled"),
  };
}
const appointmentColumns = ["title", "kind", "customer_id", "repair_id", "asset_id", "user_id", "starts_at", "ends_at", "all_day", "address", "travel_minutes", "notes", "status"];

/** RFC 5545 text escaping. */
const icsText = (value) => String(value ?? "").replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
const icsTime = (iso) => new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
const icsDate = (iso) => new Date(iso).toISOString().slice(0, 10).replace(/-/g, "");
// Lines longer than 75 octets are folded (continued on the next line after a space).
function fold(line) {
  const parts = [];
  let rest = line;
  // The first line holds 75 octets; continuation lines start with a space, so they hold 74 more.
  let limit = 75;
  while (Buffer.byteLength(rest) > limit) {
    let cut = limit;
    while (Buffer.byteLength(rest.slice(0, cut)) > limit) cut -= 1;
    parts.push(rest.slice(0, cut));
    rest = rest.slice(cut);
    limit = 74;
  }
  parts.push(rest);
  return parts.join("\r\n ");
}

export function toIcs(appointments, calendarName) {
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//DBRepairs//Schedule//EN", "CALSCALE:GREGORIAN", `X-WR-CALNAME:${icsText(calendarName)}`];
  for (const a of appointments) {
    lines.push("BEGIN:VEVENT", `UID:appointment-${a.id}@dbrepairs`, `DTSTAMP:${icsTime(a.updated_at ?? a.created_at ?? new Date().toISOString())}`);
    if (a.all_day) {
      const end = new Date(a.ends_at);
      end.setUTCDate(end.getUTCDate() + 1);
      lines.push(`DTSTART;VALUE=DATE:${icsDate(a.starts_at)}`, `DTEND;VALUE=DATE:${icsDate(end.toISOString())}`);
    } else {
      lines.push(`DTSTART:${icsTime(a.starts_at)}`, `DTEND:${icsTime(a.ends_at)}`);
    }
    lines.push(`SUMMARY:${icsText([a.title, a.customer_name].filter(Boolean).join(" — "))}`);
    if (a.address) lines.push(`LOCATION:${icsText(a.address)}`);
    const description = [a.repair_number ? `Repair ${a.repair_number}` : "", a.customer_phone ? `Phone ${a.customer_phone}` : "", a.notes ?? ""].filter(Boolean).join("\n");
    if (description) lines.push(`DESCRIPTION:${icsText(description)}`);
    lines.push(`STATUS:${a.status === "cancelled" ? "CANCELLED" : "CONFIRMED"}`, "END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}

const stockSelect = `SELECT s.*, (s.reorder_level > 0 AND s.quantity <= s.reorder_level) low FROM stock_items s`;
const returnSelect = `SELECT x.*, r.repair_number FROM supplier_returns x LEFT JOIN repairs r ON r.id = x.repair_id`;
const appointmentSelect = `SELECT a.*, c.name customer_name, COALESCE(c.mobile, c.phone) customer_phone, r.repair_number, s.name asset_name,
    u.display_name user_name
  FROM appointments a LEFT JOIN customers c ON c.id = a.customer_id LEFT JOIN repairs r ON r.id = a.repair_id
  LEFT JOIN assets s ON s.id = a.asset_id LEFT JOIN users u ON u.id = a.user_id`;

export function registerShopFloorRoutes(app, pool, { requireAdmin, readSettings }) {
  // ---------- Stock ----------
  app.get("/api/stock", async (request) => {
    const q = request.query ?? {};
    const params = [];
    const filters = ["s.active OR $1::boolean"];
    params.push(q.all === "1");
    if (q.low === "1") filters.push("s.reorder_level > 0 AND s.quantity <= s.reorder_level");
    if (typeof q.barcode === "string" && q.barcode.trim()) { params.push(q.barcode.trim()); filters.push(`(s.barcode = $${params.length} OR lower(s.sku) = lower($${params.length}))`); }
    if (typeof q.search === "string" && q.search.trim()) {
      params.push(`%${q.search.trim().slice(0, 100)}%`);
      const p = `$${params.length}`;
      filters.push(`(s.name ILIKE ${p} OR COALESCE(s.sku,'') ILIKE ${p} OR COALESCE(s.part_number,'') ILIKE ${p} OR COALESCE(s.category,'') ILIKE ${p} OR COALESCE(s.brand,'') ILIKE ${p} OR COALESCE(s.barcode,'') ILIKE ${p})`);
    }
    return (await pool.query(`${stockSelect} WHERE ${filters.map((f) => `(${f})`).join(" AND ")} ORDER BY lower(COALESCE(s.category, '')), lower(s.name) LIMIT 2000`, params)).rows;
  });

  app.get("/api/stock/:id/movements", async (request) =>
    (await pool.query(`SELECT m.*, u.display_name user_name, r.repair_number FROM stock_movements m LEFT JOIN users u ON u.id = m.user_id
      LEFT JOIN repairs r ON r.id = m.repair_id WHERE m.item_id=$1 ORDER BY m.id DESC LIMIT 200`, [pathId(request.params.id)])).rows);

  app.post("/api/stock", async (request, reply) => {
    const input = stockInput(request.body);
    const startQuantity = wholeNumber(request.body?.quantity, "quantity", { min: 0, max: 100000 }) ?? 0;
    const itemId = await transaction(pool, async (client) => {
      const created = await client.query(`INSERT INTO stock_items (${stockColumns.join(",")}, quantity) VALUES (${stockColumns.map((_, i) => `$${i + 1}`).join(",")}, $${stockColumns.length + 1}) RETURNING id`,
        [...stockColumns.map((c) => input[c]), startQuantity]);
      const newId = created.rows[0].id;
      if (startQuantity) await client.query("INSERT INTO stock_movements (item_id, change, reason, user_id, note) VALUES ($1,$2,'received',$3,'Opening count')", [newId, startQuantity, request.user.id]);
      await audit(client, request, { action: "create", entity: "stock", entityId: newId, summary: `Stock item "${input.name}" added (${startQuantity})` });
      return newId;
    });
    return reply.code(201).send((await pool.query(`${stockSelect} WHERE s.id=$1`, [itemId])).rows[0]);
  });

  app.put("/api/stock/:id", async (request) => {
    const itemId = pathId(request.params.id);
    const input = stockInput(request.body);
    const before = (await pool.query("SELECT * FROM stock_items WHERE id=$1", [itemId])).rows[0];
    if (!before) throw notFound();
    await pool.query(`UPDATE stock_items SET ${stockColumns.map((c, i) => `${c}=$${i + 1}`).join(", ")}, updated_at=now() WHERE id=$${stockColumns.length + 1}`,
      [...stockColumns.map((c) => input[c]), itemId]);
    await audit(pool, request, { action: "update", entity: "stock", entityId: itemId, summary: `Stock item "${input.name}" updated`, changes: diff(before, input, stockColumns) });
    return (await pool.query(`${stockSelect} WHERE s.id=$1`, [itemId])).rows[0];
  });

  app.delete("/api/stock/:id", async (request, reply) => {
    requireAdmin(request);
    const itemId = pathId(request.params.id);
    const row = (await pool.query("DELETE FROM stock_items WHERE id=$1 RETURNING name", [itemId])).rows[0];
    if (!row) throw notFound();
    await audit(pool, request, { action: "delete", entity: "stock", entityId: itemId, summary: `Stock item "${row.name}" deleted` });
    return reply.code(204).send();
  });

  // Receive a delivery (+), count correction (±), damaged (−)…
  app.post("/api/stock/:id/adjust", async (request) => {
    const itemId = pathId(request.params.id);
    const input = adjustInput(request.body);
    await transaction(pool, async (client) => {
      const item = (await client.query("UPDATE stock_items SET quantity = quantity + $1, updated_at=now() WHERE id=$2 RETURNING name, quantity", [input.change, itemId])).rows[0];
      if (!item) throw notFound();
      if (item.quantity < 0) throw new ValidationError(`Only ${item.quantity - input.change} in stock`);
      await client.query("INSERT INTO stock_movements (item_id, change, reason, user_id, note) VALUES ($1,$2,$3,$4,$5)", [itemId, input.change, input.reason, request.user.id, input.note]);
      await audit(client, request, { action: "stock", entity: "stock", entityId: itemId, summary: `${item.name}: ${input.change > 0 ? "+" : ""}${input.change} (${input.reason}) → ${item.quantity}` });
    });
    return (await pool.query(`${stockSelect} WHERE s.id=$1`, [itemId])).rows[0];
  });

  // Takes parts off the shelf for a repair: they become installed parts of that repair, priced for invoicing.
  app.post("/api/repairs/:id/use-stock", async (request, reply) => {
    const repairId = pathId(request.params.id);
    const itemId = id(request.body?.item_id, "item_id");
    const quantity = wholeNumber(request.body?.quantity, "quantity", { min: 1, max: 10000 }) ?? 1;
    const partId = await transaction(pool, async (client) => {
      const repair = (await client.query("SELECT customer_id FROM repairs WHERE id=$1", [repairId])).rows[0];
      if (!repair) throw notFound();
      const item = (await client.query("SELECT * FROM stock_items WHERE id=$1 FOR UPDATE", [itemId])).rows[0];
      if (!item) throw new ValidationError("That stock item does not exist");
      if (item.quantity < quantity) throw conflict(`Only ${item.quantity} of "${item.name}" in stock`);
      await client.query("UPDATE stock_items SET quantity = quantity - $1, updated_at=now() WHERE id=$2", [quantity, itemId]);
      await client.query("INSERT INTO stock_movements (item_id, change, reason, repair_id, user_id) VALUES ($1,$2,'used',$3,$4)", [itemId, -quantity, repairId, request.user.id]);
      const part = await client.query(`INSERT INTO repair_parts (repair_id, name, part_number, supplier, url, quantity, unit_cost, status, stock_item_id, ordered_at, received_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,'installed',$8, now(), now()) RETURNING id`,
      [repairId, item.name, item.part_number ?? item.sku, item.supplier, item.url, quantity, item.price ?? item.cost, itemId]);
      await audit(client, request, { action: "stock", entity: "part", entityId: part.rows[0].id, repairId, customerId: repair.customer_id,
        summary: `${quantity} × ${item.name} taken from stock` });
      return part.rows[0].id;
    });
    return reply.code(201).send({ id: partId });
  });

  // ---------- Supplier returns ----------
  app.get("/api/returns", async (request) => {
    const open = request.query?.open === "1";
    return (await pool.query(`${returnSelect} ${open ? "WHERE x.status IN ('to_ship','shipped')" : ""} ORDER BY x.status IN ('to_ship','shipped') DESC, x.id DESC LIMIT 1000`)).rows;
  });

  app.post("/api/returns", async (request, reply) => {
    const input = returnInput(request.body);
    const created = await pool.query(`INSERT INTO supplier_returns (${returnColumns.join(",")}) VALUES (${returnColumns.map((_, i) => `$${i + 1}`).join(",")}) RETURNING id`,
      returnColumns.map((c) => input[c]));
    await audit(pool, request, { action: "create", entity: "return", entityId: created.rows[0].id, repairId: input.repair_id, summary: `Return to ${input.supplier}: ${input.item}` });
    return reply.code(201).send((await pool.query(`${returnSelect} WHERE x.id=$1`, [created.rows[0].id])).rows[0]);
  });

  app.put("/api/returns/:id", async (request) => {
    const returnId = pathId(request.params.id);
    const input = returnInput(request.body);
    const before = (await pool.query("SELECT * FROM supplier_returns WHERE id=$1", [returnId])).rows[0];
    if (!before) throw notFound();
    // Filling in dates as the return moves along.
    if (input.status === "shipped" && !input.shipped_at) input.shipped_at = new Date().toISOString().slice(0, 10);
    if (["replaced", "credited", "rejected", "closed"].includes(input.status) && !input.resolved_at) input.resolved_at = new Date().toISOString().slice(0, 10);
    await pool.query(`UPDATE supplier_returns SET ${returnColumns.map((c, i) => `${c}=$${i + 1}`).join(", ")}, updated_at=now() WHERE id=$${returnColumns.length + 1}`,
      [...returnColumns.map((c) => input[c]), returnId]);
    await audit(pool, request, { action: "update", entity: "return", entityId: returnId, repairId: input.repair_id, summary: `Return "${input.item}" ${input.status}`,
      changes: diff(before, input, ["status", "supplier_rma", "tracking", "credit_amount"]) });
    return (await pool.query(`${returnSelect} WHERE x.id=$1`, [returnId])).rows[0];
  });

  app.delete("/api/returns/:id", async (request, reply) => {
    const returnId = pathId(request.params.id);
    const row = (await pool.query("DELETE FROM supplier_returns WHERE id=$1 RETURNING item, repair_id", [returnId])).rows[0];
    if (!row) throw notFound();
    await audit(pool, request, { action: "delete", entity: "return", entityId: returnId, repairId: row.repair_id, summary: `Return "${row.item}" deleted` });
    return reply.code(204).send();
  });

  // ---------- Warranty comebacks ----------
  app.post("/api/repairs/:id/comeback", async (request, reply) => {
    const parentId = pathId(request.params.id);
    const note = text(request.body?.reported_fault, "reported_fault", { max: 4000 });
    const created = await transaction(pool, async (client) => {
      const parent = (await client.query("SELECT * FROM repairs WHERE id=$1", [parentId])).rows[0];
      if (!parent) throw notFound();
      const status = (await client.query("SELECT id FROM repair_statuses WHERE active ORDER BY sort_order LIMIT 1")).rows[0].id;
      // Inside the warranty when the repair was closed and its warranty days have not run out.
      const inWarranty = Boolean(parent.closed_at && parent.warranty_days && Date.now() <= new Date(parent.closed_at).getTime() + parent.warranty_days * 86400_000);
      const row = await client.query(`INSERT INTO repairs (repair_number, customer_id, status_id, device_type, brand, model, serial_number, imei, reported_fault,
          accessories, priority, technician, asset_id, parent_repair_id, is_warranty, internal_notes)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'high',$11,$12,$13,$14,$15) RETURNING id, EXTRACT(YEAR FROM opened_at)::integer opened_year`,
      [`TMP-${crypto.randomUUID()}`, parent.customer_id, status, parent.device_type, parent.brand, parent.model, parent.serial_number, parent.imei,
        note || `Came back after repair ${parent.repair_number}`, parent.accessories, parent.technician, parent.asset_id, parent.id, inWarranty,
        `Comeback of ${parent.repair_number}${inWarranty ? " (inside warranty)" : " (outside warranty)"}.\nOriginal work: ${parent.work_performed ?? "—"}`]);
      const { id: newId, opened_year: year } = row.rows[0];
      const number = `${year}-${String(newId).padStart(6, "0")}`;
      await client.query("UPDATE repairs SET repair_number=$1 WHERE id=$2", [number, newId]);
      await client.query("INSERT INTO repair_status_history (repair_id, status_id, note) VALUES ($1,$2,$3)", [newId, status, `Comeback of ${parent.repair_number}`]);
      await audit(client, request, { action: "create", entity: "repair", entityId: newId, repairId: newId, customerId: parent.customer_id,
        summary: `Repair ${number} opened as a ${inWarranty ? "warranty " : ""}comeback of ${parent.repair_number}` });
      await audit(client, request, { action: "comeback", entity: "repair", entityId: parent.id, repairId: parent.id, customerId: parent.customer_id,
        summary: `Came back as ${number}` });
      return { id: newId, repair_number: number, is_warranty: inWarranty };
    });
    return reply.code(201).send(created);
  });

  // ---------- Unclaimed devices ----------
  // Finished repairs waiting for pickup longer than the shop's limit.
  app.get("/api/unclaimed", async (request) => {
    const settings = await readSettings(["unclaimed.days"]);
    const days = wholeNumber(request.query?.days, "days", { min: 0, max: 3650 }) ?? (Number(settings["unclaimed.days"]) || 30);
    return (await pool.query(`SELECT r.id, r.repair_number, r.device_type, r.brand, r.model, r.pickup_reminded_at, r.final_value, r.estimated_value, r.paid,
        c.id customer_id, c.name customer_name, c.email customer_email, COALESCE(c.mobile, c.phone) customer_phone, h.ready_since,
        (CURRENT_DATE - h.ready_since::date)::integer days_waiting
      FROM repairs r JOIN customers c ON c.id = r.customer_id JOIN repair_statuses s ON s.id = r.status_id
      JOIN LATERAL (SELECT MAX(changed_at) ready_since FROM repair_status_history WHERE repair_id = r.id AND status_id = r.status_id) h ON true
      WHERE s.code = 'READY' AND h.ready_since < now() - make_interval(days => $1::integer)
      ORDER BY h.ready_since`, [days])).rows;
  });

  app.post("/api/repairs/:id/reminded", async (request, reply) => {
    const repairId = pathId(request.params.id);
    const row = (await pool.query("UPDATE repairs SET pickup_reminded_at=now() WHERE id=$1 RETURNING customer_id, repair_number", [repairId])).rows[0];
    if (!row) throw notFound();
    await audit(pool, request, { action: "remind", entity: "repair", entityId: repairId, repairId, customerId: row.customer_id, summary: "Customer reminded to collect" });
    return reply.code(204).send();
  });

  // ---------- Appointments ----------
  app.get("/api/appointments", async (request) => {
    const q = request.query ?? {};
    const params = [];
    const filters = [];
    if (q.from) { params.push(new Date(q.from).toISOString()); filters.push(`a.ends_at >= $${params.length}`); }
    if (q.to) { params.push(new Date(q.to).toISOString()); filters.push(`a.starts_at < $${params.length}`); }
    if (q.userId) { params.push(pathId(q.userId, "userId")); filters.push(`a.user_id = $${params.length}`); }
    if (q.customerId) { params.push(pathId(q.customerId, "customerId")); filters.push(`a.customer_id = $${params.length}`); }
    if (q.repairId) { params.push(pathId(q.repairId, "repairId")); filters.push(`a.repair_id = $${params.length}`); }
    for (const value of params) if (value instanceof Date && Number.isNaN(value.getTime())) throw new ValidationError("Invalid date");
    return (await pool.query(`${appointmentSelect} ${filters.length ? `WHERE ${filters.join(" AND ")}` : ""} ORDER BY a.starts_at LIMIT 2000`, params)).rows;
  });

  async function checkLinks(db, input) {
    if (input.repair_id) {
      const repair = (await db.query("SELECT customer_id FROM repairs WHERE id=$1", [input.repair_id])).rows[0];
      if (!repair) throw new ValidationError("The repair does not exist");
      if (input.customer_id && repair.customer_id !== input.customer_id) throw new ValidationError("The repair belongs to another customer");
      input.customer_id = repair.customer_id;
    }
    if (input.asset_id) {
      const asset = (await db.query("SELECT customer_id FROM assets WHERE id=$1", [input.asset_id])).rows[0];
      if (!asset || (input.customer_id && asset.customer_id !== input.customer_id)) throw new ValidationError("The equipment belongs to another customer");
    }
  }

  app.post("/api/appointments", async (request, reply) => {
    const input = appointmentInput(request.body);
    await checkLinks(pool, input);
    const created = await pool.query(`INSERT INTO appointments (${appointmentColumns.join(",")}, created_by) VALUES (${appointmentColumns.map((_, i) => `$${i + 1}`).join(",")}, $${appointmentColumns.length + 1}) RETURNING id`,
      [...appointmentColumns.map((c) => input[c]), request.user.id]);
    await audit(pool, request, { action: "create", entity: "appointment", entityId: created.rows[0].id, repairId: input.repair_id, customerId: input.customer_id,
      summary: `Appointment "${input.title}" on ${input.starts_at.slice(0, 16).replace("T", " ")} UTC` });
    return reply.code(201).send((await pool.query(`${appointmentSelect} WHERE a.id=$1`, [created.rows[0].id])).rows[0]);
  });

  app.put("/api/appointments/:id", async (request) => {
    const appointmentId = pathId(request.params.id);
    const input = appointmentInput(request.body);
    await checkLinks(pool, input);
    const before = (await pool.query("SELECT * FROM appointments WHERE id=$1", [appointmentId])).rows[0];
    if (!before) throw notFound();
    await pool.query(`UPDATE appointments SET ${appointmentColumns.map((c, i) => `${c}=$${i + 1}`).join(", ")}, updated_at=now() WHERE id=$${appointmentColumns.length + 1}`,
      [...appointmentColumns.map((c) => input[c]), appointmentId]);
    await audit(pool, request, { action: "update", entity: "appointment", entityId: appointmentId, repairId: input.repair_id, customerId: input.customer_id,
      summary: `Appointment "${input.title}" updated`, changes: diff({ ...before, starts_at: new Date(before.starts_at).toISOString(), ends_at: new Date(before.ends_at).toISOString() }, input, ["starts_at", "ends_at", "user_id", "status", "address"]) });
    return (await pool.query(`${appointmentSelect} WHERE a.id=$1`, [appointmentId])).rows[0];
  });

  app.delete("/api/appointments/:id", async (request, reply) => {
    const appointmentId = pathId(request.params.id);
    const row = (await pool.query("DELETE FROM appointments WHERE id=$1 RETURNING title, repair_id, customer_id", [appointmentId])).rows[0];
    if (!row) throw notFound();
    await audit(pool, request, { action: "delete", entity: "appointment", entityId: appointmentId, repairId: row.repair_id, customerId: row.customer_id, summary: `Appointment "${row.title}" deleted` });
    return reply.code(204).send();
  });

  // Your private calendar link (and a way to replace it if it leaks).
  app.get("/api/me/calendar", async (request) => {
    let token = (await pool.query("SELECT calendar_token FROM users WHERE id=$1", [request.user.id])).rows[0]?.calendar_token;
    if (!token) {
      token = randomBytes(24).toString("base64url");
      await pool.query("UPDATE users SET calendar_token=$1 WHERE id=$2", [token, request.user.id]);
    }
    return { path: `/api/calendar/${token}.ics` };
  });

  app.post("/api/me/calendar/reset", async (request) => {
    const token = randomBytes(24).toString("base64url");
    await pool.query("UPDATE users SET calendar_token=$1 WHERE id=$2", [token, request.user.id]);
    return { path: `/api/calendar/${token}.ics` };
  });

  // Public on purpose (calendar apps cannot sign in); the long random token is the key.
  app.get("/api/calendar/:file", async (request, reply) => {
    const match = /^([A-Za-z0-9_-]{32})\.ics$/.exec(request.params.file);
    if (!match) return reply.code(404).send({ error: "Not found" });
    const user = (await pool.query("SELECT id, display_name, active FROM users WHERE calendar_token=$1", [match[1]])).rows[0];
    if (!user || !user.active) return reply.code(404).send({ error: "Not found" });
    const rows = (await pool.query(`${appointmentSelect} WHERE (a.user_id = $1 OR a.user_id IS NULL) AND a.ends_at > now() - interval '60 days'
      ORDER BY a.starts_at LIMIT 2000`, [user.id])).rows;
    const settings = await readSettings(["office.companyName"]);
    return reply.header("Content-Type", "text/calendar; charset=utf-8").header("Cache-Control", "no-cache")
      .send(toIcs(rows, `${settings["office.companyName"] || "DBRepairs"} — ${user.display_name}`));
  });
}
