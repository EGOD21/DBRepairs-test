import { useEffect, useState } from "react";
import Icon from "./Icon";
import Modal from "./Modal";
import { DocStateBadge } from "./Badges";
import { Contract, ContractInput, contractUsage, ContractUsage, createContract, deleteContract, invoiceContract, listContracts, monthOf, updateContract } from "../data/contracts";
import { fill, formatMinutes, formatMoney, formatPlainDate, todayIso } from "../lib/format";
import { useI18n } from "../i18n/I18nProvider";
import { useSession } from "../session";
import { href, navigate } from "../router";

const blank = (customerId: number): ContractInput => ({
  customer_id: customerId, name: "", monthly_fee: "", hours_included: "", overage_rate: "", response_hours: "", start_date: todayIso(),
  renewal_date: "", billing_day: "1", auto_invoice: false, active: true, notes: "",
});
const toInput = (c: Contract): ContractInput => ({
  customer_id: c.customer_id, name: c.name, monthly_fee: String(c.monthly_fee), hours_included: String(c.hours_included), overage_rate: c.overage_rate?.toString() ?? "",
  response_hours: c.response_hours?.toString() ?? "", start_date: c.start_date, renewal_date: c.renewal_date ?? "", billing_day: String(c.billing_day),
  auto_invoice: c.auto_invoice, active: c.active, notes: c.notes ?? "",
});

/** A bar showing hours used against hours included; turns amber at 80% and red over 100%. */
export function UsageMeter({ minutes, hoursIncluded }: { minutes: number; hoursIncluded: number }) {
  const { t } = useI18n();
  if (!hoursIncluded) return <span className="muted">{formatMinutes(minutes)} {t("contract.thisMonth")}</span>;
  const percent = Math.round((minutes / 60 / hoursIncluded) * 100);
  const tone = percent > 100 ? "danger" : percent >= 80 ? "warning" : "";
  return (
    <div className={`usage-meter ${tone}`} title={`${percent}%`}>
      <div className="usage-track"><div style={{ width: `${Math.min(100, percent)}%` }} /></div>
      <span>{fill(t("contract.usage"), { used: formatMinutes(minutes), included: `${hoursIncluded} h` })}{percent > 100 && <strong> · {t("contract.over")}</strong>}</span>
    </div>
  );
}

export default function ContractsCard({ customerId, onChange }: { customerId: number; onChange?: () => void }) {
  const { t } = useI18n();
  const { isAdmin } = useSession();
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [editing, setEditing] = useState<Contract | "new" | null>(null);
  const [usageFor, setUsageFor] = useState<Contract | null>(null);
  const [error, setError] = useState("");

  const load = () => listContracts({ customerId }).then(setContracts).catch(() => setError(t("common.databaseError")));
  useEffect(() => { void load(); }, [customerId]);

  return (
    <section className="card">
      <div className="card-header">
        <div><h2>{t("contract.title")}</h2><p>{t("contract.hint")}</p></div>
        {isAdmin && <button type="button" className="btn btn-sm" onClick={() => setEditing("new")}><Icon name="plus" size={15} />{t("contract.add")}</button>}
      </div>
      {error && <div className="card-body"><div className="alert error">{error}</div></div>}
      {contracts.length === 0 ? <div className="empty">{t("contract.empty")}</div> : (
        <div className="contract-list">{contracts.map((contract) => (
          <div key={contract.id} className={`contract-item${contract.active ? "" : " inactive"}`}>
            <div className="contract-head">
              <strong>{contract.name}</strong>
              {!contract.active && <span className="badge">{t("contract.inactive")}</span>}
              {contract.response_hours && <span className="badge accent"><Icon name="clock" size={11} />{fill(t("contract.responseBadge"), { hours: contract.response_hours })}</span>}
              <span className="contract-fee">{formatMoney(contract.monthly_fee)}<small className="muted"> / {t("contract.month")}</small></span>
            </div>
            <UsageMeter minutes={contract.minutes_this_month} hoursIncluded={contract.hours_included} />
            <div className="contract-meta muted">
              {contract.renewal_date && <span>{t("contract.renews")} {formatPlainDate(contract.renewal_date)}</span>}
              {contract.auto_invoice && <span>{fill(t("contract.autoInvoiceOn"), { day: contract.billing_day })}</span>}
            </div>
            <div className="page-actions">
              <button type="button" className="btn btn-sm" onClick={() => setUsageFor(contract)}><Icon name="clock" size={14} />{t("contract.monthView")}</button>
              {isAdmin && <button type="button" className="btn btn-sm btn-ghost" onClick={() => setEditing(contract)}><Icon name="pencil" size={14} />{t("common.edit")}</button>}
            </div>
          </div>
        ))}</div>
      )}
      {editing && <ContractModal customerId={customerId} contract={editing === "new" ? null : editing} onClose={() => setEditing(null)}
        onSaved={() => { setEditing(null); void load(); onChange?.(); }} />}
      {usageFor && <UsageModal contract={usageFor} onClose={() => setUsageFor(null)} />}
    </section>
  );
}

