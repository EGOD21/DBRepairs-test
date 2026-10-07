import { audit, diff } from "./audit.js";
import { invoiceSelect, loadBillingSettings, nextNumber, round2, transaction, writeLines } from "./billing.js";
import { choice, date, flag, id, money, object, pathId, text, ValidationError, wholeNumber } from "./validation.js";

export const FREQUENCIES = ["weekly", "monthly", "quarterly", "yearly"];
const notFound = () => Object.assign(new Error("Not found"), { statusCode: 404 });

export function contractInput(value) {
  const body = object(value);
  const hours = body.hours_included === "" || body.hours_included == null ? 0 : Number(body.hours_included);
  if (!Number.isFinite(hours) || hours < 0 || hours > 10000) throw new ValidationError("hours_included must be a number of hours");
  return {
    customer_id: id(body.customer_id, "customer_id"),
    name: text(body.name, "name", { required: true, max: 200 }),
    monthly_fee: money(body.monthly_fee, "monthly_fee") ?? 0,
    hours_included: hours,
    overage_rate: money(body.overage_rate, "overage_rate"),
    response_hours: wholeNumber(body.response_hours, "response_hours", { min: 1, max: 720 }),
    start_date: date(body.start_date, "start_date") ?? new Date().toISOString().slice(0, 10),
    renewal_date: date(body.renewal_date, "renewal_date"),
    billing_day: wholeNumber(body.billing_day, "billing_day", { min: 1, max: 28 }) ?? 1,
    auto_invoice: flag(body.auto_invoice),
    active: body.active === undefined ? true : flag(body.active),
    notes: text(body.notes, "notes", { max: 4000 }),
  };
}

export function planInput(value) {
  const body = object(value);
  const nextDue = date(body.next_due, "next_due");
  if (!nextDue) throw new ValidationError("next_due is required");
  return {
    customer_id: id(body.customer_id, "customer_id"),
    contract_id: body.contract_id ? id(body.contract_id, "contract_id") : null,
    title: text(body.title, "title", { required: true, max: 200 }),
    description: text(body.description, "description", { max: 4000 }),
    checklist: text(body.checklist, "checklist", { max: 8000 }),
    frequency: choice(body.frequency, "frequency", FREQUENCIES, "monthly"),
    interval_count: wholeNumber(body.interval_count, "interval_count", { min: 1, max: 52 }) ?? 1,
    next_due: nextDue,
    lead_days: wholeNumber(body.lead_days, "lead_days", { min: 0, max: 60 }) ?? 3,
    technician: text(body.technician, "technician", { max: 200 }),
    active: body.active === undefined ? true : flag(body.active),
  };
}

export function periodInput(value) {
  if (typeof value !== "string" || !/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) throw new ValidationError("period must look like 2026-10");
  return value;
}

/** First and last day of a "YYYY-MM" period. */
export function periodRange(period) {
  const [year, month] = period.split("-").map(Number);
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { from: `${period}-01`, to: `${period}-${String(last).padStart(2, "0")}` };
}

/** The next due date after `from` for a plan's frequency. Months clamp to the month's last day. */
export function advanceDate(from, frequency, count = 1) {
  const [year, month, day] = from.split("-").map(Number);
  if (frequency === "weekly") {
    const next = new Date(Date.UTC(year, month - 1, day + 7 * count));
    return next.toISOString().slice(0, 10);
  }
  const months = { monthly: 1, quarterly: 3, yearly: 12 }[frequency] * count;
  const target = new Date(Date.UTC(year, month - 1 + months, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, last));
  return target.toISOString().slice(0, 10);
}

/** Splits a month's hours into the part covered by the contract and the overage. */
export function usageSplit(minutesUsed, hoursIncluded) {
  const usedHours = round2(minutesUsed / 60);
  const included = Number(hoursIncluded) || 0;
  return { usedHours, includedHours: included, overageHours: round2(Math.max(0, usedHours - included)), percent: included > 0 ? Math.round((usedHours / included) * 100) : null };
}

