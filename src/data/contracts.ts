import { api } from "./api";
import { Invoice } from "./billing";

export type Frequency = "weekly" | "monthly" | "quarterly" | "yearly";
export const frequencies: Frequency[] = ["weekly", "monthly", "quarterly", "yearly"];

export type Contract = {
  id: number; customer_id: number; customer_name: string; name: string; monthly_fee: number; hours_included: number; overage_rate: number | null;
  response_hours: number | null; start_date: string; renewal_date: string | null; billing_day: number; auto_invoice: boolean; active: boolean;
  notes: string | null; minutes_this_month: number;
};

export type ContractInput = Omit<Contract, "id" | "customer_name" | "minutes_this_month" | "monthly_fee" | "hours_included" | "overage_rate" | "response_hours" | "billing_day"> & {
  monthly_fee: string; hours_included: string; overage_rate: string; response_hours: string; billing_day: string;
};

export type ContractUsage = {
  period: string; usedHours: number; includedHours: number; overageHours: number; percent: number | null; invoice: Invoice | null;
  entries: { id: number; work_date: string; minutes: number; description: string | null; billable: boolean; invoice_id: number | null; technician: string | null; repair_number: string | null }[];
};

export type MaintenancePlan = {
  id: number; customer_id: number; customer_name: string; contract_id: number | null; contract_name: string | null; title: string; description: string | null;
  checklist: string | null; frequency: Frequency; interval_count: number; next_due: string; lead_days: number; technician: string | null; active: boolean;
  last_repair_id: number | null; last_repair_number: string | null;
};

export type PlanInput = Pick<MaintenancePlan, "customer_id" | "contract_id" | "title" | "frequency" | "next_due" | "active"> & {
  description: string; checklist: string; technician: string; interval_count: string; lead_days: string;
};

export type SlaRepair = { id: number; repair_number: string; sla_due_at: string; opened_at: string; customer_name: string; device_type: string | null; brand: string | null; model: string | null; seconds_left: number };

export const listContracts = (filters: { customerId?: number; active?: boolean } = {}) =>
  api<Contract[]>(`/contracts?${new URLSearchParams({ ...(filters.customerId ? { customerId: String(filters.customerId) } : {}), ...(filters.active ? { active: "1" } : {}) })}`);
export const createContract = (input: ContractInput) => api<Contract>("/contracts", { method: "POST", body: JSON.stringify(input) });
export const updateContract = (id: number, input: ContractInput) => api<Contract>(`/contracts/${id}`, { method: "PUT", body: JSON.stringify(input) });
export const deleteContract = (id: number) => api<void>(`/contracts/${id}`, { method: "DELETE" });
export const contractUsage = (id: number, period: string) => api<ContractUsage>(`/contracts/${id}/usage?period=${period}`);
export const invoiceContract = (id: number, period: string) => api<{ id: number }>(`/contracts/${id}/invoice`, { method: "POST", body: JSON.stringify({ period }) });

export const listPlans = (filters: { customerId?: number; active?: boolean } = {}) =>
  api<MaintenancePlan[]>(`/maintenance?${new URLSearchParams({ ...(filters.customerId ? { customerId: String(filters.customerId) } : {}), ...(filters.active ? { active: "1" } : {}) })}`);
export const createPlan = (input: PlanInput) => api<MaintenancePlan>("/maintenance", { method: "POST", body: JSON.stringify(input) });
export const updatePlan = (id: number, input: PlanInput) => api<MaintenancePlan>(`/maintenance/${id}`, { method: "PUT", body: JSON.stringify(input) });
export const deletePlan = (id: number) => api<void>(`/maintenance/${id}`, { method: "DELETE" });
export const runPlan = (id: number) => api<{ id: number; repair_number: string; next_due: string }>(`/maintenance/${id}/run`, { method: "POST", body: "{}" });

export const listSla = () => api<SlaRepair[]>("/sla");

export type Report = {
  from: string; to: string;
  revenue: { month: string; amount: number; count: number }[];
  invoiced: { month: string; amount: number; count: number }[];
  aging: { current: number; d30: number; d60: number; d90: number; older: number };
  hours: { technician: string; billable_minutes: number | null; other_minutes: number | null; minutes: number }[];
  turnaround: { month: string; count: number; avg_days: number; median_days: number }[];
  devices: { device_type: string; count: number }[];
  customers: { id: number; name: string; amount: number }[];
  contracts: { id: number; name: string; customer_name: string; monthly_fee: number; hours_included: number; invoiced: number; minutes: number }[];
  sla: { total: number; met: number; missed: number };
  statuses: { code: string; label_key: string; count: number }[];
};
export const getReport = (from: string, to: string) => api<Report>(`/reports?from=${from}&to=${to}`);
export const exportUrl = (kind: "invoices" | "payments" | "time", format: string, from: string, to: string) =>
  `/api/export/${kind}.csv?format=${format}&from=${from}&to=${to}`;

/** "2026-10" for the month containing the date (default: this month). */
export function monthOf(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}
