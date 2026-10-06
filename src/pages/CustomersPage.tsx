import { useEffect, useMemo, useState } from "react";
import Icon from "../components/Icon";
import CustomerFormModal from "../components/CustomerFormModal";
import { Customer, listCustomers } from "../data/customers";
import { fill, formatMoney } from "../lib/format";
import { mailtoLink, telLink } from "../lib/email";
import { useI18n } from "../i18n/I18nProvider";
import { href, navigate } from "../router";

type Filter = "all" | "residential" | "commercial" | "retainer";

export default function CustomersPage({ filter }: { filter?: string }) {
  const { t } = useI18n();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [search, setSearch] = useState("");
  const [kind, setKind] = useState<Filter>("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(filter === "new");

  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(() => {
      listCustomers(search)
        .then((list) => { if (active) { setCustomers(list); setError(""); } })
        .catch((cause) => { console.error(cause); if (active) setError(t("common.databaseError")); })
        .finally(() => { if (active) setLoading(false); });
    }, 180);
    return () => { active = false; window.clearTimeout(timer); };
  }, [search]);

  const filtered = useMemo(() => customers.filter((c) =>
    kind === "all" || (kind === "retainer" ? c.is_retainer : c.customer_type === kind)), [customers, kind]);

  return (
    <div className="page">
      <header className="page-header">
        <div><h1>{t("customers.title")}</h1><p>{t("customers.subtitle")}</p></div>
        <div className="page-actions"><button type="button" className="btn btn-primary" onClick={() => setCreating(true)}><Icon name="plus" size={16} />{t("customers.new")}</button></div>
      </header>
      {error && <div className="alert error">{error}</div>}
      <section className="card">
        <div className="toolbar">
          <div className="search"><Icon name="search" size={16} /><input className="input" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("customers.search")} aria-label={t("customers.search")} /></div>
          <div className="segmented" role="group">
            {(["all", "residential", "commercial", "retainer"] as Filter[]).map((f) => <button key={f} type="button" className={kind === f ? "active" : ""} onClick={() => setKind(f)}>{t(`customers.filter.${f}`)}</button>)}
          </div>
          <span className="count">{fill(t("customers.count"), { count: filtered.length })}</span>
        </div>
        {loading ? <div className="empty">{t("common.loading")}</div> : filtered.length === 0 ? (
          <div className="empty"><strong>{search || kind !== "all" ? t("customers.noResults") : t("customers.empty")}</strong>{!search && kind === "all" && <span>{t("customers.emptyHint")}</span>}</div>
        ) : (
          <div className="table-wrap"><table className="responsive">
            <thead><tr><th>{t("customer.name")}</th><th>{t("customer.type")}</th><th>{t("customer.email")}</th><th>{t("customer.phone")}</th><th>{t("customers.repairs")}</th><th>{t("customers.billed")}</th></tr></thead>
            <tbody>{filtered.map((c) => {
              const phone = c.mobile || c.phone;
              return (
                <tr key={c.id} className="clickable" onClick={() => navigate({ name: "customer", id: c.id })}>
                  <td data-label={t("customer.name")} className="cell-title"><strong><a href={href({ name: "customer", id: c.id })}>{c.name}</a></strong>{(c.company || c.contact_person) && <div className="muted" style={{ fontSize: 12 }}>{c.customer_type === "commercial" ? c.contact_person : c.company}</div>}</td>
                  <td data-label={t("customer.type")}><div className="title-row">
                    <span className="badge"><Icon name={c.customer_type === "commercial" ? "building" : "home"} size={12} />{t(`customer.type.${c.customer_type}`)}</span>
                    {c.is_retainer && <span className="badge primary">{t("customer.retainer")}</span>}
                  </div></td>
                  <td data-label={t("customer.email")} onClick={(e) => e.stopPropagation()}>{c.email ? <a href={mailtoLink(c.email)}>{c.email}</a> : <span className="muted">—</span>}</td>
                  <td data-label={t("customer.phone")} onClick={(e) => e.stopPropagation()} className="nowrap">{phone ? <a href={telLink(phone)}>{phone}</a> : <span className="muted">—</span>}</td>
                  <td data-label={t("customers.repairs")}>{c.repair_count}{c.open_repairs > 0 && <span className="badge accent" style={{ marginLeft: 6 }}>{fill(t("customers.openCount"), { count: c.open_repairs })}</span>}</td>
                  <td data-label={t("customers.billed")} className="nowrap">{c.total_billed ? formatMoney(c.total_billed) : <span className="muted">—</span>}</td>
                </tr>
              );
            })}</tbody>
          </table></div>
        )}
      </section>
      {creating && <CustomerFormModal onClose={() => setCreating(false)} onSaved={(id) => { setCreating(false); navigate({ name: "customer", id }); }} />}
    </div>
  );
}
