import { getDatabase } from "./database";
import { api } from "./api";
import { isServerMode } from "./runtime";

export type CustomerType = "residential" | "commercial";
export type ContactMethod = "email" | "phone" | "sms";

export type Customer = {
  id: number;
  name: string;
  company: string | null;
  tax_number: string | null;
  phone: string | null;
  mobile: string | null;
  email: string | null;
  address: string | null;
  notes: string | null;
  customer_type: CustomerType;
  contact_person: string | null;
  preferred_contact: ContactMethod | null;
  tags: string | null;
  is_retainer: boolean;
  retainer_plan: string | null;
  retainer_monthly_fee: number | null;
  retainer_renewal_date: string | null;
  created_at: string;
  updated_at: string;
  repair_count: number;
  open_repairs: number;
  total_billed: number;
  last_repair_at: string | null;
};

export type CustomerInput = {
  name: string;
  company: string;
  taxNumber: string;
  phone: string;
  mobile: string;
  email: string;
  address: string;
  notes: string;
  customerType: CustomerType;
  contactPerson: string;
  preferredContact: ContactMethod | "";
  tags: string;
  isRetainer: boolean;
  retainerPlan: string;
  retainerMonthlyFee: string;
  retainerRenewalDate: string;
};

export const emptyCustomerInput: CustomerInput = {
  name: "", company: "", taxNumber: "", phone: "", mobile: "", email: "", address: "", notes: "",
  customerType: "residential", contactPerson: "", preferredContact: "", tags: "",
  isRetainer: false, retainerPlan: "", retainerMonthlyFee: "", retainerRenewalDate: "",
};

export function toCustomerInput(customer: Customer): CustomerInput {
  return {
    name: customer.name,
    company: customer.company ?? "",
    taxNumber: customer.tax_number ?? "",
    phone: customer.phone ?? "",
    mobile: customer.mobile ?? "",
    email: customer.email ?? "",
    address: customer.address ?? "",
    notes: customer.notes ?? "",
    customerType: customer.customer_type,
    contactPerson: customer.contact_person ?? "",
    preferredContact: customer.preferred_contact ?? "",
    tags: customer.tags ?? "",
    isRetainer: customer.is_retainer,
    retainerPlan: customer.retainer_plan ?? "",
    retainerMonthlyFee: customer.retainer_monthly_fee?.toString() ?? "",
    retainerRenewalDate: customer.retainer_renewal_date ?? "",
  };
}

function clean(value: string) {
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

// SQLite returns 0/1 for booleans and may return the total as a string.
function normalize(row: Customer): Customer {
  return {
    ...row,
    customer_type: row.customer_type === "commercial" ? "commercial" : "residential",
    is_retainer: Boolean(row.is_retainer),
    repair_count: Number(row.repair_count ?? 0),
    open_repairs: Number(row.open_repairs ?? 0),
    total_billed: Number(row.total_billed ?? 0),
  };
}

const desktopSelect = `SELECT c.*,
    COALESCE(st.repair_count, 0) repair_count, COALESCE(st.open_repairs, 0) open_repairs,
    COALESCE(st.total_billed, 0) total_billed, st.last_repair_at
  FROM customers c
  LEFT JOIN (
    SELECT r.customer_id, COUNT(*) repair_count,
      SUM(CASE WHEN s.code NOT IN ('DELIVERED','CANCELLED') THEN 1 ELSE 0 END) open_repairs,
      SUM(COALESCE(r.final_value, 0)) total_billed, MAX(r.opened_at) last_repair_at
    FROM repairs r JOIN repair_statuses s ON s.id = r.status_id GROUP BY r.customer_id
  ) st ON st.customer_id = c.id`;

export async function listCustomers(search = ""): Promise<Customer[]> {
  if (isServerMode) return (await api<Customer[]>(`/customers?search=${encodeURIComponent(search)}`)).map(normalize);
  const db = await getDatabase();
  const term = `%${search.trim()}%`;
  const rows = await db.select<Customer[]>(
    `${desktopSelect}
     WHERE (?1 = '%%')
        OR c.name LIKE ?1 COLLATE NOCASE
        OR COALESCE(c.company, '') LIKE ?1 COLLATE NOCASE
        OR COALESCE(c.contact_person, '') LIKE ?1 COLLATE NOCASE
        OR COALESCE(c.tax_number, '') LIKE ?1 COLLATE NOCASE
        OR COALESCE(c.phone, '') LIKE ?1 COLLATE NOCASE
        OR COALESCE(c.mobile, '') LIKE ?1 COLLATE NOCASE
        OR COALESCE(c.email, '') LIKE ?1 COLLATE NOCASE
        OR COALESCE(c.tags, '') LIKE ?1 COLLATE NOCASE
     ORDER BY c.name COLLATE NOCASE, c.id`,
    [term],
  );
  return rows.map(normalize);
}

export async function getCustomer(id: number): Promise<Customer | null> {
  if (isServerMode) {
    try { return normalize(await api<Customer>(`/customers/${id}`)); }
    catch (error) { if (error instanceof Error && error.message === "Not found") return null; throw error; }
  }
  const db = await getDatabase();
  const rows = await db.select<Customer[]>(`${desktopSelect} WHERE c.id = ?1`, [id]);
  return rows[0] ? normalize(rows[0]) : null;
}

function desktopValues(input: CustomerInput) {
  const retainer = input.isRetainer;
  const fee = retainer && input.retainerMonthlyFee.trim() ? Number(input.retainerMonthlyFee) : null;
  return [
    input.name.trim(), clean(input.company), clean(input.taxNumber), clean(input.phone), clean(input.mobile), clean(input.email),
    clean(input.address), clean(input.notes), input.customerType, clean(input.contactPerson), input.preferredContact || null,
    clean(input.tags), retainer ? 1 : 0, retainer ? clean(input.retainerPlan) : null,
    fee !== null && Number.isFinite(fee) && fee >= 0 ? fee : null, retainer ? clean(input.retainerRenewalDate) : null,
  ];
}

const desktopColumns = "name, company, tax_number, phone, mobile, email, address, notes, customer_type, contact_person, preferred_contact, tags, is_retainer, retainer_plan, retainer_monthly_fee, retainer_renewal_date";

export async function createCustomer(input: CustomerInput): Promise<number> {
  if (isServerMode) {
    const result = await api<{ id: number }>("/customers", { method: "POST", body: JSON.stringify(input) });
    return result.id;
  }
  const db = await getDatabase();
  const result = await db.execute(
    `INSERT INTO customers (${desktopColumns}) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16)`,
    desktopValues(input),
  );
  return Number(result.lastInsertId ?? 0);
}

export async function updateCustomer(id: number, input: CustomerInput): Promise<void> {
  if (isServerMode) return api(`/customers/${id}`, { method: "PUT", body: JSON.stringify(input) });
  const db = await getDatabase();
  await db.execute(
    `UPDATE customers SET name = ?1, company = ?2, tax_number = ?3, phone = ?4, mobile = ?5, email = ?6, address = ?7, notes = ?8,
       customer_type = ?9, contact_person = ?10, preferred_contact = ?11, tags = ?12, is_retainer = ?13, retainer_plan = ?14,
       retainer_monthly_fee = ?15, retainer_renewal_date = ?16, updated_at = CURRENT_TIMESTAMP
     WHERE id = ?17`,
    [...desktopValues(input), id],
  );
}

export async function deleteCustomer(id: number): Promise<void> {
  if (isServerMode) return api(`/customers/${id}`, { method: "DELETE" });
  const db = await getDatabase();
  await db.execute("DELETE FROM customers WHERE id = ?1", [id]);
}
