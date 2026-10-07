import { getDatabase } from "./database";
import { api } from "./api";
import { isServerMode } from "./runtime";
import { desktopRepairSelect, Repair } from "./repairs";

export type DashboardStats = {
  openRepairs: number;
  waitingCustomer: number;
  ready: number;
  closedToday: number;
  overdue: number;
  partsToOrder: number;
};

/** Server edition only. */
export type DashboardBilling = { outstanding: number; overdue_amount: number; overdue_invoices: number; unbilled_minutes: number; paid_this_month: number };

export type DashboardData = { stats: DashboardStats; recent: Repair[]; billing?: DashboardBilling };

export const emptyStats: DashboardStats = { openRepairs: 0, waitingCustomer: 0, ready: 0, closedToday: 0, overdue: 0, partsToOrder: 0 };

export async function getDashboard(): Promise<DashboardData> {
  if (isServerMode) {
    const data = await api<DashboardData>("/dashboard");
    return { stats: { ...emptyStats, ...data.stats }, billing: data.billing, recent: data.recent.map((r) => ({ ...r, paid: Boolean(r.paid) })) };
  }
  const db = await getDatabase();
  const [counts] = await db.select<Record<keyof DashboardStats, number>[]>(`SELECT
    (SELECT COUNT(*) FROM repairs r JOIN repair_statuses s ON s.id=r.status_id WHERE s.code NOT IN ('DELIVERED','CANCELLED')) openRepairs,
    (SELECT COUNT(*) FROM repairs r JOIN repair_statuses s ON s.id=r.status_id WHERE s.code='WAITING_CUSTOMER') waitingCustomer,
    (SELECT COUNT(*) FROM repairs r JOIN repair_statuses s ON s.id=r.status_id WHERE s.code='READY') ready,
    (SELECT COUNT(*) FROM repairs WHERE closed_at IS NOT NULL AND date(closed_at,'localtime') = date('now','localtime')) closedToday,
    (SELECT COUNT(*) FROM repairs r JOIN repair_statuses s ON s.id=r.status_id
      WHERE s.code NOT IN ('DELIVERED','CANCELLED') AND r.due_date IS NOT NULL AND r.due_date < date('now','localtime')) overdue,
    (SELECT COUNT(*) FROM repair_parts WHERE status='needed') partsToOrder`);
  const recent = await db.select<Repair[]>(`${desktopRepairSelect} ORDER BY r.id DESC LIMIT 8`);
  const stats = Object.fromEntries(Object.entries(counts ?? emptyStats).map(([key, value]) => [key, Number(value)])) as DashboardStats;
  return { stats, recent: recent.map((r) => ({ ...r, paid: Boolean(r.paid), parts_pending: Number(r.parts_pending), photo_count: Number(r.photo_count ?? 0) })) };
}
