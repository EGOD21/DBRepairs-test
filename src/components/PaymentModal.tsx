import { useState } from "react";
import Modal from "./Modal";
import { addPayment, InvoiceDetail, PaymentMethod, paymentMethods } from "../data/billing";
import { formatMoney, todayIso } from "../lib/format";
import { useI18n } from "../i18n/I18nProvider";

export default function PaymentModal({ doc, onClose, onSaved }: { doc: InvoiceDetail; onClose: () => void; onSaved: (doc: InvoiceDetail) => void }) {
  const { t } = useI18n();
  const [amount, setAmount] = useState(Math.max(0, doc.balance).toFixed(2));
  const [method, setMethod] = useState<PaymentMethod>("card");
  const [date, setDate] = useState(todayIso());
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function save() {
    setBusy(true); setError("");
    try {
      onSaved(await addPayment(doc.id, { amount: Number(amount), method, paid_at: date, reference, note }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("common.saveError"));
      setBusy(false);
    }
  }

  return (
    <Modal title={t("billing.recordPayment")} subtitle={`${doc.number} · ${t("billing.balanceDue")} ${formatMoney(doc.balance)}`} onClose={onClose}
      footer={<><button type="button" className="btn" onClick={onClose}>{t("common.cancel")}</button>
        <button type="button" className="btn btn-primary" disabled={busy || !(Number(amount) > 0)} onClick={() => void save()}>{t("billing.recordPayment")}</button></>}>
      <div className="modal-body">
        <div className="form-grid">
          <label className="field"><span>{t("billing.amount")}</span><input type="number" min="0.01" step="0.01" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
          <label className="field"><span>{t("billing.method")}</span><select value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)}>
            {paymentMethods.map((m) => <option key={m} value={m}>{t(`billing.method.${m}`)}</option>)}</select></label>
          <label className="field"><span>{t("billing.paidOn")}</span><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
          <label className="field"><span>{t("billing.reference")}</span><input value={reference} onChange={(e) => setReference(e.target.value)} placeholder={t("billing.referencePlaceholder")} /></label>
          <label className="field full"><span>{t("billing.note")}</span><input value={note} onChange={(e) => setNote(e.target.value)} /></label>
        </div>
        {error && <div className="alert error">{error}</div>}
      </div>
    </Modal>
  );
}