/** Keeps the customer's retainer badge, plan, fee and renewal in step with their active contracts. */
export async function syncCustomerRetainer(db, customerId) {
  await db.query(`UPDATE customers c SET
      is_retainer = s.count > 0,
      retainer_plan = CASE WHEN s.count > 0 THEN s.names ELSE NULL END,
      retainer_monthly_fee = CASE WHEN s.count > 0 THEN s.fee ELSE NULL END,
      retainer_renewal_date = CASE WHEN s.count > 0 THEN s.renewal ELSE NULL END,
      updated_at = now()
    FROM (SELECT COUNT(*) count, string_agg(name, ', ' ORDER BY id) names, SUM(monthly_fee)::float8 fee, MIN(renewal_date) renewal
      FROM contracts WHERE customer_id = $1 AND active) s
    WHERE c.id = $1`, [customerId]);
}

/** The response deadline for a new repair of this customer, from their strictest active contract. */
export async function slaHours(db, customerId) {
  const result = await db.query("SELECT MIN(response_hours) hours FROM contracts WHERE customer_id=$1 AND active AND response_hours IS NOT NULL", [customerId]);
  return result.rows[0]?.hours ?? null;
}

const contractSelect = `SELECT k.*, c.name customer_name,
    COALESCE((SELECT SUM(t.minutes) FROM time_entries t WHERE t.customer_id = k.customer_id
      AND t.work_date >= date_trunc('month', CURRENT_DATE) AND t.work_date < date_trunc('month', CURRENT_DATE) + interval '1 month'), 0)::integer minutes_this_month
  FROM contracts k JOIN customers c ON c.id = k.customer_id`;

const planSelect = `SELECT m.*, c.name customer_name, k.name contract_name, r.repair_number last_repair_number
  FROM maintenance_plans m JOIN customers c ON c.id = m.customer_id
  LEFT JOIN contracts k ON k.id = m.contract_id LEFT JOIN repairs r ON r.id = m.last_repair_id`;

async function firstStatusId(db) {
  return (await db.query("SELECT id FROM repair_statuses WHERE active ORDER BY sort_order LIMIT 1")).rows[0].id;
}

/** Creates the maintenance repair ticket for a plan and moves the plan to its next date. */
export async function createMaintenanceRepair(client, plan, request) {
  const statusId = await firstStatusId(client);
  const temporary = `TMP-${crypto.randomUUID()}`;
  const hours = await slaHours(client, plan.customer_id);
  const created = await client.query(`INSERT INTO repairs (repair_number, customer_id, status_id, device_type, reported_fault, internal_notes, due_date,
      technician, priority, maintenance_plan_id, sla_due_at)
    VALUES ($1,$2,$3,'Maintenance',$4,$5,$6,$7,'normal',$8, CASE WHEN $9::integer IS NULL THEN NULL ELSE now() + make_interval(hours => $9::integer) END)
    RETURNING id, EXTRACT(YEAR FROM opened_at)::integer opened_year`,
  [temporary, plan.customer_id, statusId, [plan.title, plan.description].filter(Boolean).join("\n\n"), plan.checklist, plan.next_due, plan.technician, plan.id, hours]);
  const { id: repairId, opened_year: year } = created.rows[0];
  const repairNumber = `${year}-${String(repairId).padStart(6, "0")}`;
  await client.query("UPDATE repairs SET repair_number=$1 WHERE id=$2", [repairNumber, repairId]);
  await client.query("INSERT INTO repair_status_history (repair_id, status_id, note) VALUES ($1,$2,$3)", [repairId, statusId, `Maintenance plan: ${plan.title}`]);
  // Skip past any dates missed while the server was off, so only one ticket is made.
  let next = advanceDate(plan.next_due, plan.frequency, plan.interval_count);
  const today = new Date().toISOString().slice(0, 10);
  while (next <= today) next = advanceDate(next, plan.frequency, plan.interval_count);
  await client.query("UPDATE maintenance_plans SET next_due=$1, last_repair_id=$2, updated_at=now() WHERE id=$3", [next, repairId, plan.id]);
  await audit(client, request, { action: "create", entity: "repair", entityId: repairId, repairId, customerId: plan.customer_id,
    summary: `Repair ${repairNumber} created by maintenance plan "${plan.title}"` });
  return { id: repairId, repair_number: repairNumber, next_due: next };
}

