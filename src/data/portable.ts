import { invoke } from "@tauri-apps/api/core";
import { api, downloadApiFile } from "./api";
import { getDatabase } from "./database";
import { isServerMode } from "./runtime";

export type PortableBackup = {
  format: "dbrepairs-portable";
  version: 1 | 2;
  createdAt: string;
  sourceEngine: "sqlite" | "postgresql";
  data: {
    settings: Record<string, unknown>[];
    statuses: Record<string, unknown>[];
    customers: Record<string, unknown>[];
    repairs: Record<string, unknown>[];
    history: Record<string, unknown>[];
    parts?: Record<string, unknown>[];
  };
};

export function parsePortableBackup(text: string): PortableBackup {
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw new Error("Invalid JSON"); }
  if (!value || typeof value !== "object") throw new Error("Invalid backup");
  const archive = value as Partial<PortableBackup>;
  const data = archive.data;
  if (archive.format !== "dbrepairs-portable" || (archive.version !== 1 && archive.version !== 2) || !data ||
      !Array.isArray(data.settings) || !Array.isArray(data.statuses) || !data.statuses.length ||
      !Array.isArray(data.customers) || !Array.isArray(data.repairs) || !Array.isArray(data.history) ||
      (data.parts !== undefined && !Array.isArray(data.parts))) {
    throw new Error("Unsupported or incomplete DBRepairs portable backup");
  }
  return archive as PortableBackup;
}

function filename() {
  return `DBRepairs-portable-${new Date().toISOString().replace(/[:.]/g,"-")}.dbrepairs`;
}

export async function exportPortableBackup(): Promise<string> {
  if (isServerMode) return downloadApiFile("/backups/portable");
  const db = await getDatabase();
  const [settings,statuses,customers,repairs,history,parts] = await Promise.all([
    db.select<Record<string,unknown>[]>("SELECT key,value FROM app_settings ORDER BY key"),
    db.select<Record<string,unknown>[]>("SELECT id,code,label_key,sort_order,active FROM repair_statuses ORDER BY id"),
    db.select<Record<string,unknown>[]>(`SELECT id,name,company,tax_number,phone,email,address,notes,created_at,updated_at,customer_type,contact_person,mobile,
      preferred_contact,tags,is_retainer,retainer_plan,retainer_monthly_fee,retainer_renewal_date FROM customers ORDER BY id`),
    db.select<Record<string,unknown>[]>(`SELECT id,repair_number,customer_id,status_id,device_type,brand,model,serial_number,imei,reported_fault,accessories,general_condition,
      diagnosis,work_performed,estimated_value,final_value,internal_notes,opened_at,closed_at,created_at,updated_at,priority,due_date,technician,deposit,paid,warranty_days
      FROM repairs ORDER BY id`),
    db.select<Record<string,unknown>[]>("SELECT id,repair_id,status_id,changed_at,note FROM repair_status_history ORDER BY id"),
    db.select<Record<string,unknown>[]>("SELECT id,repair_id,name,part_number,supplier,url,quantity,unit_cost,status,notes,ordered_at,received_at,created_at,updated_at FROM repair_parts ORDER BY id"),
  ]);
  // SQLite stores booleans as 0/1; the archive format uses true/false.
  const archive:PortableBackup={format:"dbrepairs-portable",version:2,createdAt:new Date().toISOString(),sourceEngine:"sqlite",data:{
    settings,
    statuses:statuses.map(row=>({...row,active:Boolean(row.active)})),
    customers:customers.map(row=>({...row,is_retainer:Boolean(row.is_retainer)})),
    repairs:repairs.map(row=>({...row,paid:Boolean(row.paid)})),
    history,
    parts,
  }};
  const name=filename();
  return invoke<string>("export_text_file",{filename:name,content:JSON.stringify(archive)});
}

export async function importPortableBackup(archive: PortableBackup): Promise<void> {
  if (isServerMode) return api("/backups/portable", {method:"PUT",body:JSON.stringify(archive)});
  const db=await getDatabase();
  await db.execute("PRAGMA wal_checkpoint(FULL)");
  await invoke("restore_portable_database",{archive});
}
