import { audit, diff } from "./audit.js";
import { choice, date, flag, id, object, pathId, text, ValidationError, wholeNumber } from "./validation.js";

export const PAYMENT_METHODS = ["cash", "card", "transfer", "check", "online", "other"];
export const LINE_KINDS = ["labor", "part", "service", "fee", "other"];
const INVOICE_STATUSES = ["draft", "sent", "void"];
const ESTIMATE_STATUSES = ["draft", "sent", "approved", "declined", "converted"];
const MAX_LINES = 200;

export const round2 = (value) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;

function amount(value, field, { min = -1e9, max = 1e9, fallback = 0 } = {}) {
  if (value === "" || value == null) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) throw new ValidationError(`${field} must be a number`);
  return parsed;
}

/**
 * Line amounts, then subtotal, discount, tax and total. The discount comes
 * off before tax, spread over taxable and untaxed lines by their share.
 */
export function computeTotals(lines, taxRate, discount) {
  const priced = lines.map((line) => ({ ...line, amount: round2(line.quantity * line.unit_price) }));
  const subtotal = round2(priced.reduce((sum, line) => sum + line.amount, 0));
  const taxableBase = priced.filter((line) => line.taxable).reduce((sum, line) => sum + line.amount, 0);
  const cappedDiscount = Math.min(Math.max(0, discount), Math.max(0, subtotal));
  const taxableAfterDiscount = subtotal > 0 ? taxableBase - cappedDiscount * (taxableBase / subtotal) : taxableBase;
  const taxAmount = round2(Math.max(0, taxableAfterDiscount) * (taxRate / 100));
  return { lines: priced, subtotal, discount: round2(cappedDiscount), taxAmount, total: round2(subtotal - cappedDiscount + taxAmount) };
}

function idList(value, field) {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > 500) throw new ValidationError(`${field} must be a list`);
  return [...new Set(value.map((item) => id(item, field)))];
}

export function lineInput(value, index) {
  const body = object(value);
  return {
    position: index,
    kind: choice(body.kind, "kind", LINE_KINDS, "other"),
    description: text(body.description, "description", { required: true, max: 2000 }),
    quantity: amount(body.quantity, "quantity", { min: 0, max: 100000, fallback: 1 }),
    unit_price: amount(body.unit_price, "unit_price"),
    taxable: body.taxable === undefined ? true : flag(body.taxable),
    repair_part_id: body.repair_part_id ? id(body.repair_part_id, "repair_part_id") : null,
    time_entry_ids: idList(body.time_entry_ids, "time_entry_ids"),
  };
}

export function invoiceInput(value) {
  const body = object(value);
  if (!Array.isArray(body.lines ?? [])) throw new ValidationError("lines must be a list");
  const lines = (body.lines ?? []).map(lineInput);
  if (lines.length > MAX_LINES) throw new ValidationError(`At most ${MAX_LINES} lines`);
  return {
    customer_id: id(body.customer_id, "customer_id"),
    repair_id: body.repair_id ? id(body.repair_id, "repair_id") : null,
    issue_date: date(body.issue_date, "issue_date") ?? new Date().toISOString().slice(0, 10),
    due_date: date(body.due_date, "due_date"),
    notes: text(body.notes, "notes", { max: 4000 }),
    terms: text(body.terms, "terms", { max: 4000 }),
    tax_rate: amount(body.tax_rate, "tax_rate", { min: 0, max: 100 }),
    discount: amount(body.discount, "discount", { min: 0 }),
    lines,
  };
}

export function paymentInput(value) {
  const body = object(value);
  const paid = amount(body.amount, "amount", { min: 0.01, fallback: NaN });
  if (!Number.isFinite(paid)) throw new ValidationError("amount is required");
  return {
    amount: round2(paid),
    method: choice(body.method, "method", PAYMENT_METHODS, "other"),
    paid_at: date(body.paid_at, "paid_at") ?? new Date().toISOString().slice(0, 10),
    reference: text(body.reference, "reference", { max: 200 }),
    note: text(body.note, "note", { max: 1000 }),
  };
}

export function timeInput(value) {
  const body = object(value);
  return {
    customer_id: body.customer_id ? id(body.customer_id, "customer_id") : null,
    repair_id: body.repair_id ? id(body.repair_id, "repair_id") : null,
    work_date: date(body.work_date, "work_date") ?? new Date().toISOString().slice(0, 10),
    minutes: wholeNumber(body.minutes, "minutes", { min: 1, max: 1440 }) ?? (() => { throw new ValidationError("minutes is required"); })(),
    description: text(body.description, "description", { max: 2000 }),
    billable: body.billable === undefined ? true : flag(body.billable),
    hourly_rate: body.hourly_rate === "" || body.hourly_rate == null ? null : amount(body.hourly_rate, "hourly_rate", { min: 0 }),
    user_id: body.user_id ? id(body.user_id, "user_id") : null,
  };
}

