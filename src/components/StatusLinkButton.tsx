import { useState } from "react";
import Icon from "./Icon";
import { statusLink } from "../data/comms";
import { Repair } from "../data/repairs";
import { useI18n } from "../i18n/I18nProvider";

/** Copies the customer's private status-page link (when the status page is turned on). */
export default function StatusLinkButton({ repair }: { repair: Pick<Repair, "id"> }) {
  const { t } = useI18n();
  const [url, setUrl] = useState<string | null | undefined>(undefined);
  const [copied, setCopied] = useState(false);

  async function show() {
    const result = await statusLink(repair.id).catch(() => ({ url: null }));
    setUrl(result.url);
    if (result.url) { try { await navigator.clipboard.writeText(result.url); setCopied(true); } catch { /* shown below to copy by hand */ } }
  }

  return (
    <section className="card">
      <div className="card-header"><div><h2>{t("statusPage.title")}</h2><p>{t("statusPage.hint")}</p></div>
        <button type="button" className="btn btn-sm" onClick={() => void show()}><Icon name={copied ? "check" : "copy"} size={14} />{copied ? t("vault.copied") : t("statusPage.copy")}</button></div>
      {url !== undefined && <div className="card-body">{url ? <input className="input mono" readOnly value={url} onFocus={(e) => (e.currentTarget as HTMLInputElement).select()} />
        : <p className="muted">{t("statusPage.off")}</p>}</div>}
    </section>
  );
}
