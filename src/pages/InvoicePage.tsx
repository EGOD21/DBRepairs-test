import { useEffect, useMemo, useState } from "react";
import Icon from "../components/Icon";
import Menu from "../components/Menu";
import { DocStateBadge } from "../components/Badges";
import PaymentModal from "../components/PaymentModal";
import ApproveModal from "../components/ApproveModal";
import InvoicePrint from "../print/InvoicePrint";
import { officeFromSettings } from "../print/data";
import {
  computeTotals, convertEstimate, deleteInvoice, deletePayment, getInvoice, InvoiceDetail, InvoiceLine, LineKind, lineKinds, listTime,
  paymentLink, setInvoiceStatus, updateInvoice,
} from "../data/billing";
import { listRepairParts } from "../data/parts";
import { listRepairsByCustomer, Repair } from "../data/repairs";
import { AppSettings, emptySettings, getSettings } from "../data/settings";
import { fill, formatMinutes, formatMoney, formatPlainDate } from "../lib/format";
import { mailtoLink } from "../lib/email";
import { emailSignature } from "../lib/emailTemplates";
import { useI18n } from "../i18n/I18nProvider";
import { useSession } from "../session";
import { href, navigate } from "../router";

type LineForm = Omit<InvoiceLine, "quantity" | "unit_price"> & { quantity: string; unit_price: string; key: number };
type Form = { repair_id: number | null; issue_date: string; due_date: string; tax_rate: string; discount: string; notes: string; terms: string; lines: LineForm[] };

let lineKey = 0;
const toLineForm = (line: InvoiceLine): LineForm => ({ ...line, quantity: String(Number(line.quantity)), unit_price: String(Number(line.unit_price)), key: ++lineKey });
const toForm = (doc: InvoiceDetail): Form => ({
  repair_id: doc.repair_id, issue_date: doc.issue_date, due_date: doc.due_date ?? "", tax_rate: String(Number(doc.tax_rate)), discount: String(Number(doc.discount)),
  notes: doc.notes ?? "", terms: doc.terms ?? "", lines: doc.lines.map(toLineForm),
});
const comparable = (form: Form) => JSON.stringify({ ...form, lines: form.lines.map(({ key: _key, id: _id, amount: _amount, ...line }) => line) });