export function signatureInput(value) {
  const body = object(value);
  const name = text(body.name, "name", { required: true, max: 200 });
  const image = typeof body.signature === "string" ? body.signature : "";
  if (!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(image) || image.length > 600_000) throw new ValidationError("A signature is required");
  return { name, image };
}

/** Rounds a timer up to the shop's billing step (1, 5, 6, 10, 15 or 30 minutes). */
export function roundMinutes(minutes, step) {
  const size = [1, 5, 6, 10, 15, 30].includes(step) ? step : 1;
  return Math.min(1440, Math.max(size, Math.ceil(Math.max(1, minutes) / size) * size));
}

const paidJoin = "LEFT JOIN (SELECT invoice_id, SUM(amount) paid, MAX(paid_at) last_paid_at FROM payments GROUP BY invoice_id) pay ON pay.invoice_id = i.id";

export const invoiceSelect = `SELECT i.*, c.name customer_name, c.company customer_company, c.email customer_email, c.phone customer_phone,
    c.mobile customer_mobile, c.address customer_address, c.tax_number customer_tax_number, c.contact_person customer_contact,
    c.customer_type, r.repair_number, COALESCE(pay.paid, 0)::float8 paid_amount, (i.total - COALESCE(pay.paid, 0))::float8 balance,
    pay.last_paid_at,
    CASE
      WHEN i.kind = 'estimate' THEN
        CASE WHEN i.status IN ('draft','sent') AND i.due_date < CURRENT_DATE THEN 'expired' ELSE i.status END
      WHEN i.status IN ('void','draft') THEN i.status
      WHEN i.total > 0 AND COALESCE(pay.paid, 0) >= i.total THEN 'paid'
      WHEN i.total <= 0 THEN 'paid'
      WHEN COALESCE(pay.paid, 0) > 0 AND (i.due_date IS NULL OR i.due_date >= CURRENT_DATE) THEN 'partial'
      WHEN i.due_date < CURRENT_DATE THEN 'overdue'
      ELSE 'unpaid'
    END state
  FROM invoices i
  JOIN customers c ON c.id = i.customer_id
  LEFT JOIN repairs r ON r.id = i.repair_id
  ${paidJoin}`;

export const timeSelect = `SELECT t.*, (t.minutes / 60.0)::float8 hours, c.name customer_name, r.repair_number, i.number invoice_number,
    COALESCE(t.technician, u.display_name) technician
  FROM time_entries t
  JOIN customers c ON c.id = t.customer_id
  LEFT JOIN repairs r ON r.id = t.repair_id
  LEFT JOIN invoices i ON i.id = t.invoice_id
  LEFT JOIN users u ON u.id = t.user_id`;

async function nextNumber(client, kind, prefix) {
  const year = new Date().getFullYear();
  const result = await client.query(`INSERT INTO document_counters (kind, year, value) VALUES ($1,$2,1)
    ON CONFLICT (kind, year) DO UPDATE SET value = document_counters.value + 1 RETURNING value`, [kind, year]);
  return `${prefix}${year}-${String(result.rows[0].value).padStart(4, "0")}`;
}

/** A repair counts as paid once it has an invoice and every one of its invoices is paid. */
export async function syncRepairPaid(db, repairId) {
  if (!repairId) return;
  await db.query(`UPDATE repairs r SET paid = sub.paid FROM (
      SELECT COUNT(*) > 0 AND bool_and(COALESCE(p.paid, 0) >= i.total) paid
      FROM invoices i LEFT JOIN (SELECT invoice_id, SUM(amount) paid FROM payments GROUP BY invoice_id) p ON p.invoice_id = i.id
      WHERE i.repair_id = $1 AND i.kind = 'invoice' AND i.status NOT IN ('void','draft')
    ) sub WHERE r.id = $1 AND sub.paid IS NOT NULL AND EXISTS (SELECT 1 FROM invoices WHERE repair_id = $1 AND kind = 'invoice' AND status NOT IN ('void','draft'))`, [repairId]);
}

async function transaction(pool, work) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

const notFound = () => Object.assign(new Error("Not found"), { statusCode: 404 });
const conflict = (message) => Object.assign(new Error(message), { statusCode: 409 });

