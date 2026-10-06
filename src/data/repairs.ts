import { invoke } from "@tauri-apps/api/core";
import { getDatabase } from "./database";
import { api } from "./api";
import { isServerMode } from "./runtime";

export type RepairStatus = { id: number; code: string; label_key: string; sort_order: number };
export type Repair = {
  id: number; repair_number: string; customer_id: number; customer_name: string; status_id: number; status_code: string; status_label_key: string;
  device_type: string | null; brand: string | null; model: string | null; serial_number: string | null; imei: string | null;
  reported_fault: string | null; accessories: string | null; general_condition: string | null; diagnosis: string | null; work_performed: string | null;
  estimated_value: number | null; final_value: number | null; internal_notes: string | null; opened_at: string; closed_at: string | null;
};

export type RepairInput = {
  customer_id: number; status_id: number; device_type: string; brand: string; model: string; serial_number: string; imei: string;
  reported_fault: string; accessories: string; general_condition: string; estimated_value: string; internal_notes: string;
};

export type RepairUpdateInput = RepairInput & {
  diagnosis: string;
  work_performed: string;
  final_value: string;
};

export type RepairStatusHistory = {
  id: number;
  status_id: number;
  status_code: string;
  status_label_key: string;
  changed_at: string;
  note: string | null;
};

export async function listStatuses(): Promise<RepairStatus[]> {
  if (isServerMode) return api("/statuses");
  const db = await getDatabase();
  return db.select("SELECT id, code, label_key, sort_order FROM repair_statuses WHERE active=1 ORDER BY sort_order");
}

export async function listRepairs(): Promise<Repair[]> {
  if (isServerMode) return api("/repairs");
  const db = await getDatabase();
  return db.select(`SELECT r.*, c.name customer_name, s.code status_code, s.label_key status_label_key
    FROM repairs r JOIN customers c ON c.id=r.customer_id JOIN repair_statuses s ON s.id=r.status_id
    ORDER BY r.id DESC`);
}

export async function listRepairsByCustomer(customerId: number): Promise<Repair[]> {
  if (isServerMode) return api(`/repairs?customerId=${customerId}`);
  const db = await getDatabase();
  return db.select(`SELECT r.*, c.name customer_name, s.code status_code, s.label_key status_label_key
    FROM repairs r
    JOIN customers c ON c.id=r.customer_id
    JOIN repair_statuses s ON s.id=r.status_id
    WHERE r.customer_id=?
    ORDER BY r.id DESC`, [customerId]);
}

export async function getRepair(id: number): Promise<Repair | null> {
  if (isServerMode) {
    try { return await api(`/repairs/${id}`); }
    catch (error) { if (error instanceof Error && error.message === "Not found") return null; throw error; }
  }
  const db = await getDatabase();
  const rows = await db.select<Repair[]>(`SELECT r.*, c.name customer_name, s.code status_code, s.label_key status_label_key
    FROM repairs r JOIN customers c ON c.id=r.customer_id JOIN repair_statuses s ON s.id=r.status_id
    WHERE r.id=? LIMIT 1`, [id]);
  return rows[0] ?? null;
}

export async function listRepairStatusHistory(repairId: number): Promise<RepairStatusHistory[]> {
  if (isServerMode) return api(`/repairs/${repairId}/history`);
  const db = await getDatabase();
  return db.select(`SELECT h.id, h.status_id, s.code status_code, s.label_key status_label_key, h.changed_at, h.note
    FROM repair_status_history h JOIN repair_statuses s ON s.id=h.status_id
    WHERE h.repair_id=? ORDER BY h.id DESC`, [repairId]);
}

function money(value: string) {
  return value.trim() === "" ? null : Number(value);
}

function desktopFields(input: RepairInput | RepairUpdateInput) {
  return {
    ...input,
    estimated_value: money(input.estimated_value),
    final_value: "final_value" in input ? money(input.final_value) : null,
  };
}

export async function createRepair(input: RepairInput): Promise<number> {
  if (isServerMode) {
    const result = await api<{ id: number }>("/repairs", { method: "POST", body: JSON.stringify(input) });
    return result.id;
  }
  return invoke<number>("create_repair", { repair: desktopFields(input) });
}

export async function updateRepair(id: number, input: RepairUpdateInput, previousStatusId: number, statusNote = ""): Promise<void> {
  if (isServerMode) return api(`/repairs/${id}`, { method: "PUT", body: JSON.stringify({ ...input, previousStatusId, statusNote }) });
  await invoke("update_repair", { id, repair: desktopFields(input), statusNote });
}
