import { useEffect, useState } from "react";
import Icon from "./Icon";
import { DocStateBadge } from "./Badges";
import { createInvoice, DocKind, getCustomerBilling, Invoice, listInvoices } from "../data/billing";
import { formatMinutes, formatMoney, formatPlainDate } from "../lib/format";
import { useI18n } from "../i18n/I18nProvider";
import { href, navigate } from "../router";

/** Estimates and invoices of a repair or a customer, with buttons to start new ones. */
export default function BillingCard({ customerId, repairId }: { customerId: number; repairId?: number }) {
  const { t } = useI18n();
  const [docs, setDocs] = useState<Invoice[]>([]);
  const [summary, setSummary] = useState<{ balance: number; overdue: number; unbilledMinutes: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const load = repairId
      ? listInvoices({ repairId }).then(setDocs)
      : getCustomerBilling(customerId).then((result) => { setDocs(result.invoices); setSummary(result); });
    load.catch(() => setError(t("common.databaseError")));
  }, [customerId, repairId]);

  async function create(kind: DocKind) {
    setBusy(true); setError("");
    try {
      const doc = await createInvoice(kind, customerId, repairId);
      navigate({ name: "invoice", id: doc.id });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("common.saveError"));
      setBusy(false);
    }
  }

  return (
    <section className="card">
      <div className="card-header">
        <div><h2>{t("billing.documents")}</h2>
          {summary && <p>{t("billing.balanceDue")}: <strong className={summary.overdue > 0 ? "text-danger" : ""}>{formatMoney(summary.balance)}</strong>
            {summary.unbilledMinutes > 0 && <> · {t("time.unbilled")}: <strong>{formatMinutes(summary.unbilledMinutes)}</strong></>}</p>}
        </div>
        <div className="card-actions">
          <button type="button" className="btn btn-sm" disabled={busy} onClick={() => void create("estimate")}><Icon name="file" size={15} />{t("billing.newEstimate")}</button>
          <button type="button" className="btn btn-sm btn-primary" disabled={busy} onClick={() => void create("invoice")}><Icon name="receipt" size={15} />{t("billing.newInvoice")}</button>
        </div>
      </div>
      {error && <div className="card-body" style={{ paddingBottom: 0 }}><div className="alert error">{error}</div></div>}
      {docs.length === 0 ? <div className="empty">{t("billing.noDocuments")}</div> : (
        <div className="table-wrap"><table className="responsive compact">
          <thead><tr><th>{t("billing.number")}</th><th>{t("billing.date")}</th><th>{t("billing.state")}</th><th className="num">{t("billing.total")}</th><th className="num">{t("billing.balance")}</th></tr></thead>
          <tbody>{docs.map((doc) => (
            <tr key={doc.id} className="clickable" onClick={() => navigate({ name: "invoice", id: doc.id })}>
              <td data-label={t("billing.number")} className="cell-title nowrap"><strong><a href={href({ name: "invoice", id: doc.id })}>{doc.number}</a></strong> <span className="muted">{t(`billing.kind.${doc.kind}`)}</span></td>
              <td data-label={t("billing.date")} className="nowrap">{formatPlainDate(doc.issue_date)}</td>
              <td data-label={t("billing.state")}><DocStateBadge state={doc.state} /></td>
              <td data-label={t("billing.total")} className="num nowrap">{formatMoney(doc.total)}</td>
              <td data-label={t("billing.balance")} className="num nowrap">{doc.kind === "invoice" && !["void", "draft"].includes(doc.state) ? formatMoney(doc.balance) : "—"}</td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
    </section>
  );
}
