import { FormEvent, useState } from "react";
import Modal from "./Modal";
import { useI18n } from "../i18n/I18nProvider";
import { createCustomer, CustomerInput, emptyCustomerInput, updateCustomer } from "../data/customers";
import { isServerMode } from "../data/runtime";

type Props = { customerId?: number; initial?: CustomerInput; onClose: () => void; onSaved: (id: number) => void };

export default function CustomerFormModal({ customerId, initial, onClose, onSaved }: Props) {
  const { t } = useI18n();
  const [form, setForm] = useState<CustomerInput>(initial ?? emptyCustomerInput);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const set = <K extends keyof CustomerInput>(key: K, value: CustomerInput[K]) => setForm((f) => ({ ...f, [key]: value }));
  const text = (key: keyof CustomerInput, label: string, props: Record<string, unknown> = {}) => (
    <label className="field"><span>{label}</span><input value={String(form[key] ?? "")} onChange={(e) => set(key, e.target.value as never)} {...props} /></label>
  );

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!form.name.trim() || saving) return;
    setSaving(true); setError("");
    try {
      if (customerId) { await updateCustomer(customerId, form); onSaved(customerId); }
      else onSaved(await createCustomer(form));
    } catch (cause) {
      console.error(cause);
      setError(cause instanceof Error && cause.message ? cause.message : t("common.saveError"));
      setSaving(false);
    }
  }

  const commercial = form.customerType === "commercial";
  return (
    <Modal title={customerId ? t("customers.edit") : t("customers.new")} subtitle={t("customers.formHint")} onClose={onClose} wide>
      <form onSubmit={(e) => void submit(e)}>
        <div className="modal-body">
          {error && <div className="alert error">{error}</div>}
          <div className="form-grid">
            <div className="field full">
              <span>{t("customer.type")}</span>
              <div className="segmented" style={{ width: "fit-content" }}>
                <button type="button" className={!commercial ? "active" : ""} onClick={() => set("customerType", "residential")}>{t("customer.type.residential")}</button>
                <button type="button" className={commercial ? "active" : ""} onClick={() => set("customerType", "commercial")}>{t("customer.type.commercial")}</button>
              </div>
            </div>
            <label className="field"><span>{commercial ? t("customer.businessName") : t("customer.name")} *</span><input autoFocus required value={form.name} onChange={(e) => set("name", e.target.value)} /></label>
            {commercial ? text("contactPerson", t("customer.contactPerson")) : text("company", t("customer.company"))}
            {commercial && text("company", t("customer.legalName"))}
            {text("taxNumber", t("customer.taxNumber"))}

            <div className="form-section-title">{t("customer.section.contact")}</div>
            {text("email", t("customer.email"), { type: "email" })}
            {text("phone", t("customer.phone"), { type: "tel" })}
            {text("mobile", t("customer.mobile"), { type: "tel" })}
            <label className="field"><span>{t("customer.preferredContact")}</span>
              <select value={form.preferredContact} onChange={(e) => set("preferredContact", e.target.value as CustomerInput["preferredContact"])}>
                <option value="">—</option>
                <option value="email">{t("customer.contact.email")}</option>
                <option value="phone">{t("customer.contact.phone")}</option>
                <option value="sms">{t("customer.contact.sms")}</option>
              </select>
            </label>
            <label className="field full"><span>{t("customer.address")}</span><textarea rows={2} value={form.address} onChange={(e) => set("address", e.target.value)} /></label>

            {/* On the server, retainers are contracts on the customer's page and fill these in. */}
            {!isServerMode && <>
            <div className="form-section-title">{t("customer.section.retainer")}</div>
            <label className="check full"><input type="checkbox" checked={form.isRetainer} onChange={(e) => set("isRetainer", e.target.checked)} />{t("customer.isRetainer")}</label>
            {form.isRetainer && (<>
              {text("retainerPlan", t("customer.retainerPlan"), { placeholder: t("customer.retainerPlanPlaceholder") })}
              {text("retainerMonthlyFee", t("customer.retainerMonthlyFee"), { type: "number", step: "0.01", min: "0" })}
              {text("retainerRenewalDate", t("customer.retainerRenewalDate"), { type: "date" })}
            </>)}
            </>}

            <div className="form-section-title">{t("customer.section.other")}</div>
            <label className="field full"><span>{t("customer.tags")}</span><input value={form.tags} onChange={(e) => set("tags", e.target.value)} placeholder={t("customer.tagsPlaceholder")} /></label>
            <label className="field full"><span>{t("customer.notes")}</span><textarea rows={3} value={form.notes} onChange={(e) => set("notes", e.target.value)} /></label>
          </div>
        </div>
        <div className="modal-actions">
          <button type="button" className="btn" onClick={onClose}>{t("common.cancel")}</button>
          <button type="submit" className="btn btn-primary" disabled={saving || !form.name.trim()}>{saving ? t("common.saving") : t("common.save")}</button>
        </div>
      </form>
    </Modal>
  );
}
