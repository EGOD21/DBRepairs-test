// SQLite's CURRENT_TIMESTAMP is UTC but carries no zone ("2026-08-21 12:00:00").
// JavaScript would read that as local time, so mark it as UTC explicitly.
const sqliteTimestamp = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d+)?$/;

export function parseDbDate(value: string): Date {
  return new Date(sqliteTimestamp.test(value) ? `${value.replace(" ", "T")}Z` : value);
}

export function formatDbDate(value: string | null | undefined): string {
  if (!value) return "—";
  const date = parseDbDate(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}
