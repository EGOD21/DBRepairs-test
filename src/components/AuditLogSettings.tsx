import { useEffect, useState } from "react";
import { ActivityList } from "./ActivityCard";
import { ActivityEntry, auditLog } from "../data/billing";
import { useI18n } from "../i18n/I18nProvider";

const entities = ["", "repair", "customer", "invoice", "estimate", "payment", "time", "part", "user", "settings", "backup", "photo"];

/** Settings > Activity log: every change, newest first, 100 at a time. */
export default function AuditLogSettings() {
  const { t } = useI18n();
  const [entries, setEntries] = useState<ActivityEntry[]>([]);
  const [entity, setEntity] = useState("");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [more, setMore] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    auditLog({ entity, search: query, from, to }).then((rows) => { setEntries(rows); setMore(rows.length === 100); }).catch(() => setError(t("common.databaseError")));
  }, [entity, query, from, to]);

  async function loadMore() {
    const rows = await auditLog({ entity, search: query, from, to, before: entries[entries.length - 1]?.id });
    setEntries((current) => [...current, ...rows]);
    setMore(rows.length === 100);
  }

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <div className="inline-form">
        <select value={entity} onChange={(e) => setEntity(e.target.value)} aria-label={t("activity.type")}>
          {entities.map((value) => <option key={value} value={value}>{value ? t(`activity.entity.${value}`) : t("activity.allTypes")}</option>)}
        </select>
        <input type="search" value={search} placeholder={t("activity.search")} onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") setQuery(search); }} onBlur={() => setQuery(search)} />
        <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label={t("reports.from")} />
        <input type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-label={t("reports.to")} />
      </div>
      {error && <div className="alert error">{error}</div>}
      {entries.length === 0 ? <p className="muted">{t("activity.empty")}</p> : <ActivityList entries={entries} />}
      {more && <button type="button" className="btn" onClick={() => void loadMore()}>{t("activity.loadMore")}</button>}
    </div>
  );
}
