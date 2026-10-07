import { invoke } from "@tauri-apps/api/core";
import { getDatabase } from "./database";
import { api } from "./api";
import { isServerMode } from "./runtime";

export type Priority = "low" | "normal" | "high" | "urgent";
export const priorities: Priority[] = ["low", "normal", "high", "urgent"];

export type RepairStatus = { id: number; code: string; label_key: string; sort_order: number };
export type Repair = {
  id: number; repair_number: string; customer_id: number; customer_name: string; customer_email: string | null; customer_phone: string | null;
  customer_mobile: string | null; customer_company: string | null; status_id: number; status_code: string; status_label_key: string;
  device_type: string | null; brand: string | null; model: string | null; serial_number: string | null; imei: string | null;
  reported_fault: string | null; accessories: string | null; general_condition: string | null; diagnosis: string | null; work_performed: string | null;
  estimated_value: number | null; final_value: number | null; internal_notes: string | null; opened_at: string; closed_at: string | null;
  priority: Priority; due_date: string | null; technician: string | null; deposit: number | null; paid: boolean; warranty_days: number | null;
  parts_pending: number;
  /** Server edition only; always 0 on the desktop app. */
  photo_count: number;
  updated_at?: string;
  sla_due_at?: string | null;
  first_response_at?: string | null;
  maintenance_plan_id?: number | null;
  asset_id?: number | null;
  asset_name?: string | null;
  intake_checklist?: Record<string, boolean> | null;
  data_backup?: "requested" | "declined" | "not_needed" | null;
};

export type RepairInput = {
  customer_id: number; status_id: number; device_type: string; brand: string; model: string; serial_number: string; imei: string;
  reported_fault: string; accessories: string; general_condition: string; estimated_value: string; internal_notes: string;
  priority: Priority; due_date: string; technician: string; deposit: string; paid: boolean; warranty_days: string;
};

export type RepairUpdateInput = RepairInput & {
  diagnosis: string;
  work_performed: string;
  final_value: string;
};

export const blankRepairInput: RepairInput = {
  customer_id: 0, status_id: 0, device_type: "", brand: "", model: "", serial_number: "", imei: "", reported_fault: "", accessories: "",
  general_condition: "", estimated_value: "", internal_notes: "", priority: "normal", due_date: "", technician: "", deposit: "", paid: false, warranty_days: "",
};

export function toUpdateInput(repair: Repair): RepairUpdateInput {
  const text = (value: string | null) => value ?? "";
  const number = (value: number | null) => value?.toString() ?? "";
  return {
    customer_id: repair.customer_id, status_id: repair.status_id, device_type: text(repair.device_type), brand: text(repair.brand),
    model: text(repair.model), serial_number: text(repair.serial_number), imei: text(repair.imei), reported_fault: text(repair.reported_fault),
    accessories: text(repair.accessories), general_condition: text(repair.general_condition), estimated_value: number(repair.estimated_value),
    internal_notes: text(repair.internal_notes), priority: repair.priority, due_date: text(repair.due_date), technician: text(repair.technician),
    deposit: number(repair.deposit), paid: repair.paid, warranty_days: number(repair.warranty_days), diagnosis: text(repair.diagnosis),
    work_performed: text(repair.work_performed), final_value: number(repair.final_value),
  };
}

export type RepairStatusHistory = {
  id: number;
  status_id: number;
  status_code: string;
  status_label_key: string;
  changed_at: string;
  note: string | null;
};

export const closedStatusCodes = ["DELIVERED", "CANCELLED"];
export const isClosed = (repair: Pick<Repair, "status_code">) => closedStatusCodes.includes(repair.status_code);

