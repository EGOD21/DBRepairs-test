import { invoiceSelect } from "./billing.js";
import { date, ValidationError } from "./validation.js";

function range(query) {
  const today = new Date().toISOString().slice(0, 10);
  const from = date(query?.from, "from") ?? `${new Date().getFullYear()}-01-01`;
  const to = date(query?.to, "to") ?? today;
  if (from > to) throw new ValidationError("from must be before to");
  return { from, to };
}

// Spreadsheet apps run cells starting with these characters as formulas.
export function csvCell(value) {
  if (value === null || value === undefined) return "";
  let text = typeof value === "number" ? String(value) : String(value);
  if (typeof value === "string" && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(header, rows) {
  return [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

export function registerReportRoutes(app, pool, { requireAdmin }) {
  app.get("/api/reports", async (request) => {
    requireAdmin(request);
    const { from, to } = range(request.query);
    const [revenue, invoiced, aging, hours, turnaround, devices, customers, contracts, sla, statuses] = await Promise.all([
      pool.query(`SELECT to_char(paid_at, 'YYYY-MM') AS month, SUM(amount)::float8 amount, COUNT(*)::integer count
        FROM payments WHERE paid_at BETWEEN $1 AND $2 GROUP BY 1 ORDER BY 1`, [from, to]),
      pool.query(`SELECT to_char(issue_date, 'YYYY-MM') AS month, SUM(total)::float8 amount, COUNT(*)::integer count
        FROM invoices WHERE kind='invoice' AND status NOT IN ('void','draft') AND issue_date BETWEEN $1 AND $2 GROUP BY 1 ORDER BY 1`, [from, to]),
      // What is owed right now, by how late it is.
      pool.query(`SELECT
          COALESCE(SUM(balance) FILTER (WHERE due_date IS NULL OR due_date >= CURRENT_DATE), 0)::float8 current,
          COALESCE(SUM(balance) FILTER (WHERE CURRENT_DATE - due_date BETWEEN 1 AND 30), 0)::float8 d30,
          COALESCE(SUM(balance) FILTER (WHERE CURRENT_DATE - due_date BETWEEN 31 AND 60), 0)::float8 d60,
          COALESCE(SUM(balance) FILTER (WHERE CURRENT_DATE - due_date BETWEEN 61 AND 90), 0)::float8 d90,
          COALESCE(SUM(balance) FILTER (WHERE CURRENT_DATE - due_date > 90), 0)::float8 older
        FROM (${invoiceSelect} WHERE i.kind='invoice') x WHERE state IN ('unpaid','partial','overdue')`),
      pool.query(`SELECT COALESCE(t.technician, u.display_name, '?') technician,
          SUM(t.minutes) FILTER (WHERE t.billable)::integer billable_minutes, SUM(t.minutes) FILTER (WHERE NOT t.billable)::integer other_minutes,
          SUM(t.minutes)::integer minutes
        FROM time_entries t LEFT JOIN users u ON u.id = t.user_id WHERE t.work_date BETWEEN $1 AND $2 GROUP BY 1 ORDER BY minutes DESC`, [from, to]),
      pool.query(`SELECT to_char(closed_at, 'YYYY-MM') AS month, COUNT(*)::integer count,
          ROUND(AVG(EXTRACT(EPOCH FROM (closed_at - opened_at)) / 86400)::numeric, 1)::float8 avg_days,
          ROUND((percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (closed_at - opened_at)) / 86400))::numeric, 1)::float8 median_days
        FROM repairs WHERE closed_at IS NOT NULL AND closed_at::date BETWEEN $1 AND $2 GROUP BY 1 ORDER BY 1`, [from, to]),
      pool.query(`SELECT COALESCE(NULLIF(trim(device_type), ''), '—') device_type, COUNT(*)::integer count
        FROM repairs WHERE opened_at::date BETWEEN $1 AND $2 GROUP BY 1 ORDER BY count DESC LIMIT 12`, [from, to]),
      pool.query(`SELECT c.id, c.name, SUM(p.amount)::float8 amount FROM payments p JOIN invoices i ON i.id = p.invoice_id JOIN customers c ON c.id = i.customer_id
        WHERE p.paid_at BETWEEN $1 AND $2 GROUP BY c.id, c.name ORDER BY amount DESC LIMIT 10`, [from, to]),
      // For each contract: fees invoiced in the range against the hours spent on that customer.
      pool.query(`SELECT k.id, k.name, c.name customer_name, k.monthly_fee::float8 monthly_fee, k.hours_included::float8 hours_included,
          COALESCE((SELECT SUM(i.total) FROM invoices i WHERE i.contract_id = k.id AND i.kind='invoice' AND i.status <> 'void' AND i.issue_date BETWEEN $1 AND $2), 0)::float8 invoiced,
          COALESCE((SELECT SUM(t.minutes) FROM time_entries t WHERE t.customer_id = k.customer_id AND t.work_date BETWEEN $1 AND $2), 0)::integer minutes
        FROM contracts k JOIN customers c ON c.id = k.customer_id WHERE k.active OR k.updated_at::date >= $1 ORDER BY c.name, k.name`, [from, to]),
      pool.query(`SELECT COUNT(*)::integer total,
          COUNT(*) FILTER (WHERE first_response_at IS NOT NULL AND first_response_at <= sla_due_at)::integer met,
          COUNT(*) FILTER (WHERE (first_response_at IS NOT NULL AND first_response_at > sla_due_at) OR (first_response_at IS NULL AND sla_due_at < now()))::integer missed
        FROM repairs WHERE sla_due_at IS NOT NULL AND opened_at::date BETWEEN $1 AND $2`, [from, to]),
      pool.query(`SELECT s.code, s.label_key, COUNT(r.id)::integer count FROM repair_statuses s
        LEFT JOIN repairs r ON r.status_id = s.id AND r.opened_at::date BETWEEN $1 AND $2 GROUP BY s.code, s.label_key, s.sort_order ORDER BY s.sort_order`, [from, to]),
    ]);
    return {
      from, to,
      revenue: revenue.rows, invoiced: invoiced.rows, aging: aging.rows[0], hours: hours.rows, turnaround: turnaround.rows,
      devices: devices.rows, customers: customers.rows, contracts: contracts.rows, sla: sla.rows[0], statuses: statuses.rows,
    };
  });

  // ---------- Accounting export ----------
  // QuickBooks Online and Xero both import invoices from CSV with one row per line item.
  app.get("/api/export/:kind", async (request, reply) => {
    requireAdmin(request);
    const { from, to } = range(request.query);
    const format = ["quickbooks", "xero", "plain"].includes(request.query?.format) ? request.query.format : "plain";
    const kind = request.params.kind;
    let csv;
    if (kind === "invoices.csv") {
      const rows = (await pool.query(`SELECT i.number, i.issue_date, i.due_date, i.status, i.tax_rate::float8 tax_rate, i.discount::float8 discount,
          i.total::float8 total, c.name customer, c.email, l.description, l.kind, l.quantity::float8 quantity, l.unit_price::float8 unit_price,
          l.amount::float8 amount, l.taxable, l.position
        FROM invoices i JOIN customers c ON c.id = i.customer_id JOIN invoice_lines l ON l.invoice_id = i.id
        WHERE i.kind='invoice' AND i.status NOT IN ('void','draft') AND i.issue_date BETWEEN $1 AND $2 ORDER BY i.issue_date, i.number, l.position`, [from, to])).rows;
      if (format === "quickbooks") {
        csv = toCsv(["InvoiceNo", "Customer", "InvoiceDate", "DueDate", "Item(Product/Service)", "ItemDescription", "ItemQuantity", "ItemRate", "ItemAmount", "Taxable", "TaxRate"],
          rows.map((r) => [r.number, r.customer, r.issue_date, r.due_date, r.kind, r.description, r.quantity, r.unit_price, r.amount, r.taxable ? "Y" : "N", r.tax_rate]));
      } else if (format === "xero") {
        csv = toCsv(["*ContactName", "EmailAddress", "*InvoiceNumber", "*InvoiceDate", "*DueDate", "*Description", "*Quantity", "*UnitAmount", "Discount", "*AccountCode", "*TaxType"],
          rows.map((r) => [r.customer, r.email, r.number, r.issue_date, r.due_date ?? r.issue_date, r.description, r.quantity, r.unit_price, "", "200", r.taxable ? "Tax on Sales" : "Tax Exempt"]));
      } else {
        csv = toCsv(["invoice", "customer", "issue_date", "due_date", "status", "line_type", "description", "quantity", "unit_price", "amount", "taxable", "tax_rate", "invoice_discount", "invoice_total"],
          rows.map((r) => [r.number, r.customer, r.issue_date, r.due_date, r.status, r.kind, r.description, r.quantity, r.unit_price, r.amount, r.taxable, r.tax_rate, r.discount, r.total]));
      }
    } else if (kind === "payments.csv") {
      const rows = (await pool.query(`SELECT p.paid_at, i.number, c.name customer, p.amount::float8 amount, p.method, p.reference, p.note
        FROM payments p JOIN invoices i ON i.id = p.invoice_id JOIN customers c ON c.id = i.customer_id
        WHERE p.paid_at BETWEEN $1 AND $2 ORDER BY p.paid_at, p.id`, [from, to])).rows;
      csv = format === "quickbooks"
        ? toCsv(["PaymentDate", "Customer", "InvoiceNo", "Amount", "PaymentMethod", "ReferenceNo", "Memo"], rows.map((r) => [r.paid_at, r.customer, r.number, r.amount, r.method, r.reference, r.note]))
        : toCsv(["date", "invoice", "customer", "amount", "method", "reference", "note"], rows.map((r) => [r.paid_at, r.number, r.customer, r.amount, r.method, r.reference, r.note]));
    } else if (kind === "time.csv") {
      const rows = (await pool.query(`SELECT t.work_date, COALESCE(t.technician, u.display_name) technician, c.name customer, r.repair_number, t.minutes,
          t.billable, t.hourly_rate::float8 rate, t.description, i.number invoice
        FROM time_entries t JOIN customers c ON c.id = t.customer_id LEFT JOIN repairs r ON r.id = t.repair_id LEFT JOIN users u ON u.id = t.user_id
        LEFT JOIN invoices i ON i.id = t.invoice_id WHERE t.work_date BETWEEN $1 AND $2 ORDER BY t.work_date, t.id`, [from, to])).rows;
      csv = toCsv(["date", "technician", "customer", "repair", "hours", "billable", "rate", "description", "invoice"],
        rows.map((r) => [r.work_date, r.technician, r.customer, r.repair_number, Math.round((r.minutes / 60) * 100) / 100, r.billable, r.rate, r.description, r.invoice]));
    } else {
      return reply.code(404).send({ error: "Not found" });
    }
    const name = `DBRepairs-${kind.replace(".csv", "")}-${from}-to-${to}${format === "plain" ? "" : `-${format}`}.csv`;
    return reply.header("Content-Type", "text/csv; charset=utf-8").header("Content-Disposition", `attachment; filename="${name}"`).send(`﻿${csv}`);
  });
}