/** Builds the month's contract invoice: the fee, plus hours over the included amount. */
export async function createContractInvoice(client, contract, period, settings, request) {
  const existing = await client.query("SELECT id FROM invoices WHERE contract_id=$1 AND period=$2 AND kind='invoice' AND status <> 'void'", [contract.id, period]);
  if (existing.rowCount) throw Object.assign(new Error("This month already has an invoice for this contract"), { statusCode: 409, invoiceId: existing.rows[0].id });
  const { from, to } = periodRange(period);
  const entries = (await client.query(`SELECT id, minutes FROM time_entries WHERE customer_id=$1 AND invoice_id IS NULL AND billable
    AND work_date BETWEEN $2 AND $3 ORDER BY work_date, id`, [contract.customer_id, from, to])).rows;
  const usage = usageSplit(entries.reduce((sum, entry) => sum + entry.minutes, 0), contract.hours_included);
  const number = await nextNumber(client, "invoice", settings.invoicePrefix);
  const created = await client.query(`INSERT INTO invoices (kind, number, customer_id, due_date, notes, tax_rate, created_by, contract_id, period, issue_date)
    VALUES ('invoice',$1,$2, CURRENT_DATE + $3::integer, $4, $5, $6, $7, $8, CURRENT_DATE) RETURNING id`,
  [number, contract.customer_id, Math.max(0, Math.round(settings.paymentTermsDays)), settings.notes, settings.taxRate, request?.user?.id ?? null, contract.id, period]);
  const invoiceId = created.rows[0].id;
  const lines = [{
    position: 0, kind: "service", quantity: 1, unit_price: Number(contract.monthly_fee), taxable: true, repair_part_id: null,
    description: `${contract.name} — ${period}${usage.includedHours ? ` (${usage.includedHours} h included, ${usage.usedHours} h used)` : ""}`,
    // The month's time is settled by this invoice, so none of it shows as unbilled any more.
    time_entry_ids: entries.map((entry) => entry.id),
  }];
  if (usage.overageHours > 0 && usage.includedHours > 0) {
    lines.push({ position: 1, kind: "labor", description: `Hours above the contract — ${period}`, quantity: usage.overageHours,
      unit_price: contract.overage_rate ?? settings.hourlyRate, taxable: true, repair_part_id: null, time_entry_ids: [] });
  }
  await writeLines(client, invoiceId, { lines, tax_rate: settings.taxRate, discount: 0 }, contract.customer_id);
  await audit(client, request, { action: "create", entity: "invoice", entityId: invoiceId, customerId: contract.customer_id,
    summary: `Invoice ${number} created for contract "${contract.name}" (${period})` });
  return invoiceId;
}

