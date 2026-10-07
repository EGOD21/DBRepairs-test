import { parseDbDate } from "../data/dates";

// Set from the "billing.currency" setting (for example USD); empty shows plain numbers.
let currency = "";
export function setCurrency(code: string) {
  currency = /^[A-Z]{3}$/.test(code) ? code : "";
}

export function formatMoney(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  if (currency) {
    try { return value.toLocaleString(undefined, { style: "currency", currency }); } catch { /* unknown code: plain number */ }
  }
  return value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** 90 → "1:30 h". */
export function formatMinutes(minutes: number | null | undefined): string {
  if (!minutes) return "0:00 h";
  return `${Math.floor(minutes / 60)}:${String(Math.round(minutes % 60)).padStart(2, "0")} h`;
}

/** Seconds as a running clock: 3725 → "1:02:05". */
export function formatClock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

/** Today as YYYY-MM-DD in the local time zone. */
export function todayIso(): string {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

/** Formats a plain YYYY-MM-DD date without shifting it across time zones. */
export function formatPlainDate(value: string | null | undefined): string {
  if (!value) return "—";
  const [year, month, day] = value.slice(0, 10).split("-").map(Number);
  if (!year || !month || !day) return value;
  return new Date(year, month - 1, day).toLocaleDateString();
}

export function formatDay(value: string | null | undefined): string {
  if (!value) return "—";
  const date = parseDbDate(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString();
}

export function addDays(value: string, days: number): string {
  const date = parseDbDate(value);
  date.setDate(date.getDate() + days);
  return date.toLocaleDateString();
}

export function deviceLabel(item: { device_type: string | null; brand: string | null; model: string | null }) {
  return [item.device_type, item.brand, item.model].filter(Boolean).join(" · ") || "—";
}

export function fill(template: string, values: Record<string, string | number>) {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => (key in values ? String(values[key]) : match));
}
