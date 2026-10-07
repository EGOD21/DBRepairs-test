import { useEffect } from "react";
import { createPortal } from "react-dom";
import Icon from "../components/Icon";
import { Wipe } from "../data/records";
import { useI18n } from "../i18n/I18nProvider";
import { OfficeSettings } from "./types";
import Barcode from "../components/Barcode";

/** A4 certificate of data sanitization / destruction for one drive. */
export default function WipeCertificate({ wipe, office, statement, onClose }: { wipe: Wipe; office: OfficeSettings; statement: string; onClose: () => void }) {
  const { t } = useI18n();
  useEffect(() => {
    const style = document.createElement("style");
    style.textContent = "@media print { @page { size: A4 portrait; margin: 0; } }";
    document.head.appendChild(style);
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => { style.remove(); window.removeEventListener("keydown", onKey); };
  }, [onClose]);

  const rows: [string, string | null | undefined][] = [
    [t("wipe.serial"), wipe.drive_serial], [t("wipe.model"), wipe.drive_model], [t("wipe.capacity"), wipe.capacity], [t("wipe.interface"), wipe.interface],
    [t("wipe.method"), t(`wipe.method.${wipe.method}`)], [t("wipe.standard"), t(`wipe.standard.${wipe.method}`)], [t("wipe.tool"), wipe.tool],
    [t("wipe.passes"), wipe.passes?.toString()], [t("wipe.completedAt"), new Date(wipe.completed_at).toLocaleString()],
    [t("wipe.result"), t(`wipe.result.${wipe.result}`)], [t("wipe.verification"), wipe.verified ? t("wipe.verifiedYes") : t("wipe.verifiedNo")],
    [t("repair.number"), wipe.repair_number], [t("asset.title"), wipe.asset_name],
  ];

  return createPortal(
    <div className="print-overlay">
      <div className="print-toolbar">
        <div><strong>{wipe.certificate_number}</strong><span className="muted">{t("billing.printHint")}</span></div>
        <div><button type="button" className="btn" onClick={onClose}>{t("common.close")}</button>
          <button type="button" className="btn btn-primary" onClick={() => window.print()}><Icon name="printer" size={16} />{t("print.print")}</button></div>
      </div>
      <div className="print-stage">
        <section className="print-sheet certificate-sheet">
          <header className="invoice-head">
            <div className="invoice-brand"><img src={office.logoDataUrl || "/dbrepairs-icon.png"} alt="" />
              <div><strong>{office.companyName || "DBRepairs"}</strong>{[office.address, office.phone, office.email, office.website].filter(Boolean).map((line) => <span key={line}>{line}</span>)}</div></div>
            <div className="certificate-number"><span className="invoice-label">{t("wipe.certificate")}</span><strong>{wipe.certificate_number}</strong>
              <div style={{ width: "50mm", height: "9mm" }}><Barcode value={wipe.certificate_number} /></div></div>
          </header>
          <h1 className="certificate-title">{t("wipe.certificateTitle")}</h1>
          <p className="certificate-intro">{t("wipe.certificateIntro")}</p>
          <div className="invoice-parties"><div><span className="invoice-label">{t("wipe.customer")}</span>
            <strong>{wipe.customer_company || wipe.customer_name}</strong>{wipe.customer_company && <span>{wipe.customer_name}</span>}</div></div>
          <table className="certificate-table"><tbody>
            {rows.filter(([, value]) => value).map(([label, value]) => <tr key={label}><th>{label}</th><td>{value}</td></tr>)}
          </tbody></table>
          {wipe.notes && <p className="pre">{wipe.notes}</p>}
          <p className="certificate-statement pre">{statement || t("wipe.defaultStatement")}</p>
          <div className="certificate-signatures">
            <div><div className="signature-line" /><span>{t("wipe.technicianSignature")}{wipe.technician ? ` — ${wipe.technician}` : ""}</span></div>
            <div><div className="signature-line" /><span>{t("wipe.date")}</span></div>
          </div>
        </section>
      </div>
    </div>,
    document.body,
  );
}