export default function InvoicePage({ id }: { id: number }) {
  const { t } = useI18n();
  const { isAdmin } = useSession();
  const [doc, setDoc] = useState<InvoiceDetail | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [saved, setSaved] = useState("");
  const [settings, setSettings] = useState<AppSettings>(emptySettings);
  const [repairs, setRepairs] = useState<Repair[]>([]);
  const [notice, setNotice] = useState<{ tone: "error" | "success"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState<"payment" | "approve" | "print" | null>(null);
  const [missing, setMissing] = useState(false);

  function apply(next: InvoiceDetail) {
    const nextForm = toForm(next);
    setDoc(next); setForm(nextForm); setSaved(comparable(nextForm));
  }

  useEffect(() => {
    getInvoice(id).then((next) => {
      apply(next);
      return listRepairsByCustomer(next.customer_id).then(setRepairs);
    }).catch((cause) => { if (cause instanceof Error && cause.message === "Not found") setMissing(true); else setNotice({ tone: "error", text: t("common.databaseError") }); });
    getSettings().then(setSettings).catch(() => {});
  }, [id]);

  const dirty = Boolean(form && comparable(form) !== saved);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const totals = useMemo(() => form ? computeTotals(form.lines.map((line) => ({ ...line, quantity: Number(line.quantity), unit_price: Number(line.unit_price) })),
    Number(form.tax_rate), Number(form.discount)) : null, [form]);

  if (missing) return <div className="page"><a className="back-link" href={href({ name: "billing" })}><Icon name="back" size={15} />{t("nav.billing")}</a><div className="empty"><strong>{t("billing.notFound")}</strong></div></div>;
  if (!doc || !form || !totals) return <div className="page"><div className="empty">{notice?.text ?? t("common.loading")}</div></div>;

  const isInvoice = doc.kind === "invoice";
  const readOnly = doc.status === "void" || (!isInvoice && ["approved", "converted"].includes(doc.status));
  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm((current) => current ? { ...current, [key]: value } : current);
  const setLine = (key: number, patch: Partial<LineForm>) => set("lines", form.lines.map((line) => (line.key === key ? { ...line, ...patch } : line)));
  const addLines = (lines: InvoiceLine[]) => set("lines", [...form.lines, ...lines.map(toLineForm)]);
  const hourlyRate = Number(settings["billing.hourlyRate"]) || 0;

  async function run(action: () => Promise<InvoiceDetail | void>, success?: string) {
    setBusy(true); setNotice(null);
    try {
      const next = await action();
      if (next) apply(next);
      if (success) setNotice({ tone: "success", text: success });
    } catch (cause) {
      setNotice({ tone: "error", text: cause instanceof Error ? cause.message : t("common.saveError") });
    } finally {
      setBusy(false);
    }
  }

  const save = () => run(() => updateInvoice(doc.id, {
    customer_id: doc.customer_id, repair_id: form.repair_id, issue_date: form.issue_date, due_date: form.due_date || null,
    tax_rate: Number(form.tax_rate) || 0, discount: Number(form.discount) || 0, notes: form.notes, terms: form.terms,
    lines: form.lines.map(({ key: _key, ...line }) => ({ ...line, quantity: Number(line.quantity) || 0, unit_price: Number(line.unit_price) || 0 })),
  }), t("common.saved"));

  async function addUnbilledTime() {
    const used = new Set(form!.lines.flatMap((line) => line.time_entry_ids));
    const entries = (await listTime({ customerId: doc!.customer_id, unbilled: true })).filter((entry) => !used.has(entry.id) && (!form!.repair_id || entry.repair_id === form!.repair_id));
    if (!entries.length) { setNotice({ tone: "success", text: t("billing.noUnbilledTime") }); return; }
    addLines(entries.map((entry) => ({
      kind: "labor", description: [`${t("billing.labor")} ${formatPlainDate(entry.work_date)}`, entry.technician, entry.description].filter(Boolean).join(" — "),
      quantity: Math.round((entry.minutes / 60) * 100) / 100, unit_price: entry.hourly_rate ?? hourlyRate, taxable: true, time_entry_ids: [entry.id],
    })));
  }

  async function addParts() {
    if (!form!.repair_id) return;
    const used = new Set(form!.lines.map((line) => line.repair_part_id).filter(Boolean));
    const parts = (await listRepairParts(form!.repair_id)).filter((part) => part.status !== "cancelled" && !used.has(part.id));
    if (!parts.length) { setNotice({ tone: "success", text: t("billing.noParts") }); return; }
    addLines(parts.map((part) => ({ kind: "part", description: [part.name, part.part_number].filter(Boolean).join(" · "), quantity: part.quantity,
      unit_price: part.unit_cost ?? 0, taxable: true, repair_part_id: part.id, time_entry_ids: [] })));
  }

  const firstName = (doc.customer_type === "commercial" ? doc.customer_contact : doc.customer_name)?.split(/\s+/)[0] ?? "";
  const link = isInvoice ? paymentLink(settings["billing.paymentLink"], doc) : null;
  const emailHref = mailtoLink(doc.customer_email,
    fill(t(isInvoice ? "billing.email.invoiceSubject" : "billing.email.estimateSubject"), { number: doc.number, company: settings["office.companyName"] || "DBRepairs" }),
    fill(t(isInvoice ? "billing.email.invoiceBody" : "billing.email.estimateBody"), {
      name: firstName, number: doc.number, total: formatMoney(doc.total), balance: formatMoney(Math.max(0, doc.balance)), due: formatPlainDate(doc.due_date),
      link: link ? `\n${t("billing.payOnline")}: ${link}\n` : "", instructions: isInvoice && settings["billing.paymentInstructions"] ? `\n${settings["billing.paymentInstructions"]}\n` : "",
      signature: emailSignature(settings),
    }));

  return (
    <div className="page">
      <a className="back-link" href={href({ name: "billing", tab: isInvoice ? undefined : "estimates" })}><Icon name="back" size={15} />{t("nav.billing")}</a>
      <header className="page-header">
        <div>
          <div className="title-row"><h1>{doc.number}</h1><span className="badge">{t(`billing.kind.${doc.kind}`)}</span><DocStateBadge state={doc.state} /></div>
          <p><a href={href({ name: "customer", id: doc.customer_id })}>{doc.customer_name}</a>
            {doc.repair_id && <> · <a href={href({ name: "repair", id: doc.repair_id })}>{doc.repair_number}</a></>}
            {doc.converted_to && <> · <a href={href({ name: "invoice", id: doc.converted_to })}>{t("billing.viewInvoice")}</a></>}</p>
        </div>
        <div className="page-actions">
          <button type="button" className="btn" onClick={() => setDialog("print")} disabled={dirty} title={dirty ? t("billing.saveFirst") : undefined}><Icon name="printer" size={16} />{t("print.print")}</button>
          {doc.customer_email ? <a className="btn" href={emailHref} onClick={() => { if (doc.status === "draft") void run(() => setInvoiceStatus(doc.id, "sent")); }}><Icon name="mail" size={16} />{t("email.send")}</a>
            : <button type="button" className="btn" disabled title={t("email.noAddress")}><Icon name="mail" size={16} />{t("email.send")}</button>}
          {isInvoice && doc.state !== "void" && doc.balance > 0 && <button type="button" className="btn" disabled={dirty || busy} onClick={() => setDialog("payment")}><Icon name="receipt" size={16} />{t("billing.recordPayment")}</button>}
          {!isInvoice && !readOnly && <button type="button" className="btn" disabled={dirty || busy} onClick={() => setDialog("approve")}><Icon name="pencil" size={16} />{t("billing.getApproval")}</button>}
          {!isInvoice && doc.status === "approved" && <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void run(async () => { const next = await convertEstimate(doc.id); navigate({ name: "invoice", id: next.id }); })}><Icon name="receipt" size={16} />{t("billing.convert")}</button>}
          <Menu label={t("common.more")} variant="btn">{(close) => (<>
            {doc.status === "draft" && <button type="button" onClick={() => { close(); void run(() => setInvoiceStatus(doc.id, "sent")); }}><Icon name="mail" size={16} /><span>{t("billing.markSent")}</span></button>}
            {doc.status === "sent" && <button type="button" onClick={() => { close(); void run(() => setInvoiceStatus(doc.id, "draft")); }}><Icon name="pencil" size={16} /><span>{t("billing.backToDraft")}</span></button>}
            {!isInvoice && ["draft", "sent"].includes(doc.status) && <button type="button" onClick={() => { close(); void run(() => setInvoiceStatus(doc.id, "declined")); }}><Icon name="x" size={16} /><span>{t("billing.markDeclined")}</span></button>}
            {!isInvoice && doc.status !== "converted" && doc.status !== "approved" && <button type="button" onClick={() => { close(); if (window.confirm(t("billing.convertUnsignedConfirm"))) void run(async () => { const next = await convertEstimate(doc.id); navigate({ name: "invoice", id: next.id }); }); }}><Icon name="receipt" size={16} /><span>{t("billing.convert")}</span></button>}
            {isInvoice && isAdmin && doc.status !== "void" && <button type="button" onClick={() => { close(); if (window.confirm(t("billing.voidConfirm"))) void run(() => setInvoiceStatus(doc.id, "void")); }}><Icon name="x" size={16} /><span>{t("billing.void")}</span></button>}
            {doc.payments.length === 0 && (isAdmin || doc.status === "draft" || !isInvoice) && <button type="button" onClick={() => { close(); if (window.confirm(fill(t("billing.deleteConfirm"), { number: doc.number }))) void run(async () => { await deleteInvoice(doc.id); navigate({ name: "billing" }); }); }}><Icon name="trash" size={16} /><span>{t("common.delete")}</span></button>}
          </>)}</Menu>
          {!readOnly && <button type="button" className="btn btn-primary" disabled={!dirty || busy} onClick={() => void save()}>{busy ? t("common.saving") : t("common.saveChanges")}</button>}
        </div>
      </header>
      {notice && <div className={`alert ${notice.tone}`} role="status">{notice.text}</div>}
      {readOnly && <div className="alert warning">{doc.status === "void" ? t("billing.voidNotice") : t("billing.lockedNotice")}</div>}

      <div className="detail-grid">
        <div className="detail-main">
          <section className="card">
            <div className="card-header"><h2>{t("billing.lines")}</h2>
              {!readOnly && <div className="card-actions">
                <button type="button" className="btn btn-sm" onClick={() => addLines([{ kind: "service", description: "", quantity: 1, unit_price: 0, taxable: true, time_entry_ids: [] }])}><Icon name="plus" size={15} />{t("billing.addLine")}</button>
                <button type="button" className="btn btn-sm" onClick={() => addLines([{ kind: "labor", description: t("billing.labor"), quantity: 1, unit_price: hourlyRate, taxable: true, time_entry_ids: [] }])}><Icon name="clock" size={15} />{t("billing.addLabor")}</button>
                {isInvoice && <button type="button" className="btn btn-sm" onClick={() => void addUnbilledTime()}><Icon name="clock" size={15} />{t("billing.addUnbilled")}</button>}
                {form.repair_id && <button type="button" className="btn btn-sm" onClick={() => void addParts()}><Icon name="package" size={15} />{t("billing.addParts")}</button>}
              </div>}
            </div>
            <div className="card-body">
              {form.lines.length === 0 ? <p className="muted">{t("billing.noLines")}</p> : (
                <div className="line-editor">
                  <div className="line-row line-head"><span>{t("billing.description")}</span><span>{t("billing.lineKind")}</span><span className="num">{t("billing.quantity")}</span><span className="num">{t("billing.unitPrice")}</span><span>{t("billing.taxable")}</span><span className="num">{t("billing.amount")}</span><span /></div>
                  {form.lines.map((line, index) => (
                    <div className="line-row" key={line.key}>
                      <textarea rows={1} className="input" value={line.description} disabled={readOnly} placeholder={t("billing.description")} aria-label={t("billing.description")}
                        onChange={(e) => setLine(line.key, { description: e.target.value })} />
                      <select className="input" value={line.kind} disabled={readOnly} onChange={(e) => setLine(line.key, { kind: e.target.value as LineKind })} aria-label={t("billing.lineKind")}>
                        {lineKinds.map((kind) => <option key={kind} value={kind}>{t(`billing.line.${kind}`)}</option>)}</select>
                      <input className="input num" type="number" step="0.01" min="0" inputMode="decimal" value={line.quantity} disabled={readOnly} onChange={(e) => setLine(line.key, { quantity: e.target.value })} aria-label={t("billing.quantity")} />
                      <input className="input num" type="number" step="0.01" inputMode="decimal" value={line.unit_price} disabled={readOnly} onChange={(e) => setLine(line.key, { unit_price: e.target.value })} aria-label={t("billing.unitPrice")} />
                      <label className="check"><input type="checkbox" checked={line.taxable} disabled={readOnly} onChange={(e) => setLine(line.key, { taxable: e.target.checked })} /><span className="show-mobile-inline">{t("billing.taxable")}</span></label>
                      <span className="num line-amount">{formatMoney(totals.amounts[index])}{line.time_entry_ids.length > 0 && <small className="muted"> · {t("billing.linkedTime")}</small>}</span>
                      {!readOnly ? <button type="button" className="btn btn-sm btn-icon btn-ghost" onClick={() => set("lines", form.lines.filter((item) => item.key !== line.key))} aria-label={t("common.delete")}><Icon name="trash" size={14} /></button> : <span />}
                    </div>
                  ))}
                </div>
              )}
              <div className="invoice-summary">
                <div className="form-grid">
                  <label className="field"><span>{t("billing.discount")}</span><input type="number" min="0" step="0.01" value={form.discount} disabled={readOnly} onChange={(e) => set("discount", e.target.value)} /></label>
                  <label className="field"><span>{(settings["billing.taxLabel"] || t("billing.tax"))} %</span><input type="number" min="0" max="100" step="0.001" value={form.tax_rate} disabled={readOnly} onChange={(e) => set("tax_rate", e.target.value)} /></label>
                </div>
                <div className="money-summary">
                  <div><span className="muted">{t("billing.subtotal")}</span><span>{formatMoney(totals.subtotal)}</span></div>
                  {totals.discount > 0 && <div><span className="muted">{t("billing.discount")}</span><span>− {formatMoney(totals.discount)}</span></div>}
                  <div><span className="muted">{settings["billing.taxLabel"] || t("billing.tax")}</span><span>{formatMoney(totals.taxAmount)}</span></div>
                  <div className="total"><span>{t("billing.total")}</span><span>{formatMoney(totals.total)}</span></div>
                  {isInvoice && doc.paid_amount > 0 && <div><span className="muted">{t("billing.paid")}</span><span>− {formatMoney(doc.paid_amount)}</span></div>}
                  {isInvoice && <div className="total"><span>{t("billing.balanceDue")}</span><span>{formatMoney(totals.total - doc.paid_amount)}</span></div>}
                </div>
              </div>
            </div>
          </section>
          <section className="card">
            <div className="card-header"><h2>{t("billing.notesAndTerms")}</h2></div>
            <div className="card-body form-grid">
              <label className="field full"><span>{t("billing.notes")}</span><textarea rows={3} value={form.notes} disabled={readOnly} onChange={(e) => set("notes", e.target.value)} placeholder={t("billing.notesPlaceholder")} /></label>
              <label className="field full"><span>{t("billing.terms")}</span><textarea rows={3} value={form.terms} disabled={readOnly} onChange={(e) => set("terms", e.target.value)} /></label>
            </div>
          </section>
        </div>
        <div className="detail-side">
          <section className="card">
            <div className="card-header"><h2>{t("billing.details")}</h2></div>
            <div className="card-body form-grid" style={{ gridTemplateColumns: "1fr" }}>
              <label className="field"><span>{t("billing.issueDate")}</span><input type="date" value={form.issue_date} disabled={readOnly} onChange={(e) => set("issue_date", e.target.value)} /></label>
              <label className="field"><span>{isInvoice ? t("billing.dueDate") : t("billing.validUntil")}</span><input type="date" value={form.due_date} disabled={readOnly} onChange={(e) => set("due_date", e.target.value)} /></label>
              <label className="field"><span>{t("repair.number")}</span>
                <select value={form.repair_id ?? ""} disabled={readOnly} onChange={(e) => set("repair_id", e.target.value ? Number(e.target.value) : null)}>
                  <option value="">{t("billing.noRepair")}</option>
                  {repairs.map((repair) => <option key={repair.id} value={repair.id}>{repair.repair_number} · {[repair.brand, repair.model].filter(Boolean).join(" ") || repair.device_type || ""}</option>)}
                </select></label>
            </div>
          </section>
          {isInvoice && (
            <section className="card">
              <div className="card-header"><h2>{t("billing.payments")}</h2></div>
              <div className="card-body">
                {doc.payments.length === 0 ? <p className="muted">{t("billing.noPayments")}</p> : (
                  <div className="payment-list">{doc.payments.map((payment) => (
                    <div key={payment.id} className="payment-item">
                      <div><strong>{formatMoney(payment.amount)}</strong><span className="muted"> · {t(`billing.method.${payment.method}`)}</span></div>
                      <small className="muted">{formatPlainDate(payment.paid_at)}{payment.reference ? ` · ${payment.reference}` : ""}{payment.created_by_name ? ` · ${payment.created_by_name}` : ""}</small>
                      {payment.note && <small>{payment.note}</small>}
                      {isAdmin && <button type="button" className="btn btn-sm btn-icon btn-ghost" aria-label={t("common.delete")}
                        onClick={() => { if (window.confirm(t("billing.deletePaymentConfirm"))) void run(async () => { await deletePayment(payment.id); return getInvoice(doc.id); }); }}><Icon name="trash" size={14} /></button>}
                    </div>
                  ))}</div>
                )}
                {link && doc.balance > 0 && <p className="hint" style={{ marginTop: 12 }}>{t("billing.payOnline")}: <a href={link} target="_blank" rel="noopener noreferrer">{link}</a></p>}
              </div>
            </section>
          )}
          {!isInvoice && (
            <section className="card">
              <div className="card-header"><h2>{t("billing.approval")}</h2></div>
              <div className="card-body">
                {doc.signature ? (
                  <div className="signature-view"><img src={doc.signature.image} alt="" /><span>{doc.signature.signer_name} · {new Date(doc.signature.signed_at).toLocaleString()}</span></div>
                ) : <p className="muted">{doc.status === "declined" ? t("billing.state.declined") : t("billing.notApproved")}</p>}
              </div>
            </section>
          )}
          {doc.time_entries.length > 0 && (
            <section className="card">
              <div className="card-header"><h2>{t("billing.linkedTimeTitle")}</h2></div>
              <div className="card-body"><div className="payment-list">{doc.time_entries.map((entry) => (
                <div key={entry.id} className="payment-item"><div><strong>{formatMinutes(entry.minutes)}</strong><span className="muted"> · {entry.technician}</span></div>
                  <small className="muted">{formatPlainDate(entry.work_date)}{entry.description ? ` · ${entry.description}` : ""}</small></div>
              ))}</div></div>
            </section>
          )}
        </div>
      </div>
      {dialog === "payment" && <PaymentModal doc={doc} onClose={() => setDialog(null)} onSaved={(next) => { apply(next); setDialog(null); }} />}
      {dialog === "approve" && <ApproveModal doc={doc} onClose={() => setDialog(null)} onSaved={(next) => { apply(next); setDialog(null); }} />}
      {dialog === "print" && <InvoicePrint doc={doc} office={officeFromSettings(settings)} taxLabel={settings["billing.taxLabel"]} paymentInstructions={settings["billing.paymentInstructions"]}
        paymentLinkTemplate={settings["billing.paymentLink"]} onClose={() => setDialog(null)} />}
    </div>
  );
}
