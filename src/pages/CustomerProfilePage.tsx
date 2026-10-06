import { useEffect, useState } from "react";
import Icon from "../components/Icon";
import { PriorityBadge, StatusBadge } from "../components/Badges";
import CustomerFormModal from "../components/CustomerFormModal";
import { Customer, deleteCustomer, getCustomer, toCustomerInput } from "../data/customers";
import { isOverdue, listRepairsByCustomer, Repair } from "../data/repairs";
import { getSettings } from "../data/settings";
import { formatDbDate } from "../data/dates";
import { deviceLabel, fill, formatMoney, formatPlainDate, formatDay } from "../lib/format";
import { mailtoLink, smsLink, telLink } from "../lib/email";
import { emailSignature } from "../lib/emailTemplates";
import { useI18n } from "../i18n/I18nProvider";
import { href, navigate } from "../router";

export default function CustomerProfilePage({ id }: { id: number }) {
  const { t } = useI18n();
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [repairs, setRepairs] = useState<Repair[]>([]);
  const [signature, setSignature] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(false);

  async function load() {
    const [c, r] = await Promise.all([getCustomer(id), listRepairsByCustomer(id)]);
    setCustomer(c);
    setRepairs(r);
  }

  useEffect(() => {
    Promise.all([load(), getSettings().then((s) => setSignature(emailSignature(s)))])
      .catch((cause) => { console.error(cause); setError(t("common.databaseError")); })
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) return <div className="page"><div className="empty">{t("common.loading")}</div></div>;
  if (!customer) return <div className="page"><a className="back-link" href={href({ name: "customers" })}><Icon name="back" size={15} />{t("nav.customers")}</a><div className="empty"><strong>{error || t("customer.notFound")}</strong></div></div>;

  async function remove() {
    if (!customer || !window.confirm(t("customers.deleteConfirm").replace("{name}", customer.name))) return;
    try {
      await deleteCustomer(customer.id);
      navigate({ name: "customers" });
    } catch {
      setError(t("customers.deleteBlocked"));
    }
  }

  const phone = customer.mobile || customer.phone;
  const commercial = customer.customer_type === "commercial";
  const greeting = (commercial ? customer.contact_person : customer.name)?.split(/\s+/)[0] ?? "";
  const emailHref = mailtoLink(customer.email, "", fill(t("email.greeting"), { name: greeting }) + `\n\n\n${signature}`);
  const tags = (customer.tags ?? "").split(",").map((tag) => tag.trim()).filter(Boolean);
  const info: [string, string | null][] = [
    [commercial ? t("customer.contactPerson") : t("customer.company"), commercial ? customer.contact_person : customer.company],
    [commercial ? t("customer.legalName") : "", commercial ? customer.company : null],
    [t("customer.taxNumber"), customer.tax_number],
    [t("customer.phone"), customer.phone],
    [t("customer.mobile"), customer.mobile],
    [t("customer.preferredContact"), customer.preferred_contact ? t(`customer.contact.${customer.preferred_contact}`) : null],
    [t("customer.address"), customer.address],
    [t("customer.since"), formatDay(customer.created_at)],
  ];

  return (
    <div className="page">
      <a className="back-link" href={href({ name: "customers" })}><Icon name="back" size={15} />{t("nav.customers")}</a>
      <header className="page-header">
        <div>
          <div className="title-row">
            <h1>{customer.name}</h1>
            <span className="badge"><Icon name={commercial ? "building" : "home"} size={12} />{t(`customer.type.${customer.customer_type}`)}</span>
            {customer.is_retainer && <span className="badge primary">{t("customer.retainer")}{customer.retainer_plan ? ` · ${customer.retainer_plan}` : ""}</span>}
            {tags.map((tag) => <span key={tag} className="badge"><Icon name="tag" size={11} />{tag}</span>)}
          </div>
          {customer.email && <p><a href={mailtoLink(customer.email)}>{customer.email}</a></p>}
        </div>
        <div className="page-actions">
          {customer.email && <a className="btn" href={emailHref}><Icon name="mail" size={16} />{t("email.send")}</a>}
          {phone && <a className="btn" href={telLink(phone)}><Icon name="phone" size={16} />{t("customer.call")}</a>}
          {customer.mobile && <a className="btn btn-icon" href={smsLink(customer.mobile)} title={t("customer.text")} aria-label={t("customer.text")}><Icon name="message" size={16} /></a>}
          <button type="button" className="btn" onClick={() => setEditing(true)}><Icon name="pencil" size={16} />{t("common.edit")}</button>
          <button type="button" className="btn btn-icon btn-danger" onClick={() => void remove()} title={t("common.delete")} aria-label={t("common.delete")}><Icon name="trash" size={16} /></button>
          <a className="btn btn-primary" href={href({ name: "repairs", filter: `new:${customer.id}` })}><Icon name="plus" size={16} />{t("repair.new")}</a>
        </div>
      </header>
      {error && <div className="alert error">{error}</div>}

      <section className="stat-grid">
        <div className="stat"><span>{t("customers.repairs")}</span><strong>{customer.repair_count}</strong></div>
        <div className="stat"><span>{t("customer.openRepairs")}</span><strong>{customer.open_repairs}</strong></div>
        <div className="stat"><span>{t("customers.billed")}</span><strong>{formatMoney(customer.total_billed)}</strong></div>
        <div className="stat"><span>{t("customer.lastVisit")}</span><strong style={{ fontSize: 18 }}>{formatDay(customer.last_repair_at)}</strong></div>
      </section>

      <div className="detail-grid">
        <div className="detail-main">
          <section className="card">
            <div className="card-header"><div><h2>{t("customers.repairsTitle")}</h2><p>{t("customers.repairsHint")}</p></div></div>
            {repairs.length === 0 ? <div className="empty">{t("customers.repairsEmpty")}</div> : (
              <div className="table-wrap"><table className="responsive">
                <thead><tr><th>{t("repair.number")}</th><th>{t("repair.device")}</th><th>{t("repair.status")}</th><th>{t("repair.dueDate")}</th><th>{t("repair.finalValue")}</th><th>{t("repair.openedAt")}</th></tr></thead>
                <tbody>{repairs.map((r) => (
                  <tr key={r.id} className="clickable" onClick={() => navigate({ name: "repair", id: r.id })}>
                    <td data-label={t("repair.number")} className="cell-title nowrap"><strong><a href={href({ name: "repair", id: r.id })}>{r.repair_number}</a></strong></td>
                    <td data-label={t("repair.device")}>{deviceLabel(r)}</td>
                    <td data-label={t("repair.status")}><div className="title-row"><StatusBadge code={r.status_code} labelKey={r.status_label_key} /><PriorityBadge priority={r.priority} quiet /></div></td>
                    <td data-label={t("repair.dueDate")} className="nowrap" style={isOverdue(r) ? { color: "var(--danger)", fontWeight: 600 } : undefined}>{formatPlainDate(r.due_date)}</td>
                    <td data-label={t("repair.finalValue")} className="nowrap">{formatMoney(r.final_value ?? r.estimated_value)}</td>
                    <td data-label={t("repair.openedAt")} className="nowrap muted">{formatDbDate(r.opened_at)}</td>
                  </tr>
                ))}</tbody>
              </table></div>
            )}
          </section>
          {customer.notes && <section className="card"><div className="card-header"><h2>{t("customer.notes")}</h2></div><div className="card-body" style={{ whiteSpace: "pre-wrap" }}>{customer.notes}</div></section>}
        </div>
        <div className="detail-side">
          <section className="card">
            <div className="card-header"><h2>{t("customer.details")}</h2></div>
            <div className="card-body">
              <dl className="info-list">{info.filter(([label, value]) => label && value).map(([label, value]) => (
                <div key={label}><dt>{label}</dt><dd>{value}</dd></div>
              ))}</dl>
            </div>
          </section>
          {customer.is_retainer && (
            <section className="card">
              <div className="card-header"><h2>{t("customer.section.retainer")}</h2></div>
              <div className="card-body">
                <dl className="info-list">
                  <div><dt>{t("customer.retainerPlan")}</dt><dd>{customer.retainer_plan || "—"}</dd></div>
                  <div><dt>{t("customer.retainerMonthlyFee")}</dt><dd>{formatMoney(customer.retainer_monthly_fee)}</dd></div>
                  <div><dt>{t("customer.retainerRenewalDate")}</dt><dd>{formatPlainDate(customer.retainer_renewal_date)}</dd></div>
                </dl>
              </div>
            </section>
          )}
        </div>
      </div>
      {editing && <CustomerFormModal customerId={customer.id} initial={toCustomerInput(customer)} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); void load(); }} />}
    </div>
  );
}
