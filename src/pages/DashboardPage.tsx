import { useEffect, useState } from "react";
import Icon, { IconName } from "../components/Icon";
import { PriorityBadge, StatusBadge } from "../components/Badges";
import { DashboardData, emptyStats, getDashboard } from "../data/dashboard";
import { isOverdue } from "../data/repairs";
import { formatDbDate } from "../data/dates";
import { deviceLabel, formatClock, formatMinutes, formatMoney, formatPlainDate } from "../lib/format";
import { listTimers, RunningTimer } from "../data/billing";
import { Contract, listContracts, listSla, SlaRepair } from "../data/contracts";
import { UsageMeter } from "../components/ContractsCard";
import { fill } from "../lib/format";
import { useSession } from "../session";
import { useI18n } from "../i18n/I18nProvider";
import { href, navigate, Route } from "../router";

export default function DashboardPage() {
  const { t } = useI18n();
  const [data, setData] = useState<DashboardData>({ stats: emptyStats, recent: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const { teamFeatures } = useSession();
  const [timers, setTimers] = useState<RunningTimer[]>([]);
  const [sla, setSla] = useState<SlaRepair[]>([]);
  const [contracts, setContracts] = useState<Contract[]>([]);

  useEffect(() => {
    let active = true;
    getDashboard()
      .then((result) => { if (active) setData(result); })
      .catch((cause) => { console.error(cause); if (active) setError(true); })
      .finally(() => { if (active) setLoading(false); });
    if (teamFeatures) {
      listTimers().then((list) => { if (active) setTimers(list); }).catch(() => {});
      listSla().then((list) => { if (active) setSla(list); }).catch(() => {});
      listContracts({ active: true }).then((list) => { if (active) setContracts(list); }).catch(() => {});
    }
    return () => { active = false; };
  }, []);

  // Contracts renewing within 30 days, or at 80% or more of this month's hours.
  const soon = new Date(Date.now() + 30 * 86400_000).toISOString().slice(0, 10);
  const renewsSoon = (c: Contract) => Boolean(c.renewal_date && c.renewal_date <= soon);
  const attention = contracts.filter((c) => renewsSoon(c) || (c.hours_included > 0 && c.minutes_this_month / 60 >= c.hours_included * 0.8));

  const cards: { label: string; value: number; icon: IconName; to: Route; tone?: string }[] = [
    { label: t("dashboard.openRepairs"), value: data.stats.openRepairs, icon: "wrench", to: { name: "repairs", filter: "open" } },
    { label: t("dashboard.ready"), value: data.stats.ready, icon: "check", to: { name: "repairs", filter: "READY" } },
    { label: t("dashboard.waitingCustomer"), value: data.stats.waitingCustomer, icon: "clock", to: { name: "repairs", filter: "WAITING_CUSTOMER" } },
    { label: t("dashboard.overdue"), value: data.stats.overdue, icon: "alert", to: { name: "repairs", filter: "overdue" }, tone: data.stats.overdue ? "danger" : "" },
    { label: t("dashboard.partsToOrder"), value: data.stats.partsToOrder, icon: "package", to: { name: "parts" }, tone: data.stats.partsToOrder ? "warning" : "" },
    { label: t("dashboard.closedToday"), value: data.stats.closedToday, icon: "check", to: { name: "repairs", filter: "closed" } },
  ];

  return (
    <div className="page">
      <header className="page-header">
        <div><h1>{t("dashboard.title")}</h1><p>{t("dashboard.subtitle")}</p></div>
        <div className="page-actions"><a className="btn btn-primary" href={href({ name: "repairs", filter: "new" })}><Icon name="plus" size={16} />{t("repair.new")}</a></div>
      </header>
      {error && <div className="alert error">{t("database.error")}</div>}
      <section className="stat-grid">
        {cards.map((card) => (
          <a key={card.label} className={`stat ${card.tone ?? ""}`} href={href(card.to)}>
            <span><Icon name={card.icon} size={15} />{card.label}</span>
            <strong>{loading ? "…" : card.value}</strong>
          </a>
        ))}
      </section>
      {data.billing && (
        <section className="stat-grid">
          <a className="stat" href={href({ name: "billing" })}><span><Icon name="receipt" size={15} />{t("billing.outstanding")}</span><strong>{formatMoney(data.billing.outstanding)}</strong></a>
          <a className={`stat${data.billing.overdue_invoices ? " danger" : ""}`} href={href({ name: "billing" })}><span><Icon name="alert" size={15} />{t("billing.overdue")}</span><strong>{formatMoney(data.billing.overdue_amount)}</strong></a>
          <a className={`stat${data.billing.unbilled_minutes ? " warning" : ""}`} href={href({ name: "billing", tab: "time" })}><span><Icon name="clock" size={15} />{t("billing.unbilledTime")}</span><strong>{formatMinutes(data.billing.unbilled_minutes)}</strong></a>
          <a className="stat" href={href({ name: "billing", tab: "payments" })}><span><Icon name="dollar" size={15} />{t("billing.paidThisMonth")}</span><strong>{formatMoney(data.billing.paid_this_month)}</strong></a>
        </section>
      )}
      {sla.length > 0 && (
        <section className="card">
          <div className="card-header"><div><h2>{t("sla.waitingTitle")}</h2><p>{t("sla.waitingHint")}</p></div></div>
          <div className="card-body sla-list">{sla.map((item) => (
            <a key={item.id} className="sla-item" href={href({ name: "repair", id: item.id })}>
              <span className={`badge ${item.seconds_left < 0 ? "danger" : item.seconds_left < 7200 ? "warning" : "accent"}`}><Icon name="clock" size={12} />
                {item.seconds_left < 0 ? fill(t("sla.late"), { time: `${Math.round(-item.seconds_left / 3600 * 10) / 10} h` }) : fill(t("sla.left"), { time: `${Math.round(item.seconds_left / 3600 * 10) / 10} h` })}</span>
              <strong>{item.repair_number}</strong><span>{item.customer_name}</span><span className="muted">{deviceLabel(item)}</span>
            </a>
          ))}</div>
        </section>
      )}
      {attention.length > 0 && (
        <section className="card">
          <div className="card-header"><div><h2>{t("contract.attentionTitle")}</h2><p>{t("contract.attentionHint")}</p></div></div>
          <div className="contract-list">{attention.map((contract) => (
            <a key={contract.id} className="contract-item" href={href({ name: "customer", id: contract.customer_id })} style={{ color: "inherit", textDecoration: "none" }}>
              <div className="contract-head"><strong>{contract.customer_name}</strong><span className="muted">{contract.name}</span>
                {renewsSoon(contract) && <span className="badge warning">{t("contract.renews")} {formatPlainDate(contract.renewal_date)}</span>}</div>
              <UsageMeter minutes={contract.minutes_this_month} hoursIncluded={contract.hours_included} />
            </a>
          ))}</div>
        </section>
      )}
      {timers.length > 0 && (
        <section className="card">
          <div className="card-header"><h2>{t("time.workingNow")}</h2></div>
          <div className="card-body working-now">{timers.map((timer) => (
            <a key={timer.user_id} className="working-item" href={timer.repair_id ? href({ name: "repair", id: timer.repair_id }) : href({ name: "customer", id: timer.customer_id })}>
              <span className="timer-dot" /><strong>{timer.user_name}</strong><span>{timer.repair_number ?? timer.customer_name}</span><span className="muted">{formatClock(timer.elapsed_seconds)}</span>
            </a>
          ))}</div>
        </section>
      )}
      <section className="card">
        <div className="card-header"><div><h2>{t("dashboard.recent")}</h2></div><a href={href({ name: "repairs" })}>{t("dashboard.viewAll")}</a></div>
        {data.recent.length === 0 ? <div className="empty">{loading ? t("common.loading") : t("repairs.empty")}</div> : (
          <div className="table-wrap"><table className="responsive">
            <thead><tr><th>{t("repair.number")}</th><th>{t("repair.customer")}</th><th>{t("repair.device")}</th><th>{t("repair.status")}</th><th>{t("repair.dueDate")}</th><th>{t("repair.openedAt")}</th></tr></thead>
            <tbody>{data.recent.map((repair) => (
              <tr key={repair.id} className="clickable" onClick={() => navigate({ name: "repair", id: repair.id })}>
                <td data-label={t("repair.number")} className="cell-title"><strong><a href={href({ name: "repair", id: repair.id })}>{repair.repair_number}</a></strong></td>
                <td data-label={t("repair.customer")}>{repair.customer_name}</td>
                <td data-label={t("repair.device")}>{deviceLabel(repair)}</td>
                <td data-label={t("repair.status")}><div className="title-row"><StatusBadge code={repair.status_code} labelKey={repair.status_label_key} /><PriorityBadge priority={repair.priority} quiet /></div></td>
                <td data-label={t("repair.dueDate")} className={isOverdue(repair) ? "nowrap" : "nowrap muted"} style={isOverdue(repair) ? { color: "var(--danger)", fontWeight: 600 } : undefined}>{formatPlainDate(repair.due_date)}</td>
                <td data-label={t("repair.openedAt")} className="nowrap muted">{formatDbDate(repair.opened_at)}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </section>
    </div>
  );
}