function ContractModal({ customerId, contract, onClose, onSaved }: { customerId: number; contract: Contract | null; onClose: () => void; onSaved: () => void }) {
  const { t } = useI18n();
  const [form, setForm] = useState<ContractInput>(contract ? toInput(contract) : blank(customerId));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const set = <K extends keyof ContractInput>(key: K, value: ContractInput[K]) => setForm((f) => ({ ...f, [key]: value }));

  async function save() {
    setBusy(true); setError("");
    try {
      if (contract) await updateContract(contract.id, form); else await createContract(form);
      onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("common.saveError"));
      setBusy(false);
    }
  }
  async function remove() {
    if (!contract || !window.confirm(fill(t("contract.deleteConfirm"), { name: contract.name }))) return;
    try { await deleteContract(contract.id); onSaved(); } catch (cause) { setError(cause instanceof Error ? cause.message : t("common.saveError")); }
  }

  return (
    <Modal title={contract ? t("contract.edit") : t("contract.add")} onClose={onClose} wide
      footer={<>{contract && <button type="button" className="btn btn-danger" style={{ marginRight: "auto" }} onClick={() => void remove()}>{t("common.delete")}</button>}
        <button type="button" className="btn" onClick={onClose}>{t("common.cancel")}</button>
        <button type="button" className="btn btn-primary" disabled={busy || !form.name.trim()} onClick={() => void save()}>{t("common.save")}</button></>}>
      <div className="modal-body">
        <div className="form-grid">
          <label className="field full"><span>{t("contract.name")} *</span><input value={form.name} onChange={(e) => set("name", e.target.value)} placeholder={t("contract.namePlaceholder")} /></label>
          <label className="field"><span>{t("contract.monthlyFee")}</span><input type="number" min="0" step="0.01" value={form.monthly_fee} onChange={(e) => set("monthly_fee", e.target.value)} /></label>
          <label className="field"><span>{t("contract.hoursIncluded")}</span><input type="number" min="0" step="0.25" value={form.hours_included} onChange={(e) => set("hours_included", e.target.value)} /><small>{t("contract.hoursIncludedHint")}</small></label>
          <label className="field"><span>{t("contract.overageRate")}</span><input type="number" min="0" step="0.01" value={form.overage_rate} onChange={(e) => set("overage_rate", e.target.value)} placeholder={t("time.rateDefault")} /></label>
          <label className="field"><span>{t("contract.responseHours")}</span><input type="number" min="1" max="720" value={form.response_hours} onChange={(e) => set("response_hours", e.target.value)} /><small>{t("contract.responseHoursHint")}</small></label>
          <label className="field"><span>{t("contract.startDate")}</span><input type="date" value={form.start_date} onChange={(e) => set("start_date", e.target.value)} /></label>
          <label className="field"><span>{t("contract.renewalDate")}</span><input type="date" value={form.renewal_date ?? ""} onChange={(e) => set("renewal_date", e.target.value)} /></label>
          <label className="check full"><input type="checkbox" checked={form.auto_invoice} onChange={(e) => set("auto_invoice", e.target.checked)} />{t("contract.autoInvoice")}</label>
          {form.auto_invoice && <label className="field"><span>{t("contract.billingDay")}</span><input type="number" min="1" max="28" value={form.billing_day} onChange={(e) => set("billing_day", e.target.value)} /><small>{t("contract.billingDayHint")}</small></label>}
          <label className="check full"><input type="checkbox" checked={form.active} onChange={(e) => set("active", e.target.checked)} />{t("contract.active")}</label>
          <label className="field full"><span>{t("contract.notes")}</span><textarea rows={3} value={form.notes ?? ""} onChange={(e) => set("notes", e.target.value)} placeholder={t("contract.notesPlaceholder")} /></label>
        </div>
        {error && <div className="alert error">{error}</div>}
      </div>
    </Modal>
  );
}

