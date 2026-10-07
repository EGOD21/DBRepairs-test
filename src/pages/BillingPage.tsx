import { useEffect, useMemo, useState } from "react";
import Icon from "../components/Icon";
import { DocStateBadge } from "../components/Badges";
import NewDocumentModal from "../components/NewDocumentModal";
import { createInvoice, DocKind, Invoice, listInvoices, listPayments, listTime, Payment, TimeEntry } from "../data/billing";
import { fill, formatMinutes, formatMoney, formatPlainDate, todayIso } from "../lib/format";
import { useI18n } from "../i18n/I18nProvider";
import { href, navigate } from "../router";

const tabs = ["invoices", "estimates", "time", "payments"] as const;
type Tab = typeof tabs[number];
const invoiceFilters = ["all", "open", "overdue", "paid", "draft", "void"];
const estimateFilters = ["all", "draft", "sent", "approved", "declined", "converted", "expired"];

function monthStart() {
  const today = todayIso();
  return `${today.slice(0, 7)}-01`;
}

export default function BillingPage({ tab: initialTab }: { tab?: string }) {
  const { t } = useI18n();
  const tab: Tab = (tabs as readonly string[]).includes(initialTab ?? "") ? initialTab as Tab : "invoices";
  const [docs, setDocs] = useState<Invoice[]>([]);
  const [time, setTime] = useState<TimeEntry[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [unbilledOnly, setUnbilledOnly] = useState(true);
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(todayIso());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState<DocKind | null>(null);

  useEffect(() => { setFilter("all"); }, [tab]);
  useEffect(() => {
    setLoading(true); setError("");
    const load = tab === "invoices" || tab === "estimates" ? listInvoices({ kind: tab === "invoices" ? "invoice" : "estimate" }).then(setDocs)
      : tab === "time" ? listTime(unbilledOnly ? { unbilled: true } : { from, to }).then(setTime)
        : listPayments(from, to).then(setPayments);
    load.catch(() => setError(t("common.databaseError"))).finally(() => setLoading(false));
  }, [tab, unbilledOnly, from, to]);

  const shownDocs = useMemo(() => {
    const q = search.trim().toLowerCase();
    return docs.filter((doc) => (filter === "all" || (filter === "open" ? ["unpaid", "partial", "overdue"].includes(doc.state) : doc.state === filter))
      && (!q || [doc.number, doc.customer_name, doc.customer_company, doc.repair_number].some((v) => (v ?? "").toLowerCase().includes(q))));
  }, [docs, filter, search]);

  const open = docs.filter((doc) => ["unpaid", "partial", "overdue"].includes(doc.state));
  const outstanding = open.reduce((sum, doc) => sum + doc.balance, 0);
  const overdue = open.filter((doc) => doc.state === "overdue").reduce((sum, doc) => sum + doc.balance, 0);

  // Unbilled time grouped by customer, so each group can become one invoice.
  const timeGroups = useMemo(() => {
    const groups = new Map<number, { name: string; minutes: number; value: number; entries: TimeEntry[] }>();
    for (const entry of time) {
      const group = groups.get(entry.customer_id) ?? { name: entry.customer_name, minutes: 0, value: 0, entries: [] };
      group.minutes += entry.minutes;
      if (entry.billable) group.value += (entry.minutes / 60) * (entry.hourly_rate ?? 0);
      group.entries.push(entry);
      groups.set(entry.customer_id, group);
    }
    return [...groups.entries()].sort((a, b) => b[1].minutes - a[1].minutes);
  }, [time]);

  async function invoiceTime(customerId: number) {
    try {
      const doc = await createInvoice("invoice", customerId);
      navigate({ name: "invoice", id: doc.id });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("common.saveError"));
    }
  }

  return (
    <div className="page">
      <header className="page-header">
        <div><h1>{t("billing.title")}</h1><p>{t("billing.subtitle")}</p></div>
        <div className="page-actions">
          <button type="button" className="btn" onClick={() => setCreating("estimate")}><Icon name="file" size={16} />{t("billing.newEstimate")}</button>
          <button type="button" className="btn btn-primary" onClick={() => setCreating("invoice")}><Icon name="plus" size={16} />{t("billing.newInvoice")}</button>
        </div>
      </header>
      <nav className="tabs" aria-label={t("billing.title")}>
        {tabs.map((name) => <a key={name} href={href({ name: "billing", tab: name === "invoices" ? undefined : name })} className={tab === name ? "active" : ""}>{t(`billing.tab.${name}`)}</a>)}
      </nav>
      {error && <div className="alert error">{error}</div>}

      {tab === "invoices" && (
        <section className="stat-grid">
          <div className="stat"><span><Icon name="receipt" size={15} />{t("billing.outstanding")}</span><strong>{formatMoney(outstanding)}</strong></div>
          <div className={`stat${overdue > 0 ? " danger" : ""}`}><span><Icon name="alert" size={15} />{t("billing.overdue")}</span><strong>{formatMoney(overdue)}</strong></div>
          <div className="stat"><span><Icon name="file" size={15} />{t("billing.openInvoices")}</span><strong>{open.length}</strong></div>
        </section>
      )}

      {(tab === "invoices" || tab === "estimates") && (
        <section className="card">
          <div className="toolbar">
            <div className="search"><Icon name="search" size={16} /><input className="input" type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("billing.search")} /></div>
            <select className="input" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label={t("billing.state")}>
              {(tab === "invoices" ? invoiceFilters : estimateFilters).map((f) => <option key={f} value={f}>{f === "all" ? t("billing.filter.all") : f === "open" ? t("billing.filter.open") : t(`billing.state.${f}`)}</option>)}
            </select>
            <span className="count">{fill(t("billing.count"), { count: shownDocs.length })}</span>
          </div>
          {loading ? <div className="empty">{t("common.loading")}</div> : shownDocs.length === 0 ? <div className="empty"><strong>{t("billing.empty")}</strong></div> : (
            <div className="table-wrap"><table className="responsive">
              <thead><tr><th>{t("billing.number")}</th><th>{t("repair.customer")}</th><th>{t("billing.date")}</th><th>{tab === "invoices" ? t("billing.dueDate") : t("billing.validUntil")}</th><th>{t("billing.state")}</th><th className="num">{t("billing.total")}</th>{tab === "invoices" && <th className="num">{t("billing.balance")}</th>}</tr></thead>
              <tbody>{shownDocs.map((doc) => (
                <tr key={doc.id} className="clickable" onClick={() => navigate({ name: "invoice", id: doc.id })}>
                  <td data-label={t("billing.number")} className="cell-title nowrap"><strong><a href={href({ name: "invoice", id: doc.id })}>{doc.number}</a></strong>{doc.repair_number && <span className="muted"> · {doc.repair_number}</span>}</td>
                  <td data-label={t("repair.customer")}>{doc.customer_name}</td>
                  <td data-label={t("billing.date")} className="nowrap">{formatPlainDate(doc.issue_date)}</td>
                  <td data-label={tab === "invoices" ? t("billing.dueDate") : t("billing.validUntil")} className="nowrap">{formatPlainDate(doc.due_date)}</td>
                  <td data-label={t("billing.state")}><DocStateBadge state={doc.state} /></td>
                  <td data-label={t("billing.total")} className="num nowrap">{formatMoney(doc.total)}</td>
                  {tab === "invoices" && <td data-label={t("billing.balance")} className="num nowrap">{["void", "draft"].includes(doc.state) ? "—" : formatMoney(doc.balance)}</td>}
                </tr>
              ))}</tbody>
            </table></div>
          )}
        </section>
      )}

      {tab === "time" && (
        <section className="card">
          <div className="toolbar">
            <label className="check"><input type="checkbox" checked={unbilledOnly} onChange={(e) => setUnbilledOnly(e.target.checked)} />{t("billing.unbilledOnly")}</label>
            {!unbilledOnly && <><input className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label={t("reports.from")} /><input className="input" type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-label={t("reports.to")} /></>}
            <span className="count">{formatMinutes(time.reduce((sum, entry) => sum + entry.minutes, 0))}</span>
          </div>
          {loading ? <div className="empty">{t("common.loading")}</div> : timeGroups.length === 0 ? <div className="empty"><strong>{t("time.empty")}</strong></div> : (
            <div className="time-groups">{timeGroups.map(([customerId, group]) => (
              <div key={customerId} className="time-group">
                <div className="time-group-head">
                  <div><a className="strong" href={href({ name: "customer", id: customerId })}>{group.name}</a><span className="muted"> · {formatMinutes(group.minutes)}{group.value > 0 ? ` · ${formatMoney(group.value)}` : ""}</span></div>
                  {unbilledOnly && <button type="button" className="btn btn-sm btn-primary" onClick={() => void invoiceTime(customerId)}>
                    <Icon name="receipt" size={14} />{t("billing.invoiceTime")}</button>}
                </div>
                <div className="table-wrap"><table className="responsive compact">
                  <tbody>{group.entries.map((entry) => (
                    <tr key={entry.id}>
                      <td data-label={t("time.date")} className="cell-title nowrap">{formatPlainDate(entry.work_date)}{entry.repair_number && <> · <a href={href({ name: "repair", id: entry.repair_id! })}>{entry.repair_number}</a></>}</td>
                      <td data-label={t("time.technician")}>{entry.technician}</td>
                      <td data-label={t("time.duration")} className="nowrap">{formatMinutes(entry.minutes)}</td>
                      <td data-label={t("time.description")}>{entry.description || "—"}</td>
                      <td data-label={t("time.billing")}>{!entry.billable ? <span className="badge">{t("time.notBillable")}</span> : entry.invoice_id ? <a className="badge success" href={href({ name: "invoice", id: entry.invoice_id })}>{entry.invoice_number}</a> : <span className="badge warning">{t("time.unbilled")}</span>}</td>
                    </tr>
                  ))}</tbody>
                </table></div>
              </div>
            ))}</div>
          )}
        </section>
      )}

      {tab === "payments" && (
        <section className="card">
          <div className="toolbar">
            <input className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label={t("reports.from")} />
            <input className="input" type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-label={t("reports.to")} />
            <span className="count"><strong>{formatMoney(payments.reduce((sum, p) => sum + p.amount, 0))}</strong></span>
          </div>
          {loading ? <div className="empty">{t("common.loading")}</div> : payments.length === 0 ? <div className="empty"><strong>{t("billing.noPayments")}</strong></div> : (
            <div className="table-wrap"><table className="responsive">
              <thead><tr><th>{t("billing.paidOn")}</th><th>{t("billing.number")}</th><th>{t("repair.customer")}</th><th>{t("billing.method")}</th><th>{t("billing.reference")}</th><th className="num">{t("billing.amount")}</th></tr></thead>
              <tbody>{payments.map((p) => (
                <tr key={p.id} className="clickable" onClick={() => navigate({ name: "invoice", id: p.invoice_id })}>
                  <td data-label={t("billing.paidOn")} className="cell-title nowrap"><strong>{formatPlainDate(p.paid_at)}</strong></td>
                  <td data-label={t("billing.number")}><a href={href({ name: "invoice", id: p.invoice_id })}>{p.invoice_number}</a></td>
                  <td data-label={t("repair.customer")}>{p.customer_name}</td>
                  <td data-label={t("billing.method")}>{t(`billing.method.${p.method}`)}</td>
                  <td data-label={t("billing.reference")}>{p.reference || "—"}</td>
                  <td data-label={t("billing.amount")} className="num nowrap">{formatMoney(p.amount)}</td>
                </tr>
              ))}</tbody>
            </table></div>
          )}
        </section>
      )}
      {creating && <NewDocumentModal kind={creating} onClose={() => setCreating(null)} />}
    </div>
  );
}
