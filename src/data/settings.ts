import { getDatabase } from "./database";
import { api } from "./api";
import { isServerMode } from "./runtime";

export const settingKeys = [
  "office.companyName", "office.taxNumber", "office.address", "office.phone", "office.email", "office.website", "office.logoDataUrl",
  "ui.theme", "print.autoPrint", "print.labelSize", "print.terms", "email.signature",
  "app.icon192", "app.icon512", "app.iconMaskable", "app.iconApple", "photos.autoDeleteDays",
  "billing.currency", "billing.taxRate", "billing.taxLabel", "billing.hourlyRate", "billing.timeRounding", "billing.invoicePrefix",
  "billing.estimatePrefix", "billing.paymentTermsDays", "billing.estimateValidDays", "billing.invoiceNotes", "billing.paymentInstructions",
  "billing.paymentLink", "vault.techAccess", "intake.checklist", "intake.waiver", "wipe.prefix", "wipe.statement",
] as const;

export type SettingKey = typeof settingKeys[number];
export type AppSettings = Record<SettingKey, string>;
export type Branding = Pick<AppSettings, "office.companyName" | "office.logoDataUrl" | "ui.theme" | "billing.currency">;

export const emptySettings = Object.fromEntries(settingKeys.map((key) => [key, ""])) as AppSettings;

async function readDesktop<K extends SettingKey>(keys: readonly K[]): Promise<Record<K, string>> {
  const db = await getDatabase();
  const rows = await db.select<{ key: string; value: string }[]>(
    `SELECT key, value FROM app_settings WHERE key IN (${keys.map(() => "?").join(",")})`, [...keys]);
  const byKey = new Map(rows.map((row) => [row.key, row.value]));
  return Object.fromEntries(keys.map((key) => [key, byKey.get(key) || ""])) as Record<K, string>;
}

export async function getSettings(): Promise<AppSettings> {
  if (isServerMode) return { ...emptySettings, ...await api<Partial<AppSettings>>("/settings") };
  return readDesktop(settingKeys);
}

/** Public subset used before sign-in: company name, logo and colors. */
export async function getBranding(): Promise<Branding> {
  const keys = ["office.companyName", "office.logoDataUrl", "ui.theme", "billing.currency"] as const;
  if (isServerMode) {
    const response = await fetch("/api/branding");
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return { "office.companyName": "", "office.logoDataUrl": "", "ui.theme": "", "billing.currency": "", ...await response.json() as Partial<Branding> };
  }
  return readDesktop(keys);
}

/** Saves only the settings passed in; the rest stay unchanged. */
export async function saveSettings(settings: Partial<AppSettings>): Promise<void> {
  if (isServerMode) return api("/settings", { method: "PUT", body: JSON.stringify(settings) });
  const db = await getDatabase();
  for (const [key, value] of Object.entries(settings)) {
    await db.execute("INSERT INTO app_settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", [key, value ?? ""]);
  }
}

/**
 * Shrinks a logo to at most 512px so it saves quickly and fits the settings
 * limit, keeping PNG transparency when the result is small enough.
 */
export async function prepareLogo(file: File): Promise<string> {
  if (!/^image\/(png|jpeg|webp)$/.test(file.type)) throw new Error("invalid");
  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("invalid"));
      img.src = url;
    });
    const scale = Math.min(1, 512 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("invalid");
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const png = canvas.toDataURL("image/png");
    if (png.length < 1_500_000) return png;
    return canvas.toDataURL("image/webp", 0.9);
  } finally {
    URL.revokeObjectURL(url);
  }
}
