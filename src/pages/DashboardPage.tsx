import { useEffect, useState } from "react";
import Icon, { IconName } from "../components/Icon";
import { PriorityBadge, StatusBadge } from "../components/Badges";
import { DashboardData, emptyStats, getDashboard } from "../data/dashboard";
import { isOverdue } from "../data/repairs";
import { formatDbDate } from "../data/dates";
import { deviceLabel, formatPlainDate } from "../lib/format";
import { useI18n } from "../i18n/I18nProvider";
import { href, navigate, Route } from "../router";

export default function DashboardPage() {
  const { t } = useI18n();
  const [data, setData] = useState<DashboardData>({ stats: emptyStats, recent: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let active = true;
    getDashboard()
      .then((result) => { if (active) setData(result); })
      .catch((cause) => { console.error(cause); if (active) setError(true); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

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
      <section className="card">
        <div className="card-header"><div><h2>{t("dashboard.recent")}</h2></div><a href={href({ name: "repairs" })}>{t("dashboard.viewAll")}</a></div>
        {data.recent.length === 0 ? <div className="empty">{loading ? t("common.loading") : t("repairs.empty")}</div> : (
          <div className="table-wrap"><table>
            <thead><tr><th>{t("repair.number")}</th><th>{t("repair.customer")}</th><th>{t("repair.device")}</th><th>{t("repair.status")}</th><th>{t("repair.dueDate")}</th><th>{t("repair.openedAt")}</th></tr></thead>
            <tbody>{data.recent.map((repair) => (
              <tr key={repair.id} className="clickable" onClick={() => navigate({ name: "repair", id: repair.id })}>
                <td><strong><a href={href({ name: "repair", id: repair.id })}>{repair.repair_number}</a></strong></td>
                <td>{repair.customer_name}</td>
                <td>{deviceLabel(repair)}</td>
                <td><div className="title-row"><StatusBadge code={repair.status_code} labelKey={repair.status_label_key} /><PriorityBadge priority={repair.priority} quiet /></div></td>
                <td className={isOverdue(repair) ? "nowrap" : "nowrap muted"} style={isOverdue(repair) ? { color: "var(--danger)", fontWeight: 600 } : undefined}>{formatPlainDate(repair.due_date)}</td>
                <td className="nowrap muted">{formatDbDate(repair.opened_at)}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </section>
    </div>
  );
}