function shiftMonth(period: string, step: number) {
  const [year, month] = period.split("-").map(Number);
  return monthOf(new Date(year, month - 1 + step, 1));
}

function UsageModal({ contract, onClose }: { contract: Contract; onClose: () => void }) {
  const { t } = useI18n();
  const { isAdmin } = useSession();
  const [period, setPeriod] = useState(monthOf());
  const [usage, setUsage] = useState<ContractUsage | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => { setUsage(null); contractUsage(contract.id, period).then(setUsage).catch(() => setError(t("common.databaseError"))); }, [period]);

  async function invoice() {
    setBusy(true); setError("");
    try {
      const created = await invoiceContract(contract.id, period);
      navigate({ name: "invoice", id: created.id });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("common.saveError"));
      setBusy(false);
    }
  }

  const label = new Date(Number(period.slice(0, 4)), Number(period.slice(5)) - 1, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" });
  return (
    <Modal title={contract.name} subtitle={label} onClose={onClose} wide
      footer={<><button type="button" className="btn" onClick={onClose}>{t("common.close")}</button>
        {isAdmin && usage && !usage.invoice && <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void invoice()}><Icon name="receipt" size={16} />{t("contract.invoiceMonth")}</button>}</>}>
      <div className="modal-body">
        <div className="inline-form">
          <button type="button" className="btn btn-sm" onClick={() => setPeriod(shiftMonth(period, -1))}><Icon name="chevronLeft" size={14} />{t("contract.previous")}</button>
          <button type="button" className="btn btn-sm" disabled={period >= monthOf()} onClick={() => setPeriod(shiftMonth(period, 1))}>{t("contract.next")}<Icon name="chevronRight" size={14} /></button>
        </div>
        {!usage ? <p className="muted">{t("common.loading")}</p> : (
          <>
            <div className="stat-grid">
              <div className="stat"><span>{t("contract.used")}</span><strong>{usage.usedHours} h</strong></div>
              <div className="stat"><span>{t("contract.included")}</span><strong>{usage.includedHours} h</strong></div>
              <div className={`stat${usage.overageHours > 0 ? " warning" : ""}`}><span>{t("contract.overage")}</span><strong>{usage.overageHours} h</strong></div>
            </div>
            {usage.invoice && <div className="alert success"><a href={href({ name: "invoice", id: usage.invoice.id })}>{usage.invoice.number}</a> · {formatMoney(usage.invoice.total)} <DocStateBadge state={usage.invoice.state} /></div>}
            {usage.entries.length === 0 ? <p className="muted">{t("time.empty")}</p> : (
              <div className="table-wrap"><table className="responsive compact">
                <thead><tr><th>{t("time.date")}</th><th>{t("time.technician")}</th><th>{t("time.duration")}</th><th>{t("time.description")}</th></tr></thead>
                <tbody>{usage.entries.map((entry) => (
                  <tr key={entry.id}>
                    <td data-label={t("time.date")} className="cell-title nowrap">{formatPlainDate(entry.work_date)}{entry.repair_number ? ` · ${entry.repair_number}` : ""}</td>
                    <td data-label={t("time.technician")}>{entry.technician}</td>
                    <td data-label={t("time.duration")} className="nowrap">{formatMinutes(entry.minutes)}{!entry.billable && <span className="muted"> · {t("time.notBillable")}</span>}</td>
                    <td data-label={t("time.description")}>{entry.description || "—"}</td>
                  </tr>
                ))}</tbody>
              </table></div>
            )}
          </>
        )}
        {error && <div className="alert error">{error}</div>}
      </div>
    </Modal>
  );
}
