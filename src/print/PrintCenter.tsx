import { RefObject, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Barcode from "../components/Barcode";
import Icon from "../components/Icon";
import { useI18n } from "../i18n/I18nProvider";
import { defaultLabelSize, labelSizes, OfficeSettings, RepairPrintData, TicketKind } from "./types";

type Props = {
  data: RepairPrintData;
  office: OfficeSettings;
  initialKind: TicketKind;
  labelSize: string;
  autoPrint?: boolean;
  onClose: () => void;
};

const mmPerPixel = 25.4 / 96;

/** Sets the printer page size for the ticket being printed. */
function usePageSize(size: string) {
  useEffect(() => {
    const style = document.createElement("style");
    style.id = "dbrepairs-page-size";
    style.textContent = `@media print { @page { size: ${size}; margin: 0; } }`;
    document.head.appendChild(style);
    return () => style.remove();
  }, [size]);
}

export default function PrintCenter({ data, office, initialKind, labelSize, autoPrint = false, onClose }: Props) {
  const { t } = useI18n();
  const [kind, setKind] = useState<TicketKind>(initialKind);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [error, setError] = useState("");
  const [receiptHeight, setReceiptHeight] = useState(200);
  const receiptRef = useRef<HTMLDivElement>(null);
  const label = labelSizes[labelSize] ?? labelSizes[defaultLabelSize];

  useLayoutEffect(() => {
    if (kind === "receipt" && receiptRef.current) setReceiptHeight(Math.ceil(receiptRef.current.offsetHeight * mmPerPixel) + 2);
  }, [kind, data]);

  usePageSize(kind === "intake" ? "A4 portrait" : kind === "label" ? `${label.width}mm ${label.height}mm` : `80mm ${receiptHeight}mm`);

  useEffect(() => {
    if (!autoPrint) return;
    const timer = window.setTimeout(() => window.print(), 350);
    return () => window.clearTimeout(timer);
  }, [autoPrint]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function downloadPdf() {
    setPdfBusy(true); setError("");
    try {
      const { downloadRepairPdf } = await import("../pdf/repairPdf");
      await downloadRepairPdf(data, office, t);
    } catch {
      setError(t("print.pdfError"));
    } finally {
      setPdfBusy(false);
    }
  }

  return createPortal(
    <div className="print-overlay">
      <div className="print-toolbar">
        <div className="segmented" role="tablist">
          <button type="button" className={kind === "intake" ? "active" : ""} onClick={() => setKind("intake")}>{t("print.kind.intake")}</button>
          <button type="button" className={kind === "label" ? "active" : ""} onClick={() => setKind("label")}>{t("print.kind.label")}</button>
          <button type="button" className={kind === "receipt" ? "active" : ""} onClick={() => setKind("receipt")}>{t("print.kind.receipt")}</button>
        </div>
        <div>
          {error && <span className="badge danger">{error}</span>}
          {kind === "intake" && <button type="button" className="btn" disabled={pdfBusy} onClick={() => void downloadPdf()}><Icon name="file" size={16} />{pdfBusy ? t("print.preparingPdf") : t("print.downloadPdf")}</button>}
          <button type="button" className="btn" onClick={onClose}>{t("common.close")}</button>
          <button type="button" className="btn btn-primary" onClick={() => window.print()}><Icon name="printer" size={16} />{t("print.print")}</button>
        </div>
      </div>
      <div className="print-stage">
        {kind === "intake" && <IntakeSheet data={data} office={office} />}
        {kind === "label" && <DeviceLabel data={data} office={office} width={label.width} height={label.height} />}
        {kind === "receipt" && <Receipt sheetRef={receiptRef} data={data} office={office} />}
      </div>
    </div>,
    document.body,
  );
}

function contactLine(office: OfficeSettings, taxLabel: string) {
  return [office.address, office.phone, office.email, office.website, office.taxNumber ? `${taxLabel}: ${office.taxNumber}` : ""].filter(Boolean).join(" · ");
}

function deviceText(data: RepairPrintData) {
  return [data.deviceType, data.brand, data.model].filter(Boolean).join(" · ") || "—";
}

function IntakeSheet({ data, office }: { data: RepairPrintData; office: OfficeSettings }) {
  const { t } = useI18n();
  return (
    <section className="print-sheet ticket-a4" aria-label={t("print.kind.intake")}>
      <IntakeHalf title={t("print.shopCopy")} data={data} office={office} shopCopy />
      <div className="cut-line"><span>✂ {t("print.cutHere")}</span></div>
      <IntakeHalf title={t("print.customerCopy")} data={data} office={office} />
    </section>
  );
}

function IntakeHalf({ title, data, office, shopCopy = false }: { title: string; data: RepairPrintData; office: OfficeSettings; shopCopy?: boolean }) {
  const { t } = useI18n();
  const contact = contactLine(office, t("settings.taxNumber"));
  return (
    <article className="repair-slip">
      <div className="slip-head">
        <div className="slip-brand-wrap">
          <img src={office.logoDataUrl || "/dbrepairs-icon.png"} alt="" />
          <div><strong className="slip-brand">{office.companyName || "DBRepairs"}</strong>{contact && <small className="slip-company-details">{contact}</small>}<span className="slip-label">{title}</span></div>
        </div>
        <div className="slip-number"><span className="slip-label">{t("print.repairNumber")}</span><strong>{data.repairNumber}</strong><div style={{ width: "42mm", height: "8mm" }}><Barcode value={data.repairNumber} /></div></div>
      </div>
      <div className="slip-grid">
        <div><span>{t("customer.name")}</span><strong>{data.customerName}</strong></div>
        <div><span>{t("repair.openedAt")}</span><strong>{data.openedAt}</strong></div>
        <div><span>{t("customer.phone")}</span><strong>{data.phone || "—"}</strong></div>
        <div><span>{t("repair.device")}</span><strong>{deviceText(data)}</strong></div>
        <div><span>{t("customer.email")}</span><strong>{data.email || "—"}</strong></div>
        <div><span>{t("repair.serialOrImei")}</span><strong>{data.imei || data.serialNumber || "—"}</strong></div>
        <div><span>{t("repair.dueDate")}</span><strong>{data.dueDate || "—"}</strong></div>
        <div><span>{t("repair.estimatedValue")}</span><strong>{data.estimate || "—"}</strong></div>
      </div>
      <div className="slip-row"><span>{t("repair.reportedFault")}</span><p>{data.reportedFault || "—"}</p></div>
      <div className="slip-row"><span>{t("repair.accessories")}</span><p>{data.accessories || "—"}</p></div>
      <div className="slip-row"><span>{t("repair.generalCondition")}</span><p>{data.generalCondition || "—"}</p></div>
      {data.checklist && (
        <div className="slip-row slip-checklist"><span>{t("intake.checklist")}{data.dataBackup ? ` · ${t("intake.backup")}: ${data.dataBackup}` : ""}{data.equipment ? ` · ${data.equipment}` : ""}</span>
          <p>{data.checklist.map((item) => `${item.checked ? "☑" : "☐"} ${item.label}`).join("   ")}</p></div>
      )}
      {shopCopy && <div className="slip-row internal"><span>{t("repair.internalNotes")}</span><p>{data.internalNotes || "—"}</p></div>}
      {!shopCopy && (office.terms || data.waiver) && <p className="slip-terms">{[data.waiver, office.terms].filter(Boolean).join("\n")}</p>}
      <div className="signature-row">
        <div>{data.intakeSignature && <img className="slip-signature" src={data.intakeSignature.image} alt="" />}<span>{t("print.customerSignature")}{data.intakeSignature ? ` — ${data.intakeSignature.name}` : ""}</span></div>
        <div><span>{t("print.shopSignature")}</span></div>
      </div>
    </article>
  );
}

function DeviceLabel({ data, office, width, height }: { data: RepairPrintData; office: OfficeSettings; width: number; height: number }) {
  const large = height >= 45;
  return (
    <section className={`print-sheet ticket-label${large ? " large" : ""}`} style={{ width: `${width}mm`, height: `${height}mm` }}>
      <div className="label-top"><span className="label-number">{data.repairNumber}</span><span className="label-company">{office.companyName || "DBRepairs"}</span></div>
      <div className="label-lines">
        <div><strong>{data.customerName}</strong>{data.phone ? ` · ${data.phone}` : ""}</div>
        <div>{deviceText(data)}</div>
        {large && <div>{data.reportedFault || ""}</div>}
        {(data.dueDate || data.openedAt) && <div>{data.openedAt}{data.dueDate ? ` → ${data.dueDate}` : ""}</div>}
      </div>
      <Barcode value={data.repairNumber} />
      <span />
    </section>
  );
}

type ReceiptProps = { data: RepairPrintData; office: OfficeSettings; sheetRef: RefObject<HTMLDivElement | null> };

function Receipt({ data, office, sheetRef }: ReceiptProps) {
  const { t } = useI18n();
  return (
    <section className="print-sheet ticket-receipt" ref={sheetRef}>
      <div className="receipt-head">
        {office.logoDataUrl && <img src={office.logoDataUrl} alt="" />}
        <strong>{office.companyName || "DBRepairs"}</strong>
        {[office.address, office.phone, office.email, office.website].filter(Boolean).map((line) => <span key={line}>{line}</span>)}
      </div>
      <hr />
      <div className="receipt-number">{data.repairNumber}</div>
      <Barcode value={data.repairNumber} />
      <hr />
      <div className="receipt-row"><span>{t("repair.openedAt")}</span><span>{data.openedAt}</span></div>
      <div className="receipt-row"><span>{t("customer.name")}</span><span>{data.customerName}</span></div>
      {data.phone && <div className="receipt-row"><span>{t("customer.phone")}</span><span>{data.phone}</span></div>}
      <div className="receipt-row"><span>{t("repair.device")}</span><span>{deviceText(data)}</span></div>
      {(data.imei || data.serialNumber) && <div className="receipt-row"><span>{t("repair.serialOrImei")}</span><span>{data.imei || data.serialNumber}</span></div>}
      <div><span className="muted">{t("repair.reportedFault")}</span><p>{data.reportedFault || "—"}</p></div>
      {data.accessories && <div><span className="muted">{t("repair.accessories")}</span><p>{data.accessories}</p></div>}
      <hr />
      {data.dueDate && <div className="receipt-row"><span>{t("repair.dueDate")}</span><span>{data.dueDate}</span></div>}
      {data.estimate && <div className="receipt-row"><span>{t("repair.estimatedValue")}</span><span>{data.estimate}</span></div>}
      {data.deposit && <div className="receipt-row"><span>{t("repair.deposit")}</span><span>{data.deposit}</span></div>}
      {office.terms && <><hr /><p>{office.terms}</p></>}
      <p style={{ marginTop: "8mm", borderTop: "1px solid #777", paddingTop: "1mm", textAlign: "center" }}>{t("print.customerSignature")}</p>
    </section>
  );
}
