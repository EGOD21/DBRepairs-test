import { getDatabase } from "./database";
import { api } from "./api";
import { isServerMode } from "./runtime";

export type PartStatus = "needed" | "ordered" | "received" | "installed" | "cancelled";
export const partStatuses: PartStatus[] = ["needed", "ordered", "received", "installed", "cancelled"];
export type PartFilter = "open" | "needed" | "ordered" | "all";

export type Part = {
  id: number; repair_id: number; name: string; part_number: string | null; supplier: string | null; url: string | null;
  quantity: number; unit_cost: number | null; status: PartStatus; notes: string | null; ordered_at: string | null; received_at: string | null;
  created_at: string; updated_at: string;
  repair_number: string; customer_id: number; customer_name: string; device_type: string | null; brand: string | null; model: string | null;
};

export type PartInput = {
  name: string; part_number: string; supplier: string; url: string; quantity: string; unit_cost: string; status: PartStatus; notes: string;
};

export const blankPartInput: PartInput = { name: "", part_number: "", supplier: "", url: "", quantity: "1", unit_cost: "", status: "needed", notes: "" };

export function toPartInput(part: Part): PartInput {
  return {
    name: part.name, part_number: part.part_number ?? "", supplier: part.supplier ?? "", url: part.url ?? "",
    quantity: String(part.quantity), unit_cost: part.unit_cost?.toString() ?? "", status: part.status, notes: part.notes ?? "",
  };
}

/** Only http(s) links may be opened; anything else is treated as no link. */
export function safeLink(url: string | null): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.toString() : null;
  } catch {
    return null;
  }
}

/** Adds https:// when someone pastes "amazon.com/..." without it. */
export function normalizeLink(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  return /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

const desktopSelect = `SELECT p.*, r.repair_number, r.customer_id, c.name customer_name, r.device_type, r.brand, r.model
  FROM repair_parts p JOIN repairs r ON r.id = p.repair_id JOIN customers c ON c.id = r.customer_id`;

const desktopFilters: Record<PartFilter, string> = {
  open: "p.status IN ('needed','ordered')", needed: "p.status='needed'", ordered: "p.status='ordered'", all: "1=1",
};

const normalize = (row: Part): Part => ({ ...row, quantity: Number(row.quantity) });

export async function listParts(filter: PartFilter = "open"): Promise<Part[]> {
  if (isServerMode) return (await api<Part[]>(`/parts?status=${filter}`)).map(normalize);
  const db = await getDatabase();
  return (await db.select<Part[]>(`${desktopSelect} WHERE ${desktopFilters[filter]}
    ORDER BY CASE p.status WHEN 'needed' THEN 0 WHEN 'ordered' THEN 1 ELSE 2 END, p.id DESC`)).map(normalize);
}

export async function listRepairParts(repairId: number): Promise<Part[]> {
  if (isServerMode) return (await api<Part[]>(`/repairs/${repairId}/parts`)).map(normalize);
  const db = await getDatabase();
  return (await db.select<Part[]>(`${desktopSelect} WHERE p.repair_id = ? ORDER BY p.id`, [repairId])).map(normalize);
}

function payload(input: PartInput) {
  const quantity = Number(input.quantity);
  return {
    name: input.name.trim(),
    part_number: input.part_number.trim() || null,
    supplier: input.supplier.trim() || null,
    url: normalizeLink(input.url) || null,
    quantity: Number.isInteger(quantity) && quantity > 0 ? quantity : 1,
    unit_cost: input.unit_cost.trim() === "" ? null : Number(input.unit_cost),
    status: input.status,
    notes: input.notes.trim() || null,
  };
}

function checkDesktop(data: ReturnType<typeof payload>) {
  if (!data.name) throw new Error("name is required");
  if (data.url && !safeLink(data.url)) throw new Error("url must start with https://");
  if (data.unit_cost !== null && (!Number.isFinite(data.unit_cost) || data.unit_cost < 0)) throw new Error("unit_cost must be a positive number");
}

// The dates record when a part was first marked ordered and received.
const orderedAt = "CASE WHEN ?7 IN ('ordered','received','installed') THEN COALESCE(ordered_at, CURRENT_TIMESTAMP) ELSE NULL END";
const receivedAt = "CASE WHEN ?7 IN ('received','installed') THEN COALESCE(received_at, CURRENT_TIMESTAMP) ELSE NULL END";

export async function createPart(repairId: number, input: PartInput): Promise<number> {
  const data = payload(input);
  if (isServerMode) return (await api<{ id: number }>(`/repairs/${repairId}/parts`, { method: "POST", body: JSON.stringify(data) })).id;
  checkDesktop(data);
  const db = await getDatabase();
  const result = await db.execute(
    `INSERT INTO repair_parts (name, part_number, supplier, url, quantity, unit_cost, status, notes, repair_id, ordered_at, received_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9,
       CASE WHEN ?7 IN ('ordered','received','installed') THEN CURRENT_TIMESTAMP END,
       CASE WHEN ?7 IN ('received','installed') THEN CURRENT_TIMESTAMP END)`,
    [data.name, data.part_number, data.supplier, data.url, data.quantity, data.unit_cost, data.status, data.notes, repairId],
  );
  return Number(result.lastInsertId ?? 0);
}

export async function updatePart(id: number, input: PartInput): Promise<void> {
  const data = payload(input);
  if (isServerMode) return api(`/parts/${id}`, { method: "PUT", body: JSON.stringify(data) });
  checkDesktop(data);
  const db = await getDatabase();
  await db.execute(
    `UPDATE repair_parts SET name=?1, part_number=?2, supplier=?3, url=?4, quantity=?5, unit_cost=?6, status=?7, notes=?8,
       ordered_at=${orderedAt}, received_at=${receivedAt}, updated_at=CURRENT_TIMESTAMP WHERE id=?9`,
    [data.name, data.part_number, data.supplier, data.url, data.quantity, data.unit_cost, data.status, data.notes, id],
  );
}

export async function deletePart(id: number): Promise<void> {
  if (isServerMode) return api(`/parts/${id}`, { method: "DELETE" });
  const db = await getDatabase();
  await db.execute("DELETE FROM repair_parts WHERE id = ?1", [id]);
}
