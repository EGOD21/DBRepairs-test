import { useEffect, useState } from "react";
import { ActivityEntry, customerActivity, repairActivity } from "../data/billing";
import { formatDbDate } from "../data/dates";
import { useI18n } from "../i18n/I18nProvider";

const shown = (value: unknown) => (value === null || value === undefined || value === "" ? "—" : String(value));

export function ActivityList({ entries }: { entries: ActivityEntry[] }) {
  const { t } = useI18n();
  const [open, setOpen] = useState<number | null>(null);
  return (
    <div className="activity-list">
      {entries.map((entry) => {
        const changes = entry.changes ? Object.entries(entry.changes) : [];
        return (
          <div className="activity-item" key={entry.id}>
            <div className="activity-head">
              <strong>{entry.user_name ?? t("activity.system")}</strong>
              <span>{entry.summary ?? `${entry.action} ${entry.entity}`}</span>
              <time>{formatDbDate(entry.at)}</time>
            </div>
            {changes.length > 0 && (
              open === entry.id ? (
                <dl className="activity-changes">{changes.map(([field, [before, after]]) => (
                  <div key={field}><dt>{field}</dt><dd><s>{shown(before)}</s> → {shown(after)}</dd></div>
                ))}</dl>
              ) : <button type="button" className="link-button" onClick={() => setOpen(entry.id)}>{t("activity.showChanges")} ({changes.length})</button>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** Who changed what on this repair or customer, newest first. */
export default function ActivityCard({ repairId, customerId }: { repairId?: number; customerId?: number }) {
  const { t } = useI18n();
  const [entries, setEntries] = useState<ActivityEntry[]>([]);
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    (repairId ? repairActivity(repairId) : customerActivity(customerId!)).then(setEntries).catch(() => setEntries([]));
  }, [repairId, customerId]);
  const visible = expanded ? entries : entries.slice(0, 6);
  return (
    <section className="card">
      <div className="card-header"><h2>{t("activity.title")}</h2></div>
      <div className="card-body">
        {entries.length === 0 ? <p className="muted">{t("activity.empty")}</p> : <ActivityList entries={visible} />}
        {entries.length > 6 && !expanded && <button type="button" className="btn btn-sm" style={{ marginTop: 12 }} onClick={() => setExpanded(true)}>{t("activity.showAll")} ({entries.length})</button>}
      </div>
    </section>
  );
}
