import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { I18nProvider } from "./i18n/I18nProvider";
import { BrandingProvider } from "./branding";
import { isServerMode } from "./data/runtime";
import "./styles.css";

// The server edition can be installed on phones and tablets as an app.
if (isServerMode) {
  const add = (tag: string, attributes: Record<string, string>) => {
    const element = document.createElement(tag);
    for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value);
    document.head.appendChild(element);
  };
  add("link", { rel: "manifest", href: "/api/app/manifest.webmanifest" });
  add("link", { rel: "apple-touch-icon", href: "/api/app/apple-touch-icon.png" });
  // Service workers only run over HTTPS (for example Tailscale Serve) or on localhost.
  if ("serviceWorker" in navigator && window.isSecureContext) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("/sw.js").catch((error) => console.warn("Service worker not registered:", error));
    });
  }
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <I18nProvider>
      <BrandingProvider>
        <App />
      </BrandingProvider>
    </I18nProvider>
  </React.StrictMode>
);
