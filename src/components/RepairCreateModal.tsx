import { FormEvent, useEffect, useMemo, useState } from "react";
import Modal from "./Modal";
import Icon from "./Icon";
import { useI18n } from "../i18n/I18nProvider";
import { createCustomer, Customer, CustomerInput, emptyCustomerInput, listCustomers } from "../data/customers";
import { blankRepairInput, createRepair, priorities, Repair, RepairInput, RepairStatus } from "../data/repairs";

type Props = {
  statuses: RepairStatus[];
  repairs: Repair[];
  initialCustomerId?: number;
  autoPrintKind: string;
  onClose: () => void;
  onCreated: (id: number, print: boolean) => void;
};

export default function RepairCreateModal({ statuses, repairs, initialCustomerId, autoPrintKind, onClose, onCreated }: Props) {
  const { t } = useI18n();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [form, setForm] = useState<RepairInput>({ ...blankRepairInput, customer_id: initialCustomerId ?? 0, status_id: statuses[0]?.id ?? 0 });
  const [quickOpen, setQuickOpen] = useState(false);
  const [quick, setQuick] = useState<CustomerInput>(emptyCustomerInput);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => { listCustomers().then(setCustomers).catch(() => setError(t("common.databaseError"))); }, []);
  useEffect(() => { if (!form.status_id && statuses[0]) setForm((f) => ({ ...f, status_id: statuses[0].id })); }, [statuses]);

  const suggestions = useMemo(() => {
    const unique = (values: (string | null)[]) => Array.from(new Set(values.map((v) => v?.trim()).filter((v): v is string => Boolean(v)))).sort((a, b) => a.localeCompare(b));
    return { types: unique(repairs.map((r) => r.device_type)), brands: unique(repairs.map((r) => r.brand)), models: unique(repairs.map((r) => r.model)), techs: unique(repairs.map((r) => r.technician)) };
  }, [repairs]);

  const set = <K extends keyof RepairInput>(key: K, value: RepairInput[K]) => setForm((f) => ({ ...f, [key]: value }));
  const canSave = Boolean(form.customer_id && form.status_id && form.reported_fault.trim()) && !saving;

  async function saveQuickCustomer() {
    if (!quick.name.trim()) return;
    setError("");
    try {
      const id = await createCustomer(quick);
      setCustomers(await listCustomers());
      set("customer_id", id);
      setQuick(emptyCustomerInput);
      setQuickOpen(false);
    } catch {
      setError(t("common.saveError"));
    }
  }

  async function save(print: boolean) {
    if (!canSave) return;
    setSaving(true); setError("");
    try {
      const id = await createRepair(form);
      onCreated(id, print);
    } catch (cause) {
      console.error(cause);
      setError(cause instanceof Error && cause.message ? cause.message : t("common.saveError"));
      setSaving(false);
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    void save(autoPrintKind !== "" && autoPrintKind !== "none");
  }

  return (
    <Modal title={t("repair.new")} subtitle={t("repair.formHint")} onClose={onClose} wide>
      <form onSubmit={submit}>
        <div className="modal-body">
          {error && <div className="alert error">{error}</div>}
          <div className="form-grid">
            <div className="field full">
              <span>{t("repair.customer")} *</span>
              <div className="input-with-button">
                <select value={form.customer_id} onChange={(e) => set("customer_id", Number(e.target.value))}>
                  <option value={0}>{t("repair.selectCustomer")}</option>
                  {customers.map((c) => <option key={c.id} value={c.id}>{c.name}{c.company ? ` — ${c.company}` : ""}</option>)}
                </select>
                <button type="button" className="btn" onClick={() => setQuickOpen((v) => !v)}><Icon name={quickOpen ? "x" : "plus"} size={15} />{quickOpen ? t("common.cancel") : t("customers.new")}</button>
              </div>
            </div>
            {quickOpen && (
              <div className="card full">
                <div className="card-body form-grid">
                  <label className="field full"><span>{t("customer.name")} *</span><input autoFocus value={quick.name} onChange={(e) => setQuick((c) => ({ ...c, name: e.target.value }))} /></label>
                  <label className="field"><span>{t("customer.phone")}</span><input value={quick.phone} onChange={(e) => setQuick((c) => ({ ...c, phone: e.target.value }))} /></label>
                  <label className="field"><span>{t("customer.email")}</span><input type="email" value={quick.email} onChange={(e) => setQuick((c) => ({ ...c, email: e.target.value }))} /></label>
                  <label className="field"><span>{t("customer.type")}</span><select value={quick.customerType} onChange={(e) => setQuick((c) => ({ ...c, customerType: e.target.value === "commercial" ? "commercial" : "residential" }))}><option value="residential">{t("customer.type.residential")}</option><option value="commercial">{t("customer.type.commercial")}</option></select></label>
                  <label className="field"><span>{t("customer.company")}</span><input value={quick.company} onChange={(e) => setQuick((c) => ({ ...c, company: e.target.value }))} /></label>
                  <div className="full"><button type="button" className="btn btn-primary" disabled={!quick.name.trim()} onClick={() => void saveQuickCustomer()}>{t("repair.createAndSelectCustomer")}</button></div>
                </div>
              </div>
            )}

            <div className="form-section-title">{t("repair.section.device")}</div>
            <label className="field"><span>{t("repair.deviceType")}</span><input list="new-device-types" value={form.device_type} onChange={(e) => set("device_type", e.target.value)} /></label>
            <label className="field"><span>{t("repair.brand")}</span><input list="new-brands" value={form.brand} onChange={(e) => set("brand", e.target.value)} /></label>
            <label className="field"><span>{t("repair.model")}</span><input list="new-models" value={form.model} onChange={(e) => set("model", e.target.value)} /></label>
            <label className="field"><span>{t("repair.serialNumber")}</span><input value={form.serial_number} onChange={(e) => set("serial_number", e.target.value)} /></label>
            <label className="field"><span>{t("repair.imei")}</span><input value={form.imei} onChange={(e) => set("imei", e.target.value)} /></label>
            <label className="field"><span>{t("repair.accessories")}</span><input value={form.accessories} onChange={(e) => set("accessories", e.target.value)} /></label>
            <label className="field full"><span>{t("repair.reportedFault")} *</span><textarea rows={3} value={form.reported_fault} onChange={(e) => set("reported_fault", e.target.value)} /></label>
            <label className="field full"><span>{t("repair.generalCondition")}</span><textarea rows={2} value={form.general_condition} onChange={(e) => set("general_condition", e.target.value)} /></label>

            <div className="form-section-title">{t("repair.section.workflow")}</div>
            <label className="field"><span>{t("repair.status")}</span><select value={form.status_id} onChange={(e) => set("status_id", Number(e.target.value))}>{statuses.map((s) => <option key={s.id} value={s.id}>{t(s.label_key)}</option>)}</select></label>
            <label className="field"><span>{t("repair.priority")}</span><select value={form.priority} onChange={(e) => set("priority", e.target.value as RepairInput["priority"])}>{priorities.map((p) => <option key={p} value={p}>{t(`priority.${p}`)}</option>)}</select></label>
            <label className="field"><span>{t("repair.dueDate")}</span><input type="date" value={form.due_date} onChange={(e) => set("due_date", e.target.value)} /></label>
            <label className="field"><span>{t("repair.technician")}</span><input list="new-techs" value={form.technician} onChange={(e) => set("technician", e.target.value)} /></label>
            <label className="field"><span>{t("repair.estimatedValue")}</span><input type="number" step="0.01" min="0" value={form.estimated_value} onChange={(e) => set("estimated_value", e.target.value)} /></label>
            <label className="field"><span>{t("repair.deposit")}</span><input type="number" step="0.01" min="0" value={form.deposit} onChange={(e) => set("deposit", e.target.value)} /></label>
            <label className="field full"><span>{t("repair.internalNotes")}</span><textarea rows={2} value={form.internal_notes} onChange={(e) => set("internal_notes", e.target.value)} /></label>
          </div>
          <datalist id="new-device-types">{suggestions.types.map((v) => <option key={v} value={v} />)}</datalist>
          <datalist id="new-brands">{suggestions.brands.map((v) => <option key={v} value={v} />)}</datalist>
          <datalist id="new-models">{suggestions.models.map((v) => <option key={v} value={v} />)}</datalist>
          <datalist id="new-techs">{suggestions.techs.map((v) => <option key={v} value={v} />)}</datalist>
        </div>
        <div className="modal-actions">
          <button type="button" className="btn" onClick={onClose}>{t("common.cancel")}</button>
          <button type="button" className="btn" disabled={!canSave} onClick={() => void save(true)}><Icon name="printer" size={15} />{t("repair.saveAndPrint")}</button>
          <button type="submit" className="btn btn-primary" disabled={!canSave}>{saving ? t("common.saving") : t("common.save")}</button>
        </div>
      </form>
    </Modal>
  );
}
