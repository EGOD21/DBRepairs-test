import { parseDbDate } from "../data/dates";

export function formatMoney(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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
