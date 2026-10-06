// Every color and font in the interface comes from these values. They are
// applied as CSS custom properties (--background, --primary, ...) on <html>.

export type ThemeKey =
  | "background" | "surface" | "surfaceMuted" | "foreground" | "mutedForeground" | "border"
  | "primary" | "primaryForeground" | "accent"
  | "sidebar" | "sidebarForeground" | "sidebarMuted" | "sidebarActive"
  | "success" | "warning" | "danger"
  | "fontFamily" | "headingFontFamily" | "radius";

export type Theme = Record<ThemeKey, string>;

export type ThemeField = { key: ThemeKey; kind: "color" | "font" | "radius"; group: "base" | "brand" | "sidebar" | "status" | "type" };

export const themeFields: ThemeField[] = [
  { key: "background", kind: "color", group: "base" },
  { key: "surface", kind: "color", group: "base" },
  { key: "surfaceMuted", kind: "color", group: "base" },
  { key: "foreground", kind: "color", group: "base" },
  { key: "mutedForeground", kind: "color", group: "base" },
  { key: "border", kind: "color", group: "base" },
  { key: "primary", kind: "color", group: "brand" },
  { key: "primaryForeground", kind: "color", group: "brand" },
  { key: "accent", kind: "color", group: "brand" },
  { key: "sidebar", kind: "color", group: "sidebar" },
  { key: "sidebarForeground", kind: "color", group: "sidebar" },
  { key: "sidebarMuted", kind: "color", group: "sidebar" },
  { key: "sidebarActive", kind: "color", group: "sidebar" },
  { key: "success", kind: "color", group: "status" },
  { key: "warning", kind: "color", group: "status" },
  { key: "danger", kind: "color", group: "status" },
  { key: "fontFamily", kind: "font", group: "type" },
  { key: "headingFontFamily", kind: "font", group: "type" },
  { key: "radius", kind: "radius", group: "type" },
];

const systemSans = 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

// Fonts that ship with common operating systems, so nothing is downloaded.
export const fontOptions: { label: string; value: string }[] = [
  { label: "System default", value: systemSans },
  { label: "Avenir Next / Segoe UI (HubSpot-like)", value: `"Avenir Next", "Lexend Deca", "Segoe UI", ${systemSans}` },
  { label: "Inter", value: `Inter, ${systemSans}` },
  { label: "Helvetica / Arial", value: '"Helvetica Neue", Helvetica, Arial, sans-serif' },
  { label: "Verdana (very readable)", value: "Verdana, Geneva, Tahoma, sans-serif" },
  { label: "Trebuchet", value: '"Trebuchet MS", "Lucida Grande", sans-serif' },
  { label: "Georgia (serif)", value: 'Georgia, Cambria, "Times New Roman", serif' },
  { label: "Monospace", value: 'ui-monospace, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace' },
];

export const radiusOptions = ["0px", "4px", "6px", "8px", "10px", "14px"];

// HubSpot's product palette: navy text, cool grey surfaces, coral accent.
export const hubspotTheme: Theme = {
  background: "#f5f8fa", surface: "#ffffff", surfaceMuted: "#eaf0f6", foreground: "#33475b", mutedForeground: "#516f90", border: "#cbd6e2",
  primary: "#ff7a59", primaryForeground: "#ffffff", accent: "#0091ae",
  sidebar: "#2d3e50", sidebarForeground: "#ffffff", sidebarMuted: "#99afc4", sidebarActive: "#425b76",
  success: "#00a38d", warning: "#c98a12", danger: "#d93f4c",
  fontFamily: fontOptions[1].value, headingFontFamily: fontOptions[1].value, radius: "8px",
};

export const themePresets: { id: string; label: string; theme: Theme }[] = [
  { id: "hubspot", label: "HubSpot (default)", theme: hubspotTheme },
  { id: "neutral", label: "Neutral (shadcn)", theme: {
    background: "#fafafa", surface: "#ffffff", surfaceMuted: "#f4f4f5", foreground: "#09090b", mutedForeground: "#71717a", border: "#e4e4e7",
    primary: "#18181b", primaryForeground: "#fafafa", accent: "#2563eb",
    sidebar: "#ffffff", sidebarForeground: "#18181b", sidebarMuted: "#71717a", sidebarActive: "#f4f4f5",
    success: "#16a34a", warning: "#ca8a04", danger: "#dc2626",
    fontFamily: fontOptions[2].value, headingFontFamily: fontOptions[2].value, radius: "8px",
  } },
  { id: "dark", label: "Dark", theme: {
    background: "#0b0f14", surface: "#121820", surfaceMuted: "#1b2430", foreground: "#e6edf3", mutedForeground: "#8b9bb0", border: "#2a3644",
    primary: "#ff7a59", primaryForeground: "#ffffff", accent: "#3fb6d3",
    sidebar: "#0f141b", sidebarForeground: "#e6edf3", sidebarMuted: "#7d8da1", sidebarActive: "#1f2a37",
    success: "#2fbf8f", warning: "#e0a63a", danger: "#f0606c",
    fontFamily: fontOptions[1].value, headingFontFamily: fontOptions[1].value, radius: "8px",
  } },
  { id: "ocean", label: "Ocean", theme: {
    background: "#f4f8fb", surface: "#ffffff", surfaceMuted: "#e6f0f7", foreground: "#14324a", mutedForeground: "#4d6b82", border: "#c9dbe8",
    primary: "#0077b6", primaryForeground: "#ffffff", accent: "#00a6a6",
    sidebar: "#03334e", sidebarForeground: "#ffffff", sidebarMuted: "#8fb3c9", sidebarActive: "#0a4a6e",
    success: "#1a9c6b", warning: "#c58b0f", danger: "#d6455d",
    fontFamily: fontOptions[0].value, headingFontFamily: fontOptions[0].value, radius: "6px",
  } },
];

// Same rule as the server: plain colors, lengths and font names only.
const safeValue = /^[#a-zA-Z0-9 ,.()%'"-]*$/;

export function isSafeThemeValue(value: unknown): value is string {
  return typeof value === "string" && value.length <= 200 && safeValue.test(value) && !/url\s*\(/i.test(value);
}

export function parseTheme(json: string | null | undefined): Theme {
  const theme = { ...hubspotTheme };
  if (!json) return theme;
  try {
    const stored = JSON.parse(json) as Record<string, unknown>;
    for (const field of themeFields) {
      const value = stored[field.key];
      if (isSafeThemeValue(value) && value) theme[field.key] = value;
    }
  } catch {
    // A damaged value falls back to the default theme.
  }
  return theme;
}

const cssName = (key: string) => `--${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;

export function applyTheme(theme: Theme) {
  const root = document.documentElement;
  for (const field of themeFields) {
    const value = theme[field.key];
    if (isSafeThemeValue(value)) root.style.setProperty(cssName(field.key), value);
  }
  root.style.colorScheme = isDark(theme.background) ? "dark" : "light";
}

export function isDark(color: string) {
  const match = /^#([0-9a-f]{6})$/i.exec(color.trim());
  if (!match) return false;
  const value = parseInt(match[1], 16);
  const [r, g, b] = [(value >> 16) & 255, (value >> 8) & 255, value & 255];
  return (0.299 * r + 0.587 * g + 0.114 * b) < 128;
}
