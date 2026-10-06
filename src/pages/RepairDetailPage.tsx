import { useEffect, useMemo, useState } from "react";
import Icon from "../components/Icon";
import Menu from "../components/Menu";
import { PriorityBadge, StatusBadge } from "../components/Badges";
import PartsEditor from "../components/PartsEditor";
import PrintCenter from "../print/PrintCenter";
import { officeFromSettings, takeAutoPrint, toPrintData } from "../print/data";
import { defaultLabelSize, TicketKind } from "../print/types";
import { Customer, listCustomers } from "../data/customers";
import {
  deleteRepair, getRepair, isClosed, isOverdue, listRepairStatusHistory, listStatuses, priorities, Repair, RepairStatus,
  RepairStatusHistory, RepairUpdateInput, toUpdateInput, updateRepair,
} from "../data/repairs";
import { AppSettings, emptySettings, getSettings } from "../data/settings";
import { formatDbDate, parseDbDate } from "../data/dates";
import { fill, formatMoney, formatPlainDate } from "../lib/format";
import { repairEmail, repairEmailTemplates } from "../lib/emailTemplates";
import { telLink } from "../lib/email";
import { useI18n } from "../i18n/I18nProvider";
import { href, navigate } from "../router";

export default function RepairDetailPage({ id }: { id: number }) {
  const { t } = useI18n();
  const [repair, setRepair] = useState<Repair | null>(null);
  const [form, setForm] = useState<RepairUpdateInput | null>(null);
  const [statuses, setStatuses] = useState<RepairStatus[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [history, setHistory] = useState<RepairStatusHistory[]>([]);
  const [settings, setSettings] = useState<AppSettings>(emptySettings);
  const [statusNote, setStatusNote] = useState("");
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ tone: "error" | "success"; text: string } | null>(null);
  const [printing, setPrinting] = useState<{ kind: TicketKind; auto: boolean } | null>(null);

  async function load() {
    const [r, h] = await Promise.all([getRepair(id), listRepairStatusHistory(id)]);
    if (!r) { setNotFound(true); return; }
    setRepair(r);
    setForm(toUpdateInput(r));
    setHistory(h);
    setStatusNote("");
  }

  useEffect(() => {
    Promise.all([load(), listStatuses().then(setStatuses), listCustomers().then(setCustomers), getSettings().then(setSettings)])
      .then(() => {
        const pending = takeAutoPrint(id);
        if (pending) setPrinting({ kind: pending, auto: true });
      })
      .catch((cause) => { console.error(cause); setMessage({ tone: "error", text: t("common.databaseError") }); })
      .finally(() => setLoading(false));
  }, [id]);

  const dirty = useMemo(() => Boolean(repair && form && JSON.stringify(toUpdateInput(repair)) !== JSON.stringify(form)), [repair, form]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  if (loading) return <div className="page"><div className="empty">{t("common.loading")}</div></div>;
  if (notFound || !repair || !form) {
    return <div className="page"><a className="back-link" href={href({ name: "repairs" })}><Icon name="back" size={15} />{t("nav.repairs")}</a><div className="empty"><strong>{t("repair.notFound")}</strong></div></div>;
  }

  const set = <K extends keyof RepairUpdateInput>(key: K, value: RepairUpdateInput[K]) => { setMessage(null); setForm((f) => (f ? { ...f, [key]: value } : f)); };
  const overdue = isOverdue(repair);
  const statusChanged = form.status_id !== repair.status_id;
  const phone = repair.customer_mobile || repair.customer_phone;
  const finalValue = Number(form.final_value || form.estimated_value || 0);
  const deposit = Number(form.deposit || 0);
  const balance = Math.max(0, finalValue - deposit);
  const warrantyEnds = repair.closed_at && form.warranty_days ? (() => {
    const date = parseDbDate(repair.closed_at);
    date.setDate(date.getDate() + Number(form.warranty_days));
    return date;
  })() : null;

  async function save() {
    if (!form || !form.reported_fault.trim() || saving) return;
    setSaving(true); setMessage(null);
    try {
      await updateRepair(id, form, statusNote);
      await load();
      setMessage({ tone: "success", text: t("common.saved") });
    } catch (cause) {
      console.error(cause);
      setMessage({ tone: "error", text: cause instanceof Error && cause.message ? cause.message : t("common.saveError") });
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!repair || !window.confirm(fill(t("repair.deleteConfirm"), { number: repair.repair_number }))) return;
    try {
      await deleteRepair(repair.id);
      navigate({ name: "repairs" });
    } catch (cause) {
      console.error(cause);
      setMessage({ tone: "error", text: t("repair.deleteError") });
    }
  }

  const field = (key: keyof RepairUpdateInput, label: string, props: Record<string, unknown> = {}) => (
    <label className="field"><span>{label}</span><input value={String(form[key] ?? "")} onChange={(e) => set(key, e.target.value as never)} {...props} /></label>
  );
  const area = (key: keyof RepairUpdateInput, label: string, rows = 3, full = true) => (
    <label className={`field${full ? " full" : ""}`}><span>{label}</span><textarea rows={rows} value={String(form[key] ?? "")} onChange={(e) => set(key, e.target.value as never)} /></label>
  );

  return (
    <div className="page">
      <a className="back-link" href={href({ name: "repairs" })}><Icon name="back" size={15} />{t("nav.repairs")}</a>
      <header className="page-header">
        <div>
          <div className="title-row">
            <h1>{repair.repair_number}</h1>
            <StatusBadge code={repair.status_code} labelKey={repair.status_label_key} />
            <PriorityBadge priority={repair.priority} quiet />
            {overdue && <span className="badge danger"><Icon name="alert" size={12} />{t("repair.overdue")}</span>}
            {repair.paid && <span className="badge success">{t("repair.paid")}</span>}
          </div>
          <p><a href={href({ name: "customer", id: repair.customer_id })}>{repair.customer_name}</a> · {t("repair.openedAt")} {formatDbDate(repair.opened_at)}</p>
        </div>
        <div className="page-actions">
          <Menu label={t("print.print")} icon="printer">{(close) => (<>
            <button type="button" onClick={() => { close(); setPrinting({ kind: "intake", auto: false }); }}><Icon name="file" size={16} /><span>{t("print.kind.intake")}<small>{t("print.kind.intakeHint")}</small></span></button>
            <button type="button" onClick={() => { close(); setPrinting({ kind: "label", auto: false }); }}><Icon name="barcode" size={16} /><span>{t("print.kind.label")}<small>{t("print.kind.labelHint")}</small></span></button>
            <button type="button" onClick={() => { close(); setPrinting({ kind: "receipt", auto: false }); }}><Icon name="receipt" size={16} /><span>{t("print.kind.receipt")}<small>{t("print.kind.receiptHint")}</small></span></button>
          </>)}</Menu>
          {repair.customer_email ? (
            <Menu label={t("email.customer")} icon="mail">{(close) => (<>
              {repairEmailTemplates.map((template) => (
                <a key={template} href={repairEmail(template, repair, settings, t)} onClick={close}><Icon name="mail" size={16} /><span>{t(`email.${template}.label`)}</span></a>
              ))}
            </>)}</Menu>
          ) : <button type="button" className="btn" disabled title={t("email.noAddress")}><Icon name="mail" size={16} />{t("email.customer")}</button>}
          {phone && <a className="btn btn-icon" href={telLink(phone)} title={`${t("customer.call")} ${phone}`} aria-label={t("customer.call")}><Icon name="phone" size={16} /></a>}
          <button type="button" className="btn btn-danger" onClick={() => void remove()}><Icon name="trash" size={16} />{t("common.delete")}</button>
          <button type="button" className="btn btn-primary" onClick={() => void save()} disabled={!dirty || saving || !form.reported_fault.trim()}>{saving ? t("common.saving") : t("common.saveChanges")}</button>
        </div>
      </header>

      {message && <div className={`alert ${message.tone}`}>{message.text}</div>}

      <div className="detail-grid">
        <div className="detail-main">
          <section className="card">
            <div className="card-header"><h2>{t("repair.section.device")}</h2></div>
            <div className="card-body form-grid">
              {field("device_type", t("repair.deviceType"))}
              {field("brand", t("repair.brand"))}
              {field("model", t("repair.model"))}
              {field("serial_number", t("repair.serialNumber"))}
              {field("imei", t("repair.imei"))}
              {field("accessories", t("repair.accessories"))}
              {area("reported_fault", `${t("repair.reportedFault")} *`)}
              {area("general_condition", t("repair.generalCondition"), 2)}
            </div>
          </section>
          <section className="card">
            <div className="card-header"><h2>{t("repair.section.work")}</h2></div>
            <div className="card-body form-grid">
              {area("diagnosis", t("repair.diagnosis"))}
              {area("work_performed", t("repair.workPerformed"))}
              {area("internal_notes", t("repair.internalNotes"), 2)}
            </div>
          </section>
          <PartsEditor repairId={repair.id} onChange={() => { void getRepair(id).then((r) => r && setRepair((current) => current ? { ...current, parts_pending: r.parts_pending } : r)); }} />
        </div>

        <div className="detail-side">
          <section className="card">
            <div className="card-header"><h2>{t("repair.section.workflow")}</h2></div>
            <div className="card-body form-grid" style={{ gridTemplateColumns: "1fr" }}>
              <label className="field"><span>{t("repair.status")}</span><select value={form.status_id} onChange={(e) => set("status_id", Number(e.target.value))}>{statuses.map((s) => <option key={s.id} value={s.id}>{t(s.label_key)}</option>)}</select></label>
              {statusChanged && <label className="field"><span>{t("repair.statusNote")}</span><input value={statusNote} onChange={(e) => setStatusNote(e.target.value)} placeholder={t("repair.statusNotePlaceholder")} /><small>{t("repair.statusNoteHint")}</small></label>}
              <label className="field"><span>{t("repair.priority")}</span><select value={form.priority} onChange={(e) => set("priority", e.target.value as RepairUpdateInput["priority"])}>{priorities.map((p) => <option key={p} value={p}>{t(`priority.${p}`)}</option>)}</select></label>
              <label className="field"><span>{t("repair.dueDate")}</span><input type="date" value={form.due_date} onChange={(e) => set("due_date", e.target.value)} /></label>
              {field("technician", t("repair.technician"))}
              <label className="field"><span>{t("repair.customer")}</span><select value={form.customer_id} onChange={(e) => set("customer_id", Number(e.target.value))}>{customers.map((c) => <option key={c.id} value={c.id}>{c.name}{c.company ? ` — ${c.company}` : ""}</option>)}</select></label>
            </div>
          </section>
          <section className="card">
            <div className="card-header"><h2>{t("repair.section.billing")}</h2></div>
            <div className="card-body form-grid">
              {field("estimated_value", t("repair.estimatedValue"), { type: "number", step: "0.01", min: "0" })}
              {field("final_value", t("repair.finalValue"), { type: "number", step: "0.01", min: "0" })}
              {field("deposit", t("repair.deposit"), { type: "number", step: "0.01", min: "0" })}
              {field("warranty_days", t("repair.warrantyDays"), { type: "number", step: "1", min: "0" })}
              <label className="check full"><input type="checkbox" checked={form.paid} onChange={(e) => set("paid", e.target.checked)} />{t("repair.paidInFull")}</label>
              <div className="money-summary full">
                <div><span className="muted">{t("repair.total")}</span><span>{formatMoney(finalValue)}</span></div>
                <div><span className="muted">{t("repair.deposit")}</span><span>− {formatMoney(deposit)}</span></div>
                <div className="total"><span>{t("repair.balanceDue")}</span><span>{form.paid ? formatMoney(0) : formatMoney(balance)}</span></div>
                {warrantyEnds && <div><span className="muted">{t("repair.warrantyUntil")}</span><span>{warrantyEnds.toLocaleDateString()}</span></div>}
              </div>
            </div>
          </section>
          <section className="card">
            <div className="card-header"><h2>{t("repair.history")}</h2></div>
            <div className="card-body">
              {history.length === 0 ? <p className="muted">{t("repair.historyEmpty")}</p> : (
                <div className="timeline">{history.map((h) => (
                  <div className="timeline-item" key={h.id}><strong>{t(h.status_label_key)}</strong><span>{formatDbDate(h.changed_at)}</span>{h.note && <p>{h.note}</p>}</div>
                ))}</div>
              )}
              {repair.due_date && <p className="muted" style={{ marginTop: 14, fontSize: 12 }}>{t("repair.dueDate")}: {formatPlainDate(repair.due_date)}{isClosed(repair) ? "" : overdue ? ` · ${t("repair.overdue")}` : ""}</p>}
            </div>
          </section>
        </div>
      </div>

      {printing && (
        <PrintCenter data={toPrintData(repair)} office={officeFromSettings(settings)} initialKind={printing.kind}
          labelSize={settings["print.labelSize"] || defaultLabelSize} autoPrint={printing.auto} onClose={() => setPrinting(null)} />
      )}
    </div>
  );
}
