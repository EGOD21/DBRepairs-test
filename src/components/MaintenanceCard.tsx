import { useEffect, useState } from "react";
import Icon from "./Icon";
import Modal from "./Modal";
import { createPlan, deletePlan, frequencies, listContracts, listPlans, MaintenancePlan, PlanInput, runPlan, updatePlan, Contract } from "../data/contracts";
import { fill, formatPlainDate, todayIso } from "../lib/format";
import { useI18n } from "../i18n/I18nProvider";
import { href, navigate } from "../router";

const toInput = (plan: MaintenancePlan | null, customerId: number): PlanInput => plan ? {
  customer_id: plan.customer_id, contract_id: plan.contract_id, title: plan.title, description: plan.description ?? "", checklist: plan.checklist ?? "",
  frequency: plan.frequency, interval_count: String(plan.interval_count), next_due: plan.next_due, lead_days: String(plan.lead_days), technician: plan.technician ?? "", active: plan.active,
} : { customer_id: customerId, contract_id: null, title: "", description: "", checklist: "", frequency: "monthly", interval_count: "1", next_due: todayIso(), lead_days: "3", technician: "", active: true };

/** Recurring jobs (patching, backup checks, cleaning) that open a repair ticket before each due date. */
export default function MaintenanceCard({ customerId }: { customerId: number }) {
  const { t } = useI18n();
  const [plans, setPlans] = useState<MaintenancePlan[]>([]);
  const [editing, setEditing] = useState<MaintenancePlan | "new" | null>(null);
  const [error, setError] = useState("");

  const load = () => listPlans({ customerId }).then(setPlans).catch(() => setError(t("common.databaseError")));
  useEffect(() => { void load(); }, [customerId]);

  async function run(plan: MaintenancePlan) {
    if (!window.confirm(fill(t("maintenance.runConfirm"), { title: plan.title }))) return;
    try {
      const repair = await runPlan(plan.id);
      navigate({ name: "repair", id: repair.id });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("common.saveError"));
    }
  }

  const every = (plan: MaintenancePlan) => plan.interval_count > 1 ? fill(t(`maintenance.every.${plan.frequency}`), { count: plan.interval_count }) : t(`maintenance.frequency.${plan.frequency}`);

  return (
    <section className="card">
      <div className="card-header">
        <div><h2>{t("maintenance.title")}</h2><p>{t("maintenance.hint")}</p></div>
        <button type="button" className="btn btn-sm" onClick={() => setEditing("new")}><Icon name="plus" size={15} />{t("maintenance.add")}</button>
      </div>
      {error && <div className="card-body"><div className="alert error">{error}</div></div>}
      {plans.length === 0 ? <div className="empty">{t("maintenance.empty")}</div> : (
        <div className="table-wrap"><table className="responsive compact">
          <thead><tr><th>{t("maintenance.job")}</th><th>{t("maintenance.repeats")}</th><th>{t("maintenance.nextDue")}</th><th>{t("maintenance.last")}</th><th /></tr></thead>
          <tbody>{plans.map((plan) => (
            <tr key={plan.id}>
              <td data-label={t("maintenance.job")} className="cell-title"><strong>{plan.title}</strong>{!plan.active && <span className="badge"> {t("contract.inactive")}</span>}{plan.contract_name && <div className="muted" style={{ fontSize: 12 }}>{plan.contract_name}</div>}</td>
              <td data-label={t("maintenance.repeats")}>{every(plan)}</td>
              <td data-label={t("maintenance.nextDue")} className="nowrap">{formatPlainDate(plan.next_due)}</td>
              <td data-label={t("maintenance.last")}>{plan.last_repair_id ? <a href={href({ name: "repair", id: plan.last_repair_id })}>{plan.last_repair_number}</a> : "—"}</td>
              <td className="actions"><div className="page-actions">
                <button type="button" className="btn btn-sm" onClick={() => void run(plan)} title={t("maintenance.runNow")}><Icon name="wrench" size={14} /><span className="hide-mobile">{t("maintenance.runNow")}</span></button>
                <button type="button" className="btn btn-sm btn-icon btn-ghost" onClick={() => setEditing(plan)} aria-label={t("common.edit")}><Icon name="pencil" size={14} /></button>
              </div></td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
      {editing && <PlanModal customerId={customerId} plan={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void load(); }} />}
    </section>
  );
}

function PlanModal({ customerId, plan, onClose, onSaved }: { customerId: number; plan: MaintenancePlan | null; onClose: () => void; onSaved: () => void }) {
  const { t } = useI18n();
  const [form, setForm] = useState<PlanInput>(toInput(plan, customerId));
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const set = <K extends keyof PlanInput>(key: K, value: PlanInput[K]) => setForm((f) => ({ ...f, [key]: value }));
  useEffect(() => { listContracts({ customerId }).then(setContracts).catch(() => {}); }, [customerId]);

  async function save() {
    setBusy(true); setError("");
    try {
      if (plan) await updatePlan(plan.id, form); else await createPlan(form);
      onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("common.saveError"));
      setBusy(false);
    }
  }
  async function remove() {
    if (!plan || !window.confirm(fill(t("maintenance.deleteConfirm"), { title: plan.title }))) return;
    try { await deletePlan(plan.id); onSaved(); } catch (cause) { setError(cause instanceof Error ? cause.message : t("common.saveError")); }
  }

  return (
    <Modal title={plan ? t("maintenance.edit") : t("maintenance.add")} onClose={onClose} wide
      footer={<>{plan && <button type="button" className="btn btn-danger" style={{ marginRight: "auto" }} onClick={() => void remove()}>{t("common.delete")}</button>}
        <button type="button" className="btn" onClick={onClose}>{t("common.cancel")}</button>
        <button type="button" className="btn btn-primary" disabled={busy || !form.title.trim() || !form.next_due} onClick={() => void save()}>{t("common.save")}</button></>}>
      <div className="modal-body">
        <div className="form-grid">
          <label className="field full"><span>{t("maintenance.job")} *</span><input value={form.title} onChange={(e) => set("title", e.target.value)} placeholder={t("maintenance.jobPlaceholder")} /></label>
          <label className="field"><span>{t("maintenance.repeats")}</span>
            <div className="duration-inputs">
              <span>{t("maintenance.everyLabel")}</span>
              <input type="number" min="1" max="52" value={form.interval_count} onChange={(e) => set("interval_count", e.target.value)} aria-label={t("maintenance.interval")} />
              <select className="input" value={form.frequency} onChange={(e) => set("frequency", e.target.value as PlanInput["frequency"])}>
                {frequencies.map((f) => <option key={f} value={f}>{t(`maintenance.unit.${f}`)}</option>)}
              </select>
            </div></label>
          <label className="field"><span>{t("maintenance.nextDue")} *</span><input type="date" value={form.next_due} onChange={(e) => set("next_due", e.target.value)} /></label>
          <label className="field"><span>{t("maintenance.leadDays")}</span><input type="number" min="0" max="60" value={form.lead_days} onChange={(e) => set("lead_days", e.target.value)} /><small>{t("maintenance.leadDaysHint")}</small></label>
          <label className="field"><span>{t("repair.technician")}</span><input value={form.technician} onChange={(e) => set("technician", e.target.value)} /></label>
          {contracts.length > 0 && <label className="field"><span>{t("contract.title")}</span>
            <select value={form.contract_id ?? ""} onChange={(e) => set("contract_id", e.target.value ? Number(e.target.value) : null)}>
              <option value="">—</option>{contracts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>}
          <label className="field full"><span>{t("maintenance.description")}</span><textarea rows={2} value={form.description} onChange={(e) => set("description", e.target.value)} /></label>
          <label className="field full"><span>{t("maintenance.checklist")}</span><textarea rows={5} value={form.checklist} onChange={(e) => set("checklist", e.target.value)} placeholder={t("maintenance.checklistPlaceholder")} /><small>{t("maintenance.checklistHint")}</small></label>
          <label className="check full"><input type="checkbox" checked={form.active} onChange={(e) => set("active", e.target.checked)} />{t("maintenance.active")}</label>
        </div>
        {error && <div className="alert error">{error}</div>}
      </div>
    </Modal>
  );
}
