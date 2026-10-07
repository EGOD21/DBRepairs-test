import { useEffect, useState } from "react";
import Icon from "../components/Icon";
import { BarList, ColumnChart } from "../components/Charts";
import { exportUrl, getReport, Report } from "../data/contracts";
import { formatMinutes, formatMoney, todayIso } from "../lib/format";
import { useI18n } from "../i18n/I18nProvider";
import { href } from "../router";

const presets = ["month", "quarter", "year", "last12"] as const;
type Preset = typeof presets[number];

function presetRange(preset: Preset): [string, string] {
  const today = todayIso();
  const now = new Date();
  const iso = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  if (preset === "month") return [`${today.slice(0, 7)}-01`, today];
  if (preset === "quarter") return [iso(new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1)), today];
  if (preset === "year") return [`${today.slice(0, 4)}-01-01`, today];
  return [iso(new Date(now.getFullYear(), now.getMonth() - 11, 1)), today];
}

const monthLabel = (month: string) => new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1, 1).toLocaleDateString(undefined, { month: "short", year: "2-digit" });

export default function ReportsPage() {
  const { t } = useI18n();
  const [preset, setPreset] = useState<Preset | "custom">("year");
  const [[from, to], setRange] = useState(presetRange("year"));
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState("");
  const [format, setFormat] = useState("quickbooks");

  useEffect(() => { setReport(null); getReport(from, to).then(setReport).catch((cause) => setError(cause instanceof Error ? cause.message : t("common.databaseError"))); }, [from, to]);

  const money = (n: number) => formatMoney(n);
  const hours = (minutes: number) => formatMinutes(minutes);
  const collected = report?.revenue.reduce((s, r) => s + r.amount, 0) ?? 0;
  const invoiced = report?.invoiced.reduce((s, r) => s + r.amount, 0) ?? 0;
  const owed = report ? Object.values(report.aging).reduce((s, v) => s + v, 0) : 0;
  const slaRate = report && report.sla.total ? Math.round((report.sla.met / report.sla.total) * 100) : null;
  const closed = report?.turnaround.reduce((s, r) => s + r.count, 0) ?? 0;
  const avgDays = report && closed ? report.turnaround.reduce((s, r) => s + r.avg_days * r.count, 0) / closed : null;

  // Months with invoices but no payments still get a column.
  const months = report ? [...new Set([...report.revenue.map((r) => r.month), ...report.invoiced.map((r) => r.month)])].sort() : [];

  return (
    <div className="page">
      <header className="page-header"><div><h1>{t("reports.title")}</h1><p>{t("reports.subtitle")}</p></div></header>
      <section className="card">
        <div className="toolbar">
          <div className="segmented" role="group">
            {presets.map((p) => <button key={p} type="button" className={preset === p ? "active" : ""} onClick={() => { setPreset(p); setRange(presetRange(p)); }}>{t(`reports.preset.${p}`)}</button>)}
          </div>
          <input className="input" type="date" value={from} max={to} onChange={(e) => { setPreset("custom"); setRange([e.target.value, to]); }} aria-label={t("reports.from")} />
          <input className="input" type="date" value={to} min={from} onChange={(e) => { setPreset("custom"); setRange([from, e.target.value]); }} aria-label={t("reports.to")} />
        </div>
      </section>
      {error && <div className="alert error">{error}</div>}
      {!report ? <div className="empty">{t("common.loading")}</div> : (<>
        <section className="stat-grid">
          <div className="stat"><span><Icon name="dollar" size={15} />{t("reports.collected")}</span><strong>{money(collected)}</strong></div>
          <div className="stat"><span><Icon name="receipt" size={15} />{t("reports.invoiced")}</span><strong>{money(invoiced)}</strong></div>
          <a className="stat" href={href({ name: "billing" })}><span><Icon name="alert" size={15} />{t("reports.owedNow")}</span><strong>{money(owed)}</strong></a>
          <div className="stat"><span><Icon name="clock" size={15} />{t("reports.turnaround")}</span><strong>{avgDays === null ? "—" : `${avgDays.toFixed(1)} ${t("reports.days")}`}</strong></div>
          <div className={`stat${slaRate !== null && slaRate < 90 ? " warning" : ""}`}><span><Icon name="check" size={15} />{t("reports.slaMet")}</span><strong>{slaRate === null ? "—" : `${slaRate}%`}</strong></div>
        </section>
        <div className="report-grid">
          <div className="wide">
            <ColumnChart title={t("reports.revenueTitle")} subtitle={t("reports.revenueHint")} labelHeader={t("reports.month")} empty={t("reports.noData")} format={money}
              series={[{ name: t("reports.collected"), slot: 1 }]}
              data={months.map((m) => ({ label: monthLabel(m), values: [report.revenue.find((r) => r.month === m)?.amount ?? 0] }))} />
          </div>
          <BarList title={t("reports.agingTitle")} subtitle={t("reports.agingHint")} labelHeader={t("reports.age")} empty={t("reports.noData")} format={money}
            series={[{ name: t("billing.balance"), slot: 1 }]}
            data={[["current", report.aging.current], ["d30", report.aging.d30], ["d60", report.aging.d60], ["d90", report.aging.d90], ["older", report.aging.older]]
              .map(([key, value]) => ({ label: t(`reports.aging.${key}`), values: [Number(value)] }))} />
          <BarList title={t("reports.hoursTitle")} subtitle={t("reports.hoursHint")} labelHeader={t("time.technician")} empty={t("reports.noData")} format={hours}
            series={[{ name: t("time.billable"), slot: 1 }, { name: t("time.notBillable"), slot: 2 }]}
            data={report.hours.map((h) => ({ label: h.technician, values: [h.billable_minutes ?? 0, h.other_minutes ?? 0] }))} />
          <BarList title={t("reports.customersTitle")} subtitle={t("reports.customersHint")} labelHeader={t("repair.customer")} empty={t("reports.noData")} format={money}
            series={[{ name: t("reports.collected"), slot: 1 }]}
            data={report.customers.map((c) => ({ label: c.name, values: [c.amount], href: href({ name: "customer", id: c.id }) }))} />
          <BarList title={t("reports.devicesTitle")} subtitle={t("reports.devicesHint")} labelHeader={t("repair.deviceType")} empty={t("reports.noData")} format={(n) => String(Math.round(n))}
            series={[{ name: t("reports.repairs"), slot: 1 }]}
            data={report.devices.map((d) => ({ label: d.device_type, values: [d.count] }))} />
          <ColumnChart title={t("reports.turnaroundTitle")} subtitle={t("reports.turnaroundHint")} labelHeader={t("reports.month")} empty={t("reports.noData")} format={(n) => `${n.toFixed(1)} ${t("reports.days")}`}
            series={[{ name: t("reports.median"), slot: 1 }]}
            data={report.turnaround.map((r) => ({ label: monthLabel(r.month), values: [r.median_days] }))} />
          <BarList title={t("reports.statusTitle")} subtitle={t("reports.statusHint")} labelHeader={t("repair.status")} empty={t("reports.noData")} format={(n) => String(Math.round(n))}
            series={[{ name: t("reports.repairs"), slot: 1 }]}
            data={report.statuses.filter((s) => s.count > 0).map((s) => ({ label: t(s.label_key), values: [s.count] }))} />
          {report.contracts.length > 0 && (
            <section className="card wide">
              <div className="card-header"><div><h2>{t("reports.contractsTitle")}</h2><p>{t("reports.contractsHint")}</p></div></div>
              <div className="table-wrap"><table className="responsive">
                <thead><tr><th>{t("contract.name")}</th><th className="num">{t("reports.invoiced")}</th><th className="num">{t("reports.hoursWorked")}</th><th className="num">{t("reports.perHour")}</th></tr></thead>
                <tbody>{report.contracts.map((c) => (
                  <tr key={c.id}>
                    <td data-label={t("contract.name")} className="cell-title"><strong>{c.name}</strong><div className="muted" style={{ fontSize: 12 }}>{c.customer_name}</div></td>
                    <td data-label={t("reports.invoiced")} className="num">{money(c.invoiced)}</td>
                    <td data-label={t("reports.hoursWorked")} className="num">{hours(c.minutes)}</td>
                    <td data-label={t("reports.perHour")} className="num">{c.minutes ? money(c.invoiced / (c.minutes / 60)) : "—"}</td>
                  </tr>
                ))}</tbody>
              </table></div>
            </section>
          )}
          <section className="card wide">
            <div className="card-header"><div><h2>{t("reports.exportTitle")}</h2><p>{t("reports.exportHint")}</p></div></div>
            <div className="card-body">
              <div className="inline-form">
                <select value={format} onChange={(e) => setFormat(e.target.value)} aria-label={t("reports.format")}>
                  <option value="quickbooks">QuickBooks Online</option><option value="xero">Xero</option><option value="plain">{t("reports.plainCsv")}</option>
                </select>
                <a className="btn" href={exportUrl("invoices", format, from, to)} download><Icon name="download" size={15} />{t("billing.tab.invoices")}</a>
                <a className="btn" href={exportUrl("payments", format, from, to)} download><Icon name="download" size={15} />{t("billing.tab.payments")}</a>
                <a className="btn" href={exportUrl("time", "plain", from, to)} download><Icon name="download" size={15} />{t("billing.tab.time")}</a>
              </div>
            </div>
          </section>
        </div>
      </>)}
    </div>
  );
}
