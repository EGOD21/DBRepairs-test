import { api } from "./api";

export type DocKind = "invoice" | "estimate";
export type LineKind = "labor" | "part" | "service" | "fee" | "other";
export type PaymentMethod = "cash" | "card" | "transfer" | "check" | "online" | "other";
/** Invoices: draft, unpaid, partial, overdue, paid, void. Estimates: draft, sent, approved, declined, converted, expired. */
export type DocState = "draft" | "sent" | "unpaid" | "partial" | "overdue" | "paid" | "void" | "approved" | "declined" | "converted" | "expired";

export const lineKinds: LineKind[] = ["labor", "part", "service", "fee", "other"];
export const paymentMethods: PaymentMethod[] = ["cash", "card", "transfer", "check", "online", "other"];

export type InvoiceLine = {
  id?: number; kind: LineKind; description: string; quantity: number; unit_price: number; taxable: boolean; amount?: number;
  repair_part_id?: number | null; time_entry_ids: number[];
};

export type Payment = {
  id: number; invoice_id: number; amount: number; method: PaymentMethod; paid_at: string; reference: string | null; note: string | null;
  created_by_name: string | null; invoice_number?: string; customer_name?: string; customer_id?: number;
};

export type TimeEntry = {
  id: number; customer_id: number; customer_name: string; repair_id: number | null; repair_number: string | null; user_id: number | null;
  technician: string | null; work_date: string; minutes: number; hours: number; description: string | null; billable: boolean;
  hourly_rate: number | null; invoice_id: number | null; invoice_number: string | null;
};

export type Invoice = {
  id: number; kind: DocKind; number: string; status: string; state: DocState; customer_id: number; repair_id: number | null; repair_number: string | null;
  customer_name: string; customer_company: string | null; customer_email: string | null; customer_phone: string | null; customer_mobile: string | null;
  customer_address: string | null; customer_tax_number: string | null; customer_contact: string | null; customer_type: string;
  issue_date: string; due_date: string | null; notes: string | null; terms: string | null; tax_rate: number; discount: number;
  subtotal: number; tax_amount: number; total: number; paid_amount: number; balance: number; sent_at: string | null;
  approved_at: string | null; approved_name: string | null; converted_to: number | null; created_at: string; updated_at: string;
};

export type InvoiceDetail = Invoice & {
  lines: InvoiceLine[]; payments: Payment[]; time_entries: TimeEntry[];
  signature: { id: number; signer_name: string; image: string; signed_at: string } | null;
};

export type InvoiceInput = Pick<Invoice, "customer_id" | "repair_id" | "issue_date" | "due_date" | "notes" | "terms" | "tax_rate" | "discount"> & { lines: InvoiceLine[] };

export type RunningTimer = {
  user_id: number; user_name: string; customer_id: number; customer_name: string; repair_id: number | null; repair_number: string | null;
  description: string | null; started_at: string; elapsed_seconds: number;
};

export type CustomerBilling = { invoices: Invoice[]; balance: number; overdue: number; unbilledMinutes: number };

export type TimeInput = {
  repair_id?: number | null; customer_id?: number | null; work_date: string; minutes: number; description: string; billable: boolean;
  hourly_rate?: number | null; user_id?: number | null;
};

const query = (params: Record<string, string | number | undefined | null>) => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== null && value !== "") search.set(key, String(value));
  const text = search.toString();
  return text ? `?${text}` : "";
};

export const listInvoices = (filters: { kind?: DocKind; state?: string; customerId?: number; repairId?: number; search?: string } = {}) =>
  api<Invoice[]>(`/invoices${query(filters)}`);
export const getInvoice = (id: number) => api<InvoiceDetail>(`/invoices/${id}`);
export const createInvoice = (kind: DocKind, customerId: number, repairId?: number | null, prefill = true) =>
  api<InvoiceDetail>("/invoices", { method: "POST", body: JSON.stringify({ kind, customer_id: customerId, repair_id: repairId ?? null, prefill }) });
export const updateInvoice = (id: number, input: InvoiceInput) => api<InvoiceDetail>(`/invoices/${id}`, { method: "PUT", body: JSON.stringify(input) });
export const setInvoiceStatus = (id: number, status: string) => api<InvoiceDetail>(`/invoices/${id}/status`, { method: "POST", body: JSON.stringify({ status }) });
export const approveEstimate = (id: number, name: string, signature: string) =>
  api<InvoiceDetail>(`/invoices/${id}/approve`, { method: "POST", body: JSON.stringify({ name, signature }) });
