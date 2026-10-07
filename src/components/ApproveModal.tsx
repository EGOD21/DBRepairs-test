import { useState } from "react";
import Modal from "./Modal";
import SignaturePad from "./SignaturePad";
import { approveEstimate, InvoiceDetail } from "../data/billing";
import { fill, formatMoney } from "../lib/format";
import { useI18n } from "../i18n/I18nProvider";

/** The customer reads the total and signs on the screen (phone, tablet or touch laptop). */
export default function ApproveModal({ doc, onClose, onSaved }: { doc: InvoiceDetail; onClose: () => void; onSaved: (doc: InvoiceDetail) => void }) {
  const { t } = useI18n();
  const [name, setName] = useState(doc.customer_type === "commercial" ? doc.customer_contact ?? "" : doc.customer_name);
  const [signature, setSignature] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function save() {
    setBusy(true); setError("");
    try {
      onSaved(await approveEstimate(doc.id, name, signature));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("common.saveError"));
      setBusy(false);
    }
  }

  return (
    <Modal title={t("billing.approveTitle")} subtitle={fill(t("billing.approveText"), { number: doc.number, total: formatMoney(doc.total) })} onClose={onClose}
      footer={<><button type="button" className="btn" onClick={onClose}>{t("common.cancel")}</button>
        <button type="button" className="btn btn-primary" disabled={busy || !name.trim() || !signature} onClick={() => void save()}>{t("billing.approve")}</button></>}>
      <div className="modal-body">
        <label className="field"><span>{t("signature.name")}</span><input value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" /></label>
        <div className="field"><span>{t("signature.title")}</span><SignaturePad onChange={setSignature} /></div>
        {error && <div className="alert error">{error}</div>}
      </div>
    </Modal>
  );
}
