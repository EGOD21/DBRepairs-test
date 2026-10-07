import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { Branding, getBranding } from "./data/settings";
import { applyTheme, parseTheme, Theme } from "./theme/theme";
import { setCurrency } from "./lib/format";

type BrandingValue = {
  companyName: string;
  logo: string;
  theme: Theme;
  refresh: () => Promise<void>;
  previewTheme: (theme: Theme | null) => void;
};

const defaultLogo = "/dbrepairs-icon-square.png";
const BrandingContext = createContext<BrandingValue | null>(null);

function setFavicon(url: string) {
  let link = document.querySelector<HTMLLinkElement>("link[rel='icon']");
  if (!link) {
    link = document.createElement("link");
    link.rel = "icon";
    document.head.appendChild(link);
  }
  link.type = url.startsWith("data:image/") ? url.slice(5, url.indexOf(";")) : "image/png";
  link.href = url;
}

export function BrandingProvider({ children }: { children: ReactNode }) {
  const [branding, setBranding] = useState<Branding>({ "office.companyName": "", "office.logoDataUrl": "", "ui.theme": "", "billing.currency": "" });
  const [preview, setPreview] = useState<Theme | null>(null);

  const refresh = useCallback(async () => {
    try {
      const next = await getBranding();
      setCurrency(next["billing.currency"]);
      setBranding(next);
    } catch (error) {
      console.error("Could not load branding:", error);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const savedTheme = useMemo(() => parseTheme(branding["ui.theme"]), [branding]);
  const theme = preview ?? savedTheme;
  const companyName = branding["office.companyName"].trim() || "DBRepairs";
  const logo = branding["office.logoDataUrl"] || defaultLogo;

  useEffect(() => {
    applyTheme(theme);
    // Phones color their status bar to match the app's top bar.
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme.sidebar);
  }, [theme]);
  useEffect(() => {
    setFavicon(logo);
    document.title = companyName;
    document.querySelector('meta[name="apple-mobile-web-app-title"]')?.setAttribute("content", companyName);
  }, [logo, companyName]);

  return (
    <BrandingContext.Provider value={{ companyName, logo, theme, refresh, previewTheme: setPreview }}>
      {children}
    </BrandingContext.Provider>
  );
}

export function useBranding() {
  const value = useContext(BrandingContext);
  if (!value) throw new Error("useBranding must be used inside BrandingProvider");
  return value;
}