export const convertEstimate = (id: number) => api<InvoiceDetail>(`/invoices/${id}/convert`, { method: "POST", body: "{}" });
export const deleteInvoice = (id: number) => api<void>(`/invoices/${id}`, { method: "DELETE" });
export const addPayment = (id: number, payment: { amount: number; method: PaymentMethod; paid_at: string; reference: string; note: string }) =>
  api<InvoiceDetail>(`/invoices/${id}/payments`, { method: "POST", body: JSON.stringify(payment) });
export const deletePayment = (id: number) => api<void>(`/payments/${id}`, { method: "DELETE" });
export const listPayments = (from?: string, to?: string) => api<Payment[]>(`/payments${query({ from, to })}`);
export const getCustomerBilling = (customerId: number) => api<CustomerBilling>(`/customers/${customerId}/billing`);

export const listTime = (filters: { repairId?: number; customerId?: number; userId?: number; unbilled?: boolean; from?: string; to?: string } = {}) =>
  api<TimeEntry[]>(`/time${query({ ...filters, unbilled: filters.unbilled ? "1" : undefined })}`);
export const createTime = (input: TimeInput) => api<TimeEntry>("/time", { method: "POST", body: JSON.stringify(input) });
export const updateTime = (id: number, input: TimeInput) => api<TimeEntry>(`/time/${id}`, { method: "PUT", body: JSON.stringify(input) });
export const deleteTime = (id: number) => api<void>(`/time/${id}`, { method: "DELETE" });

export const getTimer = () => api<RunningTimer | null>("/timer");
export const listTimers = () => api<RunningTimer[]>("/timers");
export const startTimer = (target: { repair_id?: number; customer_id?: number }, description = "") =>
  api<RunningTimer>("/timer/start", { method: "POST", body: JSON.stringify({ ...target, description }) });
export const stopTimer = (description?: string) => api<TimeEntry>("/timer/stop", { method: "POST", body: JSON.stringify(description ? { description } : {}) });
export const discardTimer = () => api<void>("/timer", { method: "DELETE" });

/** Tells the app shell the timer changed, so the timer chip updates at once. */
export const timerChangedEvent = "dbrepairs:timer";
export const announceTimer = () => window.dispatchEvent(new Event(timerChangedEvent));

export type ActivityEntry = {
  id: number; at: string; user_id: number | null; user_name: string | null; action: string; entity: string; entity_id: number | null;
  repair_id: number | null; customer_id: number | null; summary: string | null; changes: Record<string, [unknown, unknown]> | null;
};
export const repairActivity = (id: number) => api<ActivityEntry[]>(`/repairs/${id}/activity`);
export const customerActivity = (id: number) => api<ActivityEntry[]>(`/customers/${id}/activity`);
export const auditLog = (filters: { before?: number; entity?: string; search?: string; from?: string; to?: string; userId?: number } = {}) =>
  api<ActivityEntry[]>(`/audit${query(filters)}`);

/** Same rounding and order as the server, for live totals while editing. */
export function computeTotals(lines: InvoiceLine[], taxRate: number, discount: number) {
  const round2 = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
  const amounts = lines.map((line) => round2((Number(line.quantity) || 0) * (Number(line.unit_price) || 0)));
  const subtotal = round2(amounts.reduce((sum, value) => sum + value, 0));
  const taxableBase = lines.reduce((sum, line, index) => sum + (line.taxable ? amounts[index] : 0), 0);
  const cappedDiscount = Math.min(Math.max(0, Number(discount) || 0), Math.max(0, subtotal));
  const taxableAfter = subtotal > 0 ? taxableBase - cappedDiscount * (taxableBase / subtotal) : taxableBase;
  const taxAmount = round2(Math.max(0, taxableAfter) * ((Number(taxRate) || 0) / 100));
  return { amounts, subtotal, discount: round2(cappedDiscount), taxAmount, total: round2(subtotal - cappedDiscount + taxAmount) };
}

/** Fills a payment link template such as https://pay.example.com/?amount={amount}&ref={number}. */
export function paymentLink(template: string, invoice: Pick<Invoice, "balance" | "number">): string | null {
  if (!template) return null;
  const url = template.replace(/\{amount\}/g, encodeURIComponent(invoice.balance.toFixed(2))).replace(/\{number\}/g, encodeURIComponent(invoice.number));
  return /^https?:\/\//i.test(url) ? url : null;
}