/** A repair is overdue when it is still open and its promised date has passed. */
export function isOverdue(repair: Pick<Repair, "status_code" | "due_date">, today = new Date()) {
  if (!repair.due_date || isClosed(repair)) return false;
  const local = new Date(today.getTime() - today.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  return repair.due_date < local;
}

// SQLite returns 0/1 for booleans.
function normalize(row: Repair): Repair {
  return { ...row, paid: Boolean(row.paid), priority: row.priority || "normal", parts_pending: Number(row.parts_pending ?? 0), photo_count: Number(row.photo_count ?? 0) };
}

export const desktopRepairSelect = `SELECT r.*, c.name customer_name, c.email customer_email, c.phone customer_phone, c.mobile customer_mobile,
    c.company customer_company, s.code status_code, s.label_key status_label_key,
    (SELECT COUNT(*) FROM repair_parts p WHERE p.repair_id = r.id AND p.status IN ('needed','ordered')) parts_pending
  FROM repairs r JOIN customers c ON c.id=r.customer_id JOIN repair_statuses s ON s.id=r.status_id`;

export async function listStatuses(): Promise<RepairStatus[]> {
  if (isServerMode) return api("/statuses");
  const db = await getDatabase();
  return db.select("SELECT id, code, label_key, sort_order FROM repair_statuses WHERE active=1 ORDER BY sort_order");
}

export async function listRepairs(): Promise<Repair[]> {
  if (isServerMode) return (await api<Repair[]>("/repairs")).map(normalize);
  const db = await getDatabase();
  return (await db.select<Repair[]>(`${desktopRepairSelect} ORDER BY r.id DESC`)).map(normalize);
}

export async function listRepairsByCustomer(customerId: number): Promise<Repair[]> {
  if (isServerMode) return (await api<Repair[]>(`/repairs?customerId=${customerId}`)).map(normalize);
  const db = await getDatabase();
  return (await db.select<Repair[]>(`${desktopRepairSelect} WHERE r.customer_id=? ORDER BY r.id DESC`, [customerId])).map(normalize);
}

export async function getRepair(id: number): Promise<Repair | null> {
  if (isServerMode) {
    try { return normalize(await api<Repair>(`/repairs/${id}`)); }
    catch (error) { if (error instanceof Error && error.message === "Not found") return null; throw error; }
  }
  const db = await getDatabase();
  const rows = await db.select<Repair[]>(`${desktopRepairSelect} WHERE r.id=? LIMIT 1`, [id]);
  return rows[0] ? normalize(rows[0]) : null;
}

export async function listRepairStatusHistory(repairId: number): Promise<RepairStatusHistory[]> {
  if (isServerMode) return api(`/repairs/${repairId}/history`);
  const db = await getDatabase();
  return db.select(`SELECT h.id, h.status_id, s.code status_code, s.label_key status_label_key, h.changed_at, h.note
    FROM repair_status_history h JOIN repair_statuses s ON s.id=h.status_id
    WHERE h.repair_id=? ORDER BY h.id DESC`, [repairId]);
}

function optionalNumber(value: string) {
  return value.trim() === "" ? null : Number(value);
}

function desktopFields(input: RepairInput | RepairUpdateInput) {
  return {
    ...input,
    estimated_value: optionalNumber(input.estimated_value),
    deposit: optionalNumber(input.deposit),
    warranty_days: optionalNumber(input.warranty_days),
    final_value: "final_value" in input ? optionalNumber(input.final_value) : null,
  };
}

export async function createRepair(input: RepairInput): Promise<number> {
  if (isServerMode) {
    const result = await api<{ id: number }>("/repairs", { method: "POST", body: JSON.stringify(input) });
    return result.id;
  }
  return invoke<number>("create_repair", { repair: desktopFields(input) });
}

export async function updateRepair(id: number, input: RepairUpdateInput, statusNote = ""): Promise<void> {
  if (isServerMode) return api(`/repairs/${id}`, { method: "PUT", body: JSON.stringify({ ...input, statusNote }) });
  await invoke("update_repair", { id, repair: desktopFields(input), statusNote });
}

/** On the server edition, photos are deleted too unless `photos` is "keep" (then they are archived). */
export async function deleteRepair(id: number, photos: "delete" | "keep" = "delete"): Promise<void> {
  if (isServerMode) return api(`/repairs/${id}?photos=${photos}`, { method: "DELETE" });
  await invoke("delete_repair", { id });
}
