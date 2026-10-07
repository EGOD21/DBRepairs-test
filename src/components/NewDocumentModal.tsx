import { useEffect, useMemo, useState } from "react";
import Modal from "./Modal";
import { createInvoice, DocKind } from "../data/billing";
import { Customer, listCustomers } from "../data/customers";
import { listRepairsByCustomer, Repair } from "../data/repairs";
import { useI18n } from "../i18n/I18nProvider";
import { navigate } from "../router";

/** Choose a customer (and optionally one of their repairs) for a new invoice or estimate. */
export default function NewDocumentModal({ kind, onClose }: { kind: DocKind; onClose: () => void }) {
  const { t } = useI18n();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [search, setSearch] = useState("");
  const [customerId, setCustomerId] = useState(0);
  const [repairs, setRepairs] = useState<Repair[]>([]);
  const [repairId, setRepairId] = useState(0);
  const [prefill, setPrefill] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => { listCustomers().then(setCustomers).catch(() => setError(t("common.databaseError"))); }, []);
  useEffect(() => {
    setRepairId(0);
    if (customerId) listRepairsByCustomer(customerId).then(setRepairs).catch(() => setRepairs([]));
    else setRepairs([]);
  }, [customerId]);

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return customers.filter((c) => !q || [c.name, c.company, c.email, c.phone, c.mobile].some((v) => (v ?? "").toLowerCase().includes(q))).slice(0, 200);
  }, [customers, search]);

  async function create() {
    setBusy(true); setError("");
    try {
      const doc = await createInvoice(kind, customerId, repairId || null, prefill);
      navigate({ name: "invoice", id: doc.id });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("common.saveError"));
      setBusy(false);
    }
  }

  return (
    <Modal title={kind === "invoice" ? t("billing.newInvoice") : t("billing.newEstimate")} onClose={onClose}
      footer={<><button type="button" className="btn" onClick={onClose}>{t("common.cancel")}</button>
        <button type="button" className="btn btn-primary" disabled={!customerId || busy} onClick={() => void create()}>{t("billing.create")}</button></>}>
      <div className="modal-body">
        <label className="field"><span>{t("repair.customer")}</span>
          <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("customers.search")} />
          <select size={6} value={customerId || ""} onChange={(e) => setCustomerId(Number(e.target.value))}>
            {shown.map((c) => <option key={c.id} value={c.id}>{c.name}{c.company ? ` — ${c.company}` : ""}</option>)}
          </select>
        </label>
        {customerId > 0 && (
          <label className="field"><span>{t("repair.number")}</span>
            <select value={repairId || ""} onChange={(e) => setRepairId(Number(e.target.value))}>
              <option value="">{t("billing.noRepair")}</option>
              {repairs.map((r) => <option key={r.id} value={r.id}>{r.repair_number} · {[r.brand, r.model].filter(Boolean).join(" ") || r.device_type || ""}</option>)}
            </select></label>
        )}
        <label className="check"><input type="checkbox" checked={prefill} onChange={(e) => setPrefill(e.target.checked)} />{kind === "invoice" ? t("billing.prefillInvoice") : t("billing.prefillEstimate")}</label>
        {error && <div className="alert error">{error}</div>}
      </div>
    </Modal>
  );
}
