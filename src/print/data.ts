import { AppSettings } from "../data/settings";
import { Repair } from "../data/repairs";
import { formatDbDate } from "../data/dates";
import { formatMoney, formatPlainDate } from "../lib/format";
import { OfficeSettings, RepairPrintData, TicketKind } from "./types";

export function officeFromSettings(settings: AppSettings): OfficeSettings {
  return {
    companyName: settings["office.companyName"], taxNumber: settings["office.taxNumber"], address: settings["office.address"],
    phone: settings["office.phone"], email: settings["office.email"], website: settings["office.website"],
    logoDataUrl: settings["office.logoDataUrl"], terms: settings["print.terms"],
  };
}

export function toPrintData(repair: Repair): RepairPrintData {
  const optional = (value: string | null) => value || undefined;
  return {
    repairNumber: repair.repair_number, openedAt: formatDbDate(repair.opened_at), customerName: repair.customer_name,
    phone: optional(repair.customer_mobile || repair.customer_phone), email: optional(repair.customer_email),
    deviceType: optional(repair.device_type), brand: optional(repair.brand), model: optional(repair.model),
    serialNumber: optional(repair.serial_number), imei: optional(repair.imei), reportedFault: optional(repair.reported_fault),
    accessories: optional(repair.accessories), generalCondition: optional(repair.general_condition), internalNotes: optional(repair.internal_notes),
    dueDate: repair.due_date ? formatPlainDate(repair.due_date) : undefined,
    estimate: repair.estimated_value !== null ? formatMoney(repair.estimated_value) : undefined,
    deposit: repair.deposit !== null ? formatMoney(repair.deposit) : undefined,
    technician: optional(repair.technician), priority: repair.priority,
  };
}

// When a repair is created, the detail page opens its ticket and the print dialog.
const pendingKey = "dbrepairs.pendingPrint";

export function queueAutoPrint(repairId: number, kind: TicketKind) {
  try { sessionStorage.setItem(pendingKey, JSON.stringify({ repairId, kind })); } catch { /* printing just won't open automatically */ }
}

export function takeAutoPrint(repairId: number): TicketKind | null {
  try {
    const raw = sessionStorage.getItem(pendingKey);
    if (!raw) return null;
    const pending = JSON.parse(raw) as { repairId: number; kind: TicketKind };
    if (pending.repairId !== repairId) return null;
    sessionStorage.removeItem(pendingKey);
    return ["intake", "label", "receipt"].includes(pending.kind) ? pending.kind : null;
  } catch {
    return null;
  }
}