export function registerContractRoutes(app, pool, { requireAdmin, readSettings }) {
  // ---------- Contracts ----------
  app.get("/api/contracts", async (request) => {
    const q = request.query ?? {};
    const filters = [];
    const params = [];
    if (q.customerId) { params.push(pathId(q.customerId, "customerId")); filters.push(`k.customer_id = $${params.length}`); }
    if (q.active === "1") filters.push("k.active");
    return (await pool.query(`${contractSelect} ${filters.length ? `WHERE ${filters.join(" AND ")}` : ""} ORDER BY c.name, k.name`, params)).rows;
  });

  app.post("/api/contracts", async (request, reply) => {
    requireAdmin(request);
    const input = contractInput(request.body);
    const contractId = await transaction(pool, async (client) => {
      const created = await client.query(`INSERT INTO contracts (customer_id, name, monthly_fee, hours_included, overage_rate, response_hours, start_date,
          renewal_date, billing_day, auto_invoice, active, notes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
      [input.customer_id, input.name, input.monthly_fee, input.hours_included, input.overage_rate, input.response_hours, input.start_date,
        input.renewal_date, input.billing_day, input.auto_invoice, input.active, input.notes]);
      await syncCustomerRetainer(client, input.customer_id);
      await audit(client, request, { action: "create", entity: "contract", entityId: created.rows[0].id, customerId: input.customer_id, summary: `Contract "${input.name}" created` });
      return created.rows[0].id;
    });
    return reply.code(201).send((await pool.query(`${contractSelect} WHERE k.id=$1`, [contractId])).rows[0]);
  });

  app.put("/api/contracts/:id", async (request) => {
    requireAdmin(request);
    const contractId = pathId(request.params.id);
    const input = contractInput(request.body);
    await transaction(pool, async (client) => {
      const before = (await client.query("SELECT * FROM contracts WHERE id=$1 FOR UPDATE", [contractId])).rows[0];
      if (!before) throw notFound();
      await client.query(`UPDATE contracts SET customer_id=$1, name=$2, monthly_fee=$3, hours_included=$4, overage_rate=$5, response_hours=$6, start_date=$7,
          renewal_date=$8, billing_day=$9, auto_invoice=$10, active=$11, notes=$12, updated_at=now() WHERE id=$13`,
      [input.customer_id, input.name, input.monthly_fee, input.hours_included, input.overage_rate, input.response_hours, input.start_date,
        input.renewal_date, input.billing_day, input.auto_invoice, input.active, input.notes, contractId]);
      await syncCustomerRetainer(client, input.customer_id);
      if (before.customer_id !== input.customer_id) await syncCustomerRetainer(client, before.customer_id);
      await audit(client, request, { action: "update", entity: "contract", entityId: contractId, customerId: input.customer_id, summary: `Contract "${input.name}" updated`,
        changes: diff(before, input, ["name", "monthly_fee", "hours_included", "overage_rate", "response_hours", "renewal_date", "billing_day", "auto_invoice", "active"]) });
    });
    return (await pool.query(`${contractSelect} WHERE k.id=$1`, [contractId])).rows[0];
  });

  app.delete("/api/contracts/:id", async (request, reply) => {
    requireAdmin(request);
    const contractId = pathId(request.params.id);
    await transaction(pool, async (client) => {
      const contract = (await client.query("DELETE FROM contracts WHERE id=$1 RETURNING *", [contractId])).rows[0];
      if (!contract) throw notFound();
      await syncCustomerRetainer(client, contract.customer_id);
      await audit(client, request, { action: "delete", entity: "contract", entityId: contractId, customerId: contract.customer_id, summary: `Contract "${contract.name}" deleted` });
    });
    return reply.code(204).send();
  });

  // Hours used in one month, and whether that month was invoiced.
  app.get("/api/contracts/:id/usage", async (request) => {
    const contractId = pathId(request.params.id);
    const period = request.query?.period ? periodInput(request.query.period) : new Date().toISOString().slice(0, 7);
    const contract = (await pool.query("SELECT * FROM contracts WHERE id=$1", [contractId])).rows[0];
    if (!contract) throw notFound();
    const { from, to } = periodRange(period);
    const [entries, invoice] = await Promise.all([
      pool.query(`SELECT t.id, t.work_date, t.minutes, t.description, t.billable, t.invoice_id, COALESCE(t.technician, u.display_name) technician, r.repair_number
        FROM time_entries t LEFT JOIN users u ON u.id = t.user_id LEFT JOIN repairs r ON r.id = t.repair_id
        WHERE t.customer_id=$1 AND t.work_date BETWEEN $2 AND $3 ORDER BY t.work_date, t.id`, [contract.customer_id, from, to]),
      pool.query(`${invoiceSelect} WHERE i.contract_id=$1 AND i.period=$2 AND i.kind='invoice' AND i.status <> 'void'`, [contractId, period]),
    ]);
    const minutes = entries.rows.filter((entry) => entry.billable).reduce((sum, entry) => sum + entry.minutes, 0);
    return { period, ...usageSplit(minutes, contract.hours_included), entries: entries.rows, invoice: invoice.rows[0] ?? null };
  });

  app.post("/api/contracts/:id/invoice", async (request, reply) => {
    requireAdmin(request);
    const contractId = pathId(request.params.id);
    const period = periodInput(request.body?.period);
    const settings = await loadBillingSettings(readSettings);
    const invoiceId = await transaction(pool, async (client) => {
      const contract = (await client.query("SELECT * FROM contracts WHERE id=$1 FOR UPDATE", [contractId])).rows[0];
      if (!contract) throw notFound();
      return createContractInvoice(client, contract, period, settings, request);
    });
    return reply.code(201).send({ id: invoiceId });
  });

  // ---------- Maintenance plans ----------
  app.get("/api/maintenance", async (request) => {
    const q = request.query ?? {};
    const params = [];
    const filters = [];
    if (q.customerId) { params.push(pathId(q.customerId, "customerId")); filters.push(`m.customer_id = $${params.length}`); }
    if (q.active === "1") filters.push("m.active");
    return (await pool.query(`${planSelect} ${filters.length ? `WHERE ${filters.join(" AND ")}` : ""} ORDER BY m.next_due, m.id`, params)).rows;
  });

  const planValues = (p) => [p.customer_id, p.contract_id, p.title, p.description, p.checklist, p.frequency, p.interval_count, p.next_due, p.lead_days, p.technician, p.active];

  app.post("/api/maintenance", async (request, reply) => {
    const input = planInput(request.body);
    const created = await pool.query(`INSERT INTO maintenance_plans (customer_id, contract_id, title, description, checklist, frequency, interval_count, next_due,
        lead_days, technician, active) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`, planValues(input));
    await audit(pool, request, { action: "create", entity: "maintenance", entityId: created.rows[0].id, customerId: input.customer_id, summary: `Maintenance plan "${input.title}" created` });
    return reply.code(201).send((await pool.query(`${planSelect} WHERE m.id=$1`, [created.rows[0].id])).rows[0]);
  });

  app.put("/api/maintenance/:id", async (request) => {
    const planId = pathId(request.params.id);
    const input = planInput(request.body);
    const before = (await pool.query("SELECT * FROM maintenance_plans WHERE id=$1", [planId])).rows[0];
    if (!before) throw notFound();
    await pool.query(`UPDATE maintenance_plans SET customer_id=$1, contract_id=$2, title=$3, description=$4, checklist=$5, frequency=$6, interval_count=$7,
        next_due=$8, lead_days=$9, technician=$10, active=$11, updated_at=now() WHERE id=$12`, [...planValues(input), planId]);
    await audit(pool, request, { action: "update", entity: "maintenance", entityId: planId, customerId: input.customer_id, summary: `Maintenance plan "${input.title}" updated`,
      changes: diff(before, input, ["title", "frequency", "interval_count", "next_due", "lead_days", "technician", "active"]) });
    return (await pool.query(`${planSelect} WHERE m.id=$1`, [planId])).rows[0];
  });

  app.delete("/api/maintenance/:id", async (request, reply) => {
    const planId = pathId(request.params.id);
    const plan = (await pool.query("DELETE FROM maintenance_plans WHERE id=$1 RETURNING customer_id, title", [planId])).rows[0];
    if (!plan) throw notFound();
    await audit(pool, request, { action: "delete", entity: "maintenance", entityId: planId, customerId: plan.customer_id, summary: `Maintenance plan "${plan.title}" deleted` });
    return reply.code(204).send();
  });

  // Creates this plan's ticket now instead of waiting for the schedule.
  app.post("/api/maintenance/:id/run", async (request, reply) => {
    const planId = pathId(request.params.id);
    const result = await transaction(pool, async (client) => {
      const plan = (await client.query("SELECT * FROM maintenance_plans WHERE id=$1 FOR UPDATE", [planId])).rows[0];
      if (!plan) throw notFound();
      return createMaintenanceRepair(client, plan, request);
    });
    return reply.code(201).send(result);
  });

  // ---------- Response times ----------
  // Open repairs with a response deadline that nobody has answered yet.
  app.get("/api/sla", async () =>
    (await pool.query(`SELECT r.id, r.repair_number, r.sla_due_at, r.opened_at, c.name customer_name, r.device_type, r.brand, r.model,
        EXTRACT(EPOCH FROM (r.sla_due_at - now()))::integer seconds_left
      FROM repairs r JOIN customers c ON c.id = r.customer_id JOIN repair_statuses s ON s.id = r.status_id
      WHERE r.sla_due_at IS NOT NULL AND r.first_response_at IS NULL AND s.code NOT IN ('DELIVERED','CANCELLED')
      ORDER BY r.sla_due_at LIMIT 50`)).rows);
}

/**
 * Hourly job: creates due maintenance tickets and, on each contract's billing
 * day, a draft invoice for the month that just ended. A database lock makes
 * sure only one API process does this at a time.
 */
export async function runScheduledJobs(pool, readSettings, log) {
  const system = { user: null };
  const client = await pool.connect();
  try {
    const locked = await client.query("SELECT pg_try_advisory_lock(87234030) locked");
    if (!locked.rows[0].locked) return;
    try {
      const plans = (await client.query(`SELECT * FROM maintenance_plans WHERE active AND next_due - lead_days <= CURRENT_DATE ORDER BY next_due LIMIT 200`)).rows;
      for (const plan of plans) {
        try {
          await client.query("BEGIN");
          const repair = await createMaintenanceRepair(client, plan, system);
          await client.query("COMMIT");
          log.info({ plan: plan.id, repair: repair.repair_number }, "Maintenance ticket created");
        } catch (error) {
          await client.query("ROLLBACK");
          log.warn({ err: error, plan: plan.id }, "Could not create a maintenance ticket");
        }
      }
      const contracts = (await client.query(`SELECT * FROM contracts WHERE active AND auto_invoice AND billing_day <= EXTRACT(DAY FROM CURRENT_DATE)
        AND start_date < date_trunc('month', CURRENT_DATE)`)).rows;
      if (contracts.length) {
        const settings = await loadBillingSettings(readSettings);
        const previous = new Date();
        previous.setDate(1);
        previous.setMonth(previous.getMonth() - 1);
        const period = `${previous.getFullYear()}-${String(previous.getMonth() + 1).padStart(2, "0")}`;
        for (const contract of contracts) {
          const done = await client.query("SELECT 1 FROM invoices WHERE contract_id=$1 AND period=$2 AND kind='invoice'", [contract.id, period]);
          if (done.rowCount) continue;
          try {
            await client.query("BEGIN");
            await createContractInvoice(client, contract, period, settings, system);
            await client.query("COMMIT");
            log.info({ contract: contract.id, period }, "Contract invoice created");
          } catch (error) {
            await client.query("ROLLBACK");
            log.warn({ err: error, contract: contract.id }, "Could not create a contract invoice");
          }
        }
      }
    } finally {
      await client.query("SELECT pg_advisory_unlock(87234030)");
    }
  } catch (error) {
    log.warn({ err: error }, "Scheduled jobs failed");
  } finally {
    client.release();
  }
}

export function startScheduler(pool, readSettings, log) {
  const run = () => runScheduledJobs(pool, readSettings, log);
  const first = setTimeout(run, 30_000);
  const timer = setInterval(run, 60 * 60 * 1000);
  first.unref?.();
  timer.unref?.();
  return () => { clearTimeout(first); clearInterval(timer); };
}
