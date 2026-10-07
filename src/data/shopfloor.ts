import { api } from "./api";

export type StockItem = {
  id: number; sku: string | null; name: string; category: string | null; brand: string | null; part_number: string | null; barcode: string | null;
  supplier: string | null; url: string | null; cost: number | null; price: number | null; quantity: number; reorder_level: number; reorder_quantity: number | null;
  location: string | null; notes: string | null; active: boolean; low: boolean;
};
export type StockInput = {
  sku: string; name: string; category: string; brand: string; part_number: string; barcode: string; supplier: string; url: string; cost: string; price: string;
  reorder_level: string; reorder_quantity: string; location: string; notes: string; active: boolean; quantity?: string;
};
export const blankStock: StockInput = { sku: "", name: "", category: "", brand: "", part_number: "", barcode: "", supplier: "", url: "", cost: "", price: "",
  reorder_level: "", reorder_quantity: "", location: "", notes: "", active: true, quantity: "0" };
export type StockMovement = { id: number; change: number; reason: string; note: string | null; created_at: string; user_name: string | null; repair_id: number | null; repair_number: string | null };
export const stockReasons = ["received", "used", "adjusted", "returned", "sold", "damaged"] as const;

export const returnStatuses = ["to_ship", "shipped", "replaced", "credited", "rejected", "closed"] as const;
export type ReturnStatus = typeof returnStatuses[number];
export type SupplierReturn = {
  id: number; supplier: string; supplier_rma: string | null; item: string; part_number: string | null; serial_number: string | null; quantity: number;
  reason: string | null; status: ReturnStatus; repair_id: number | null; repair_number: string | null; repair_part_id: number | null; stock_item_id: number | null;
  shipped_at: string | null; tracking: string | null; resolved_at: string | null; credit_amount: number | null; notes: string | null; created_at: string;
};

export type UnclaimedRepair = {
  id: number; repair_number: string; device_type: string | null; brand: string | null; model: string | null; pickup_reminded_at: string | null;
  final_value: number | null; estimated_value: number | null; paid: boolean; customer_id: number; customer_name: string; customer_email: string | null;
  customer_phone: string | null; ready_since: string; days_waiting: number;
};

export const appointmentKinds = ["onsite", "remote", "dropoff", "pickup", "other"] as const;
export type AppointmentKind = typeof appointmentKinds[number];
export type Appointment = {
  id: number; title: string; kind: AppointmentKind; customer_id: number | null; customer_name: string | null; customer_phone: string | null;
  repair_id: number | null; repair_number: string | null; asset_id: number | null; asset_name: string | null; user_id: number | null; user_name: string | null;
  starts_at: string; ends_at: string; all_day: boolean; address: string | null; travel_minutes: number | null; notes: string | null;
  status: "scheduled" | "done" | "cancelled";
};
export type AppointmentInput = Omit<Appointment, "id" | "customer_name" | "customer_phone" | "repair_number" | "asset_name" | "user_name">;

const q = (params: Record<string, string | number | undefined>) => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== "") search.set(key, String(value));
  return search.toString() ? `?${search}` : "";
};

export const listStock = (filters: { search?: string; low?: boolean; barcode?: string; all?: boolean } = {}) =>
  api<StockItem[]>(`/stock${q({ search: filters.search, barcode: filters.barcode, low: filters.low ? "1" : undefined, all: filters.all ? "1" : undefined })}`);
export const createStock = (input: StockInput) => api<StockItem>("/stock", { method: "POST", body: JSON.stringify(input) });
export const updateStock = (id: number, input: StockInput) => api<StockItem>(`/stock/${id}`, { method: "PUT", body: JSON.stringify(input) });
export const deleteStock = (id: number) => api<void>(`/stock/${id}`, { method: "DELETE" });
export const adjustStock = (id: number, change: number, reason: string, note: string) =>
  api<StockItem>(`/stock/${id}/adjust`, { method: "POST", body: JSON.stringify({ change, reason, note }) });
export const stockMovements = (id: number) => api<StockMovement[]>(`/stock/${id}/movements`);
export const takeFromStock = (repairId: number, itemId: number, quantity: number) =>
  api<{ id: number }>(`/repairs/${repairId}/use-stock`, { method: "POST", body: JSON.stringify({ item_id: itemId, quantity }) });

export const listReturns = (open = false) => api<SupplierReturn[]>(`/returns${open ? "?open=1" : ""}`);
export const createReturn = (input: Partial<SupplierReturn>) => api<SupplierReturn>("/returns", { method: "POST", body: JSON.stringify(input) });
export const updateReturn = (id: number, input: Partial<SupplierReturn>) => api<SupplierReturn>(`/returns/${id}`, { method: "PUT", body: JSON.stringify(input) });
export const deleteReturn = (id: number) => api<void>(`/returns/${id}`, { method: "DELETE" });

export const createComeback = (repairId: number, reportedFault: string) =>
  api<{ id: number; repair_number: string; is_warranty: boolean }>(`/repairs/${repairId}/comeback`, { method: "POST", body: JSON.stringify({ reported_fault: reportedFault }) });

export const listUnclaimed = (days?: number) => api<UnclaimedRepair[]>(`/unclaimed${q({ days })}`);
export const markReminded = (repairId: number) => api<void>(`/repairs/${repairId}/reminded`, { method: "POST", body: "{}" });

export const listAppointments = (filters: { from?: string; to?: string; userId?: number; customerId?: number; repairId?: number } = {}) =>
  api<Appointment[]>(`/appointments${q(filters)}`);
export const createAppointment = (input: AppointmentInput) => api<Appointment>("/appointments", { method: "POST", body: JSON.stringify(input) });
export const updateAppointment = (id: number, input: AppointmentInput) => api<Appointment>(`/appointments/${id}`, { method: "PUT", body: JSON.stringify(input) });
export const deleteAppointment = (id: number) => api<void>(`/appointments/${id}`, { method: "DELETE" });
export const calendarLink = () => api<{ path: string }>("/me/calendar");
export const resetCalendarLink = () => api<{ path: string }>("/me/calendar/reset", { method: "POST", body: "{}" });