export function registerBillingRoutes(app, pool, { requireAdmin, readSettings }) {
  const billingSettings = async () => {
    const s = await readSettings(["billing.taxRate", "billing.hourlyRate", "billing.invoicePrefix", "billing.estimatePrefix", "billing.paymentTermsDays",
      "billing.estimateValidDays", "billing.invoiceNotes", "billing.timeRounding"]);
    const number = (value, fallback) => (value !== "" && Number.isFinite(Number(value)) ? Number(value) : fallback);
    return {
      taxRate: number(s["billing.taxRate"], 0),
      hourlyRate: number(s["billing.hourlyRate"], 0),
      invoicePrefix: s["billing.invoicePrefix"] || "INV-",
      estimatePrefix: s["billing.estimatePrefix"] || "EST-",
      paymentTermsDays: number(s["billing.paymentTermsDays"], 14),
      estimateValidDays: number(s["billing.estimateValidDays"], 30),
      notes: s["billing.invoiceNotes"] || null,
      timeRounding: number(s["billing.timeRounding"], 1),
    };
  };

  async function loadInvoice(db, invoiceId) {
    const result = await db.query(`${invoiceSelect} WHERE i.id=$1`, [invoiceId]);
    if (!result.rowCount) throw notFound();
    return result.rows[0];
  }

  async function invoiceDetail(invoiceId) {
    const invoice = await loadInvoice(pool, invoiceId);
    const [lines, payments, signature, time] = await Promise.all([
      pool.query("SELECT * FROM invoice_lines WHERE invoice_id=$1 ORDER BY position, id", [invoiceId]),
      pool.query(`SELECT p.*, u.display_name created_by_name FROM payments p LEFT JOIN users u ON u.id = p.created_by
        WHERE p.invoice_id=$1 ORDER BY p.paid_at, p.id`, [invoiceId]),
      pool.query("SELECT id, signer_name, image, signed_at FROM signatures WHERE invoice_id=$1 ORDER BY id DESC LIMIT 1", [invoiceId]),
      pool.query(`${timeSelect} WHERE t.invoice_id=$1 ORDER BY t.work_date, t.id`, [invoiceId]),
    ]);
    return { ...invoice, lines: lines.rows, payments: payments.rows, signature: signature.rows[0] ?? null, time_entries: time.rows };
  }

  /** Writes the lines and totals, and points the listed time entries at this invoice. */
  async function writeLines(client, invoiceId, input, customerId) {
    const totals = computeTotals(input.lines, input.tax_rate, input.discount);
    await client.query("DELETE FROM invoice_lines WHERE invoice_id=$1", [invoiceId]);
    for (const line of totals.lines) {
      await client.query(`INSERT INTO invoice_lines (invoice_id, position, kind, description, quantity, unit_price, taxable, amount, repair_part_id, time_entry_ids)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [invoiceId, line.position, line.kind, line.description, line.quantity, line.unit_price, line.taxable, line.amount, line.repair_part_id, line.time_entry_ids]);
    }
    const entryIds = [...new Set(totals.lines.flatMap((line) => line.time_entry_ids))];
    await client.query("UPDATE time_entries SET invoice_id=NULL WHERE invoice_id=$1 AND NOT (id = ANY($2))", [invoiceId, entryIds]);
    if (entryIds.length) {
      const linked = await client.query(`UPDATE time_entries SET invoice_id=$1 WHERE id = ANY($2) AND customer_id=$3
        AND (invoice_id IS NULL OR invoice_id=$1) RETURNING id`, [invoiceId, entryIds, customerId]);
      if (linked.rowCount !== entryIds.length) throw new ValidationError("Some time entries are already on another invoice or belong to another customer");
    }
    await client.query("UPDATE invoices SET subtotal=$1, discount=$2, tax_amount=$3, total=$4, updated_at=now() WHERE id=$5",
      [totals.subtotal, totals.discount, totals.taxAmount, totals.total, invoiceId]);
    return totals;
  }

  /** Suggested lines for a new invoice: unbilled time, then the repair's parts, then its price. */
  async function suggestedLines(db, { customerId, repairId, settings, kind }) {
    const lines = [];
    if (kind === "invoice") {
      const time = await db.query(`SELECT * FROM time_entries WHERE customer_id=$1 AND invoice_id IS NULL AND billable
        AND ($2::bigint IS NULL OR repair_id=$2) ORDER BY work_date, id`, [customerId, repairId]);
      for (const entry of time.rows) {
        lines.push({
          kind: "labor",
          description: [`Labor ${entry.work_date}`, entry.description].filter(Boolean).join(" — "),
          quantity: round2(entry.minutes / 60),
          unit_price: entry.hourly_rate ?? settings.hourlyRate,
          taxable: true,
          time_entry_ids: [entry.id],
        });
      }
    }
    if (repairId) {
      const parts = await db.query(`SELECT p.* FROM repair_parts p WHERE p.repair_id=$1 AND p.status <> 'cancelled'
        AND NOT EXISTS (SELECT 1 FROM invoice_lines l JOIN invoices i ON i.id = l.invoice_id
          WHERE l.repair_part_id = p.id AND i.kind = 'invoice' AND i.status <> 'void') ORDER BY p.id`, [repairId]);
      for (const part of parts.rows) {
        lines.push({ kind: "part", description: [part.name, part.part_number].filter(Boolean).join(" · "), quantity: part.quantity,
          unit_price: part.unit_cost ?? 0, taxable: true, repair_part_id: part.id, time_entry_ids: [] });
      }
      if (!lines.length) {
        const repair = (await db.query("SELECT repair_number, final_value, estimated_value, reported_fault FROM repairs WHERE id=$1", [repairId])).rows[0];
        const price = repair?.final_value ?? repair?.estimated_value;
        if (repair && price != null) {
          lines.push({ kind: "service", description: `Repair ${repair.repair_number}${repair.reported_fault ? ` — ${repair.reported_fault.slice(0, 200)}` : ""}`,
            quantity: 1, unit_price: price, taxable: true, time_entry_ids: [] });
        }
      }
    }
    return lines.map((line, index) => ({ ...line, position: index, description: line.description.slice(0, 2000), repair_part_id: line.repair_part_id ?? null }));
  }

  // ---------- Invoices and estimates ----------

  app.get("/api/invoices", async (request) => {
    const q = request.query ?? {};
    const filters = [];
    const params = [];
    const add = (sql, value) => { params.push(value); filters.push(sql.replaceAll("?", `$${params.length}`)); };
    if (q.kind === "invoice" || q.kind === "estimate") add("i.kind = ?", q.kind);
    if (q.customerId) add("i.customer_id = ?", pathId(q.customerId, "customerId"));
    if (q.repairId) add("i.repair_id = ?", pathId(q.repairId, "repairId"));
    if (typeof q.search === "string" && q.search.trim()) add("(i.number ILIKE ? OR c.name ILIKE ? OR COALESCE(c.company,'') ILIKE ? OR COALESCE(r.repair_number,'') ILIKE ?)", `%${q.search.trim().slice(0, 100)}%`);
    const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
    const rows = (await pool.query(`SELECT * FROM (${invoiceSelect} ${where}) x ORDER BY issue_date DESC, id DESC LIMIT 1000`, params)).rows;
    return typeof q.state === "string" && q.state ? rows.filter((row) => q.state === "open" ? ["unpaid", "partial", "overdue"].includes(row.state) : row.state === q.state) : rows;
  });

  app.get("/api/invoices/:id", async (request) => invoiceDetail(pathId(request.params.id)));

  // Creates a draft. With prefill, it starts with the unbilled time, parts and price of the repair.
  app.post("/api/invoices", async (request, reply) => {
    const body = object(request.body);
    const kind = choice(body.kind, "kind", ["invoice", "estimate"], "invoice");
    const customerId = id(body.customer_id, "customer_id");
    const repairId = body.repair_id ? id(body.repair_id, "repair_id") : null;
    const settings = await billingSettings();
    const created = await transaction(pool, async (client) => {
      if (repairId) {
        const repair = await client.query("SELECT customer_id FROM repairs WHERE id=$1", [repairId]);
        if (!repair.rowCount) throw notFound();
        if (repair.rows[0].customer_id !== customerId) throw new ValidationError("The repair belongs to another customer");
      }
      const number = await nextNumber(client, kind, kind === "invoice" ? settings.invoicePrefix : settings.estimatePrefix);
      const days = kind === "invoice" ? settings.paymentTermsDays : settings.estimateValidDays;
      const result = await client.query(`INSERT INTO invoices (kind, number, customer_id, repair_id, due_date, notes, tax_rate, created_by)
        VALUES ($1,$2,$3,$4, CURRENT_DATE + $5::integer, $6, $7, $8) RETURNING id`,
      [kind, number, customerId, repairId, Math.max(0, Math.round(days)), settings.notes, settings.taxRate, request.user.id]);
      const invoiceId = result.rows[0].id;
      const lines = body.prefill === false ? [] : await suggestedLines(client, { customerId, repairId, settings, kind });
      await writeLines(client, invoiceId, { lines, tax_rate: settings.taxRate, discount: 0 }, customerId);
      await audit(client, request, { action: "create", entity: kind, entityId: invoiceId, repairId, customerId, summary: `${kind === "invoice" ? "Invoice" : "Estimate"} ${number} created` });
      return invoiceId;
    });
    return reply.code(201).send(await invoiceDetail(created));
  });

  app.put("/api/invoices/:id", async (request) => {
    const invoiceId = pathId(request.params.id);
    const input = invoiceInput(request.body);
    await transaction(pool, async (client) => {
      const before = (await client.query("SELECT * FROM invoices WHERE id=$1 FOR UPDATE", [invoiceId])).rows[0];
      if (!before) throw notFound();
      if (before.status === "void") throw conflict("A void invoice cannot be changed");
      if (before.kind === "estimate" && ["approved", "converted"].includes(before.status)) {
        throw conflict("Approved estimates cannot be changed. Create a new estimate instead");
      }
      if (input.customer_id !== before.customer_id) {
        const paid = await client.query("SELECT 1 FROM payments WHERE invoice_id=$1 LIMIT 1", [invoiceId]);
        if (paid.rowCount) throw conflict("The customer cannot change after payments were recorded");
      }
      await client.query(`UPDATE invoices SET customer_id=$1, repair_id=$2, issue_date=$3, due_date=$4, notes=$5, terms=$6, tax_rate=$7
        WHERE id=$8`, [input.customer_id, input.repair_id, input.issue_date, input.due_date, input.notes, input.terms, input.tax_rate, invoiceId]);
      const totals = await writeLines(client, invoiceId, input, input.customer_id);
      const changes = diff(before, { ...input, total: totals.total }, ["customer_id", "repair_id", "issue_date", "due_date", "tax_rate", "total"]);
      await audit(client, request, { action: "update", entity: before.kind, entityId: invoiceId, repairId: input.repair_id, customerId: input.customer_id,
        summary: `${before.number} updated`, changes: Object.keys(changes).length ? changes : { lines: ["", "edited"] } });
      await syncRepairPaid(client, input.repair_id);
      if (before.repair_id !== input.repair_id) await syncRepairPaid(client, before.repair_id);
    });
    return invoiceDetail(invoiceId);
  });

  // Marks sent, back to draft, void (invoices) or declined (estimates).
  app.post("/api/invoices/:id/status", async (request) => {
    const invoiceId = pathId(request.params.id);
    const status = request.body?.status;
    await transaction(pool, async (client) => {
      const invoice = (await client.query("SELECT * FROM invoices WHERE id=$1 FOR UPDATE", [invoiceId])).rows[0];
      if (!invoice) throw notFound();
      const allowed = invoice.kind === "invoice" ? INVOICE_STATUSES : ["draft", "sent", "declined"];
      if (!allowed.includes(status)) throw new ValidationError(`status must be one of ${allowed.join(", ")}`);
      if (invoice.kind === "estimate" && invoice.status === "converted") throw conflict("This estimate was already turned into an invoice");
      if (status === "void") {
        requireAdmin(request);
        await client.query("UPDATE time_entries SET invoice_id=NULL WHERE invoice_id=$1", [invoiceId]);
      }
      if (invoice.status === "void" && status !== "void") requireAdmin(request);
      await client.query(`UPDATE invoices SET status=$1, updated_at=now(),
          sent_at = CASE WHEN $1 = 'sent' THEN COALESCE(sent_at, now()) ELSE sent_at END,
          declined_at = CASE WHEN $1 = 'declined' THEN now() ELSE NULL END,
          approved_at = CASE WHEN $1 IN ('draft','sent','declined') THEN NULL ELSE approved_at END,
          approved_name = CASE WHEN $1 IN ('draft','sent','declined') THEN NULL ELSE approved_name END
        WHERE id=$2`, [status, invoiceId]);
      await audit(client, request, { action: "status", entity: invoice.kind, entityId: invoiceId, repairId: invoice.repair_id, customerId: invoice.customer_id,
        summary: `${invoice.number}: ${invoice.status} → ${status}`, changes: { status: [invoice.status, status] } });
      await syncRepairPaid(client, invoice.repair_id);
    });
    return invoiceDetail(invoiceId);
  });

  // The customer signs on screen to approve an estimate.
  app.post("/api/invoices/:id/approve", { bodyLimit: 1_000_000 }, async (request) => {
    const invoiceId = pathId(request.params.id);
    const signature = signatureInput(request.body);
    await transaction(pool, async (client) => {
      const invoice = (await client.query("SELECT * FROM invoices WHERE id=$1 FOR UPDATE", [invoiceId])).rows[0];
      if (!invoice) throw notFound();
      if (invoice.kind !== "estimate") throw new ValidationError("Only estimates are approved");
      if (["approved", "converted"].includes(invoice.status)) throw conflict("This estimate is already approved");
      await client.query("UPDATE invoices SET status='approved', approved_at=now(), approved_name=$1, declined_at=NULL, updated_at=now() WHERE id=$2",
        [signature.name, invoiceId]);
      await client.query("INSERT INTO signatures (kind, invoice_id, repair_id, signer_name, image, created_by) VALUES ('estimate',$1,$2,$3,$4,$5)",
        [invoiceId, invoice.repair_id, signature.name, signature.image, request.user.id]);
      await audit(client, request, { action: "approve", entity: "estimate", entityId: invoiceId, repairId: invoice.repair_id, customerId: invoice.customer_id,
        summary: `${invoice.number} approved by ${signature.name}` });
    });
    return invoiceDetail(invoiceId);
  });

  // Turns an estimate into a draft invoice with the same lines.
  app.post("/api/invoices/:id/convert", async (request, reply) => {
    const estimateId = pathId(request.params.id);
    const settings = await billingSettings();
    const invoiceId = await transaction(pool, async (client) => {
      const estimate = (await client.query("SELECT * FROM invoices WHERE id=$1 FOR UPDATE", [estimateId])).rows[0];
      if (!estimate) throw notFound();
      if (estimate.kind !== "estimate") throw new ValidationError("Only estimates can be turned into invoices");
      if (estimate.status === "converted") throw conflict("This estimate was already turned into an invoice");
      const number = await nextNumber(client, "invoice", settings.invoicePrefix);
      const created = await client.query(`INSERT INTO invoices (kind, number, customer_id, repair_id, due_date, notes, terms, tax_rate, created_by)
        VALUES ('invoice',$1,$2,$3, CURRENT_DATE + $4::integer, $5, $6, $7, $8) RETURNING id`,
      [number, estimate.customer_id, estimate.repair_id, Math.max(0, Math.round(settings.paymentTermsDays)), estimate.notes, estimate.terms, estimate.tax_rate, request.user.id]);
      const newId = created.rows[0].id;
      const lines = (await client.query("SELECT * FROM invoice_lines WHERE invoice_id=$1 ORDER BY position, id", [estimateId])).rows
        .map((line, index) => ({ ...line, position: index, quantity: Number(line.quantity), unit_price: Number(line.unit_price), time_entry_ids: [] }));
      await writeLines(client, newId, { lines, tax_rate: Number(estimate.tax_rate), discount: Number(estimate.discount) }, estimate.customer_id);
      await client.query("UPDATE invoices SET status='converted', converted_to=$1, updated_at=now() WHERE id=$2", [newId, estimateId]);
      await audit(client, request, { action: "convert", entity: "estimate", entityId: estimateId, repairId: estimate.repair_id, customerId: estimate.customer_id,
        summary: `${estimate.number} turned into invoice ${number}` });
      return newId;
    });
    return reply.code(201).send(await invoiceDetail(invoiceId));
  });

  app.delete("/api/invoices/:id", async (request, reply) => {
    const invoiceId = pathId(request.params.id);
    await transaction(pool, async (client) => {
      const invoice = (await client.query("SELECT * FROM invoices WHERE id=$1 FOR UPDATE", [invoiceId])).rows[0];
      if (!invoice) throw notFound();
      const paid = await client.query("SELECT 1 FROM payments WHERE invoice_id=$1 LIMIT 1", [invoiceId]);
      if (paid.rowCount) throw conflict("Invoices with payments cannot be deleted. Void it instead");
      if (invoice.kind === "invoice" && invoice.status !== "draft") requireAdmin(request);
      await client.query("DELETE FROM invoices WHERE id=$1", [invoiceId]);
      await audit(client, request, { action: "delete", entity: invoice.kind, entityId: invoiceId, repairId: invoice.repair_id, customerId: invoice.customer_id,
        summary: `${invoice.number} deleted (total ${invoice.total})` });
      await syncRepairPaid(client, invoice.repair_id);
    });
    return reply.code(204).send();
  });

  // ---------- Payments ----------

  app.post("/api/invoices/:id/payments", async (request, reply) => {
    const invoiceId = pathId(request.params.id);
    const input = paymentInput(request.body);
    await transaction(pool, async (client) => {
      const invoice = (await client.query("SELECT * FROM invoices WHERE id=$1 FOR UPDATE", [invoiceId])).rows[0];
      if (!invoice) throw notFound();
      if (invoice.kind !== "invoice") throw new ValidationError("Payments go on invoices, not estimates");
      if (invoice.status === "void") throw conflict("A void invoice cannot take payments");
      // Recording a payment means the invoice went out.
      if (invoice.status === "draft") await client.query("UPDATE invoices SET status='sent', sent_at=COALESCE(sent_at, now()) WHERE id=$1", [invoiceId]);
      await client.query("INSERT INTO payments (invoice_id, amount, method, paid_at, reference, note, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7)",
        [invoiceId, input.amount, input.method, input.paid_at, input.reference, input.note, request.user.id]);
      await audit(client, request, { action: "payment", entity: "invoice", entityId: invoiceId, repairId: invoice.repair_id, customerId: invoice.customer_id,
        summary: `Payment of ${input.amount.toFixed(2)} (${input.method}) on ${invoice.number}` });
      await syncRepairPaid(client, invoice.repair_id);
    });
    return reply.code(201).send(await invoiceDetail(invoiceId));
  });

  app.delete("/api/payments/:id", async (request, reply) => {
    requireAdmin(request);
    const paymentId = pathId(request.params.id);
    await transaction(pool, async (client) => {
      const payment = (await client.query(`SELECT p.*, i.number, i.repair_id, i.customer_id FROM payments p JOIN invoices i ON i.id = p.invoice_id
        WHERE p.id=$1`, [paymentId])).rows[0];
      if (!payment) throw notFound();
      await client.query("DELETE FROM payments WHERE id=$1", [paymentId]);
      await audit(client, request, { action: "delete", entity: "payment", entityId: paymentId, repairId: payment.repair_id, customerId: payment.customer_id,
        summary: `Payment of ${Number(payment.amount).toFixed(2)} removed from ${payment.number}` });
      await syncRepairPaid(client, payment.repair_id);
    });
    return reply.code(204).send();
  });

  app.get("/api/payments", async (request) => {
    const q = request.query ?? {};
    const from = date(q.from, "from") ?? "1900-01-01";
    const to = date(q.to, "to") ?? "2999-12-31";
    return (await pool.query(`SELECT p.*, i.number invoice_number, i.customer_id, c.name customer_name, u.display_name created_by_name
      FROM payments p JOIN invoices i ON i.id = p.invoice_id JOIN customers c ON c.id = i.customer_id LEFT JOIN users u ON u.id = p.created_by
      WHERE p.paid_at BETWEEN $1 AND $2 ORDER BY p.paid_at DESC, p.id DESC LIMIT 2000`, [from, to])).rows;
  });

  // Money owed, unbilled time and the invoices of one customer.
  app.get("/api/customers/:id/billing", async (request) => {
    const customerId = pathId(request.params.id);
    const [invoices, unbilled] = await Promise.all([
      pool.query(`${invoiceSelect} WHERE i.customer_id=$1 ORDER BY i.issue_date DESC, i.id DESC`, [customerId]),
      pool.query(`SELECT COALESCE(SUM(minutes), 0)::integer minutes FROM time_entries WHERE customer_id=$1 AND invoice_id IS NULL AND billable`, [customerId]),
    ]);
    const open = invoices.rows.filter((row) => row.kind === "invoice" && ["unpaid", "partial", "overdue"].includes(row.state));
    return {
      invoices: invoices.rows,
      balance: round2(open.reduce((sum, row) => sum + Number(row.balance), 0)),
      overdue: round2(open.filter((row) => row.state === "overdue").reduce((sum, row) => sum + Number(row.balance), 0)),
      unbilledMinutes: unbilled.rows[0].minutes,
    };
  });

  // ---------- Time ----------

  app.get("/api/time", async (request) => {
    const q = request.query ?? {};
    const filters = [];
    const params = [];
    const add = (sql, value) => { params.push(value); filters.push(sql.replaceAll("?", `$${params.length}`)); };
    if (q.repairId) add("t.repair_id = ?", pathId(q.repairId, "repairId"));
    if (q.customerId) add("t.customer_id = ?", pathId(q.customerId, "customerId"));
    if (q.userId) add("t.user_id = ?", pathId(q.userId, "userId"));
    if (q.invoiceId) add("t.invoice_id = ?", pathId(q.invoiceId, "invoiceId"));
    if (q.unbilled === "1") filters.push("t.invoice_id IS NULL AND t.billable");
    if (q.from) add("t.work_date >= ?", date(q.from, "from"));
    if (q.to) add("t.work_date <= ?", date(q.to, "to"));
    const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
    return (await pool.query(`${timeSelect} ${where} ORDER BY t.work_date DESC, t.id DESC LIMIT 2000`, params)).rows;
  });

  async function resolveCustomer(db, input) {
    if (input.repair_id) {
      const repair = await db.query("SELECT customer_id FROM repairs WHERE id=$1", [input.repair_id]);
      if (!repair.rowCount) throw new ValidationError("The repair does not exist");
      return repair.rows[0].customer_id;
    }
    if (!input.customer_id) throw new ValidationError("Choose a repair or a customer");
    return input.customer_id;
  }

  async function technicianName(db, userId, fallback) {
    if (!userId) return fallback;
    const user = await db.query("SELECT display_name, username FROM users WHERE id=$1", [userId]);
    if (!user.rowCount) throw new ValidationError("Unknown technician");
    return user.rows[0].display_name || user.rows[0].username;
  }

  app.post("/api/time", async (request, reply) => {
    const input = timeInput(request.body);
    const settings = await billingSettings();
    const result = await transaction(pool, async (client) => {
      const customerId = await resolveCustomer(client, input);
      const userId = input.user_id ?? request.user.id;
      if (userId !== request.user.id) requireAdmin(request);
      const tech = await technicianName(client, userId, request.user.display_name);
      const created = await client.query(`INSERT INTO time_entries (customer_id, repair_id, user_id, technician, work_date, minutes, description, billable, hourly_rate)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [customerId, input.repair_id, userId, tech, input.work_date, input.minutes, input.description, input.billable, input.hourly_rate ?? settings.hourlyRate]);
      await audit(client, request, { action: "create", entity: "time", entityId: created.rows[0].id, repairId: input.repair_id, customerId,
        summary: `${tech} logged ${(input.minutes / 60).toFixed(2)} h${input.description ? `: ${input.description}` : ""}` });
      return created.rows[0].id;
    });
    return reply.code(201).send((await pool.query(`${timeSelect} WHERE t.id=$1`, [result])).rows[0]);
  });

  async function editableEntry(client, request, entryId) {
    const entry = (await client.query("SELECT * FROM time_entries WHERE id=$1 FOR UPDATE", [entryId])).rows[0];
    if (!entry) throw notFound();
    if (entry.invoice_id) throw conflict("This time is already on an invoice. Remove it from the invoice first");
    if (entry.user_id !== request.user.id) requireAdmin(request);
    return entry;
  }

  app.put("/api/time/:id", async (request) => {
    const entryId = pathId(request.params.id);
    const input = timeInput(request.body);
    await transaction(pool, async (client) => {
      const before = await editableEntry(client, request, entryId);
      const customerId = await resolveCustomer(client, input);
      const userId = input.user_id ?? before.user_id;
      if (userId !== before.user_id) requireAdmin(request);
      const tech = await technicianName(client, userId, before.technician);
      await client.query(`UPDATE time_entries SET customer_id=$1, repair_id=$2, user_id=$3, technician=$4, work_date=$5, minutes=$6, description=$7,
          billable=$8, hourly_rate=COALESCE($9, hourly_rate), updated_at=now() WHERE id=$10`,
      [customerId, input.repair_id, userId, tech, input.work_date, input.minutes, input.description, input.billable, input.hourly_rate, entryId]);
      await audit(client, request, { action: "update", entity: "time", entityId: entryId, repairId: input.repair_id, customerId, summary: `Time entry edited`,
        changes: diff(before, { ...input, customer_id: customerId }, ["work_date", "minutes", "description", "billable", "hourly_rate", "repair_id"]) });
    });
    return (await pool.query(`${timeSelect} WHERE t.id=$1`, [entryId])).rows[0];
  });

  app.delete("/api/time/:id", async (request, reply) => {
    const entryId = pathId(request.params.id);
    await transaction(pool, async (client) => {
      const entry = await editableEntry(client, request, entryId);
      await client.query("DELETE FROM time_entries WHERE id=$1", [entryId]);
      await audit(client, request, { action: "delete", entity: "time", entityId: entryId, repairId: entry.repair_id, customerId: entry.customer_id,
        summary: `Removed ${(entry.minutes / 60).toFixed(2)} h by ${entry.technician ?? "?"}` });
    });
    return reply.code(204).send();
  });

  // ---------- Timers ----------

  const timerSelect = `SELECT t.user_id, t.customer_id, t.repair_id, t.description, t.started_at, c.name customer_name, r.repair_number,
      u.display_name user_name, EXTRACT(EPOCH FROM (now() - t.started_at))::integer elapsed_seconds
    FROM running_timers t JOIN customers c ON c.id = t.customer_id LEFT JOIN repairs r ON r.id = t.repair_id JOIN users u ON u.id = t.user_id`;

  app.get("/api/timer", async (request) => (await pool.query(`${timerSelect} WHERE t.user_id=$1`, [request.user.id])).rows[0] ?? null);

  // Everyone's running timers, for the dashboard.
  app.get("/api/timers", async () => (await pool.query(`${timerSelect} ORDER BY t.started_at`)).rows);

  async function stopTimer(client, request, description) {
    const timer = (await client.query("DELETE FROM running_timers WHERE user_id=$1 RETURNING *, EXTRACT(EPOCH FROM (now() - started_at))::integer seconds",
      [request.user.id])).rows[0];
    if (!timer) return null;
    const settings = await billingSettings();
    const minutes = roundMinutes(Math.ceil(timer.seconds / 60), settings.timeRounding);
    const tech = request.user.display_name || request.user.username;
    const created = await client.query(`INSERT INTO time_entries (customer_id, repair_id, user_id, technician, work_date, minutes, description, billable, hourly_rate)
      VALUES ($1,$2,$3,$4, CURRENT_DATE, $5, $6, true, $7) RETURNING id`,
    [timer.customer_id, timer.repair_id, request.user.id, tech, minutes, description ?? timer.description, settings.hourlyRate]);
    await audit(client, request, { action: "create", entity: "time", entityId: created.rows[0].id, repairId: timer.repair_id, customerId: timer.customer_id,
      summary: `${tech} logged ${(minutes / 60).toFixed(2)} h with the timer` });
    return created.rows[0].id;
  }

  app.post("/api/timer/start", async (request) => {
    const body = object(request.body);
    const input = { repair_id: body.repair_id ? id(body.repair_id, "repair_id") : null, customer_id: body.customer_id ? id(body.customer_id, "customer_id") : null };
    const description = text(body.description, "description", { max: 2000 });
    await transaction(pool, async (client) => {
      const customerId = await resolveCustomer(client, input);
      // Starting a new timer saves the one already running.
      await stopTimer(client, request, null);
      await client.query("INSERT INTO running_timers (user_id, customer_id, repair_id, description) VALUES ($1,$2,$3,$4)",
        [request.user.id, customerId, input.repair_id, description]);
    });
    return (await pool.query(`${timerSelect} WHERE t.user_id=$1`, [request.user.id])).rows[0];
  });

  app.post("/api/timer/stop", async (request) => {
    const description = request.body && typeof request.body === "object" ? text(request.body.description, "description", { max: 2000 }) : null;
    const entryId = await transaction(pool, (client) => stopTimer(client, request, description));
    if (!entryId) throw notFound();
    return (await pool.query(`${timeSelect} WHERE t.id=$1`, [entryId])).rows[0];
  });

  app.delete("/api/timer", async (request, reply) => {
    await pool.query("DELETE FROM running_timers WHERE user_id=$1", [request.user.id]);
    return reply.code(204).send();
  });
}
