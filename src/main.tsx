import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { I18nProvider } from "./i18n/I18nProvider";
import { BrandingProvider } from "./branding";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <I18nProvider>
      <BrandingProvider>
        <App />
      </BrandingProvider>
    </I18nProvider>
  </React.StrictMode>
);
