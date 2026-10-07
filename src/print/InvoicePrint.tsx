import { useEffect } from "react";
import { createPortal } from "react-dom";
import Icon from "../components/Icon";
import { InvoiceDetail, paymentLink } from "../data/billing";
import { useI18n } from "../i18n/I18nProvider";
import { formatMoney, formatPlainDate } from "../lib/format";
import { OfficeSettings } from "./types";

type Props = { doc: InvoiceDetail; office: OfficeSettings; taxLabel: string; paymentInstructions: string; paymentLinkTemplate: string; onClose: () => void };

const quantityText = (value: number) => (Number.isInteger(value) ? String(value) : value.toFixed(2));

/** A4 invoice or estimate, printed or saved as PDF from the browser's print dialog. */
export default function InvoicePrint({ doc, office, taxLabel, paymentInstructions, paymentLinkTemplate, onClose }: Props) {
  const { t } = useI18n();
  useEffect(() => {
    const style = document.createElement("style");
    style.textContent = "@media print { @page { size: A4 portrait; margin: 0; } }";
    document.head.appendChild(style);
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    const title = document.title;
    // Browsers use the page title as the suggested PDF file name.
    document.title = `${doc.number} ${doc.customer_name}`;
    return () => { style.remove(); window.removeEventListener("keydown", onKey); document.title = title; };
  }, [onClose, doc]);

  const isInvoice = doc.kind === "invoice";
  const link = isInvoice && doc.balance > 0 ? paymentLink(paymentLinkTemplate, doc) : null;
  const contact = [office.address, office.phone, office.email, office.website].filter(Boolean);

  return createPortal(
    <div className="print-overlay">
      <div className="print-toolbar">
        <div><strong>{doc.number}</strong><span className="muted">{t("billing.printHint")}</span></div>
        <div>
          <button type="button" className="btn" onClick={onClose}>{t("common.close")}</button>
          <button type="button" className="btn btn-primary" onClick={() => window.print()}><Icon name="printer" size={16} />{t("print.print")}</button>
        </div>
      </div>
      <div className="print-stage">
        <section className="print-sheet invoice-sheet">
          <header className="invoice-head">
            <div className="invoice-brand">
              <img src={office.logoDataUrl || "/dbrepairs-icon.png"} alt="" />
              <div><strong>{office.companyName || "DBRepairs"}</strong>{contact.map((line) => <span key={line}>{line}</span>)}
                {office.taxNumber && <span>{t("settings.taxNumber")}: {office.taxNumber}</span>}</div>
            </div>
            <div className="invoice-title">
              <h1>{t(`billing.kind.${doc.kind}`)}</h1>
              <dl>
                <div><dt>{t("billing.number")}</dt><dd>{doc.number}</dd></div>
                <div><dt>{t("billing.issueDate")}</dt><dd>{formatPlainDate(doc.issue_date)}</dd></div>
                {doc.due_date && <div><dt>{isInvoice ? t("billing.dueDate") : t("billing.validUntil")}</dt><dd>{formatPlainDate(doc.due_date)}</dd></div>}
                {doc.repair_number && <div><dt>{t("repair.number")}</dt><dd>{doc.repair_number}</dd></div>}
              </dl>
            </div>
          </header>
          <div className="invoice-parties">
            <div><span className="invoice-label">{isInvoice ? t("billing.billTo") : t("billing.preparedFor")}</span>
              <strong>{doc.customer_company && doc.customer_type === "commercial" ? doc.customer_company : doc.customer_name}</strong>
              {doc.customer_type === "commercial" && doc.customer_contact && <span>{t("customer.contactPerson")}: {doc.customer_contact}</span>}
              {doc.customer_address && <span className="pre">{doc.customer_address}</span>}
              {[doc.customer_email, doc.customer_mobile || doc.customer_phone].filter(Boolean).map((line) => <span key={line}>{line}</span>)}
              {doc.customer_tax_number && <span>{t("customer.taxNumber")}: {doc.customer_tax_number}</span>}
            </div>
            {doc.state === "paid" && <div className="invoice-stamp paid">{t("billing.state.paid")}</div>}
            {doc.state === "void" && <div className="invoice-stamp void">{t("billing.state.void")}</div>}
            {doc.state === "approved" && <div className="invoice-stamp paid">{t("billing.state.approved")}</div>}
          </div>
          <table className="invoice-lines">
            <thead><tr><th>{t("billing.description")}</th><th className="num">{t("billing.quantity")}</th><th className="num">{t("billing.unitPrice")}</th><th className="num">{t("billing.amount")}</th></tr></thead>
            <tbody>{doc.lines.map((line, index) => (
              <tr key={line.id ?? index}><td className="pre">{line.description}{!line.taxable && doc.tax_rate > 0 ? " *" : ""}</td><td className="num">{quantityText(Number(line.quantity))}</td>
                <td className="num">{formatMoney(Number(line.unit_price))}</td><td className="num">{formatMoney(Number(line.amount))}</td></tr>
            ))}</tbody>
          </table>
          <div className="invoice-bottom">
            <div className="invoice-notes">
              {doc.lines.some((line) => !line.taxable) && doc.tax_rate > 0 && <p className="muted">* {fillTax(t("billing.notTaxed"), taxLabel)}</p>}
              {doc.notes && <p className="pre">{doc.notes}</p>}
              {isInvoice && paymentInstructions && doc.balance > 0 && <div><span className="invoice-label">{t("billing.howToPay")}</span><p className="pre">{paymentInstructions}</p></div>}
              {link && <p><span className="invoice-label">{t("billing.payOnline")}</span><br /><span className="invoice-link">{link}</span></p>}
            </div>
            <dl className="invoice-totals">
              <div><dt>{t("billing.subtotal")}</dt><dd>{formatMoney(doc.subtotal)}</dd></div>
              {doc.discount > 0 && <div><dt>{t("billing.discount")}</dt><dd>− {formatMoney(doc.discount)}</dd></div>}
              {doc.tax_rate > 0 && <div><dt>{taxLabel || t("billing.tax")} ({doc.tax_rate}%)</dt><dd>{formatMoney(doc.tax_amount)}</dd></div>}
              <div className="grand"><dt>{t("billing.total")}</dt><dd>{formatMoney(doc.total)}</dd></div>
              {isInvoice && doc.paid_amount > 0 && <div><dt>{t("billing.paid")}</dt><dd>− {formatMoney(doc.paid_amount)}</dd></div>}
              {isInvoice && doc.state !== "void" && <div className="grand"><dt>{t("billing.balanceDue")}</dt><dd>{formatMoney(Math.max(0, doc.balance))}</dd></div>}
            </dl>
          </div>
          {doc.terms && <p className="invoice-terms pre">{doc.terms}</p>}
          {!isInvoice && (
            <div className="invoice-signature">
              {doc.signature ? (
                <><img src={doc.signature.image} alt="" /><span>{doc.signature.signer_name} · {new Date(doc.signature.signed_at).toLocaleString()}</span></>
              ) : <><div className="signature-line" /><span>{t("billing.approvalSignature")}</span></>}
            </div>
          )}
          {office.terms && isInvoice && <p className="invoice-terms pre">{office.terms}</p>}
        </section>
      </div>
    </div>,
    document.body,
  );
}

function fillTax(template: string, label: string) {
  return template.replace("{tax}", label || "tax");
}
