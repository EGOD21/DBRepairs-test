import { useEffect, useState } from "react";
import Icon from "./Icon";
import TimeEntryModal from "./TimeEntryModal";
import { announceTimer, deleteTime, getTimer, listTime, RunningTimer, startTimer, stopTimer, TimeEntry, timerChangedEvent } from "../data/billing";
import { formatClock, formatMinutes, formatPlainDate } from "../lib/format";
import { useI18n } from "../i18n/I18nProvider";
import { useSession } from "../session";
import { href } from "../router";

type Props = { repairId?: number; customerId: number; title?: string };

/** Hours on a repair (or for a customer), with a start/stop timer and manual entries. */
export default function TimeCard({ repairId, customerId, title }: Props) {
  const { t } = useI18n();
  const { user, isAdmin } = useSession();
  const [entries, setEntries] = useState<TimeEntry[]>([]);
  const [timer, setTimer] = useState<RunningTimer | null>(null);
  const [tick, setTick] = useState(0);
  const [editing, setEditing] = useState<TimeEntry | null | "new">(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const load = () => Promise.all([
    listTime(repairId ? { repairId } : { customerId }).then(setEntries),
    getTimer().then((current) => { setTimer(current); setTick(0); }),
  ]).catch(() => setError(t("common.databaseError")));

  useEffect(() => { void load(); }, [repairId, customerId]);
  useEffect(() => {
    const refresh = () => void getTimer().then((current) => { setTimer(current); setTick(0); }).catch(() => {});
    window.addEventListener(timerChangedEvent, refresh);
    return () => window.removeEventListener(timerChangedEvent, refresh);
  }, []);
  useEffect(() => {
    if (!timer) return;
    const id = window.setInterval(() => setTick((value) => value + 1), 1000);
    return () => window.clearInterval(id);
  }, [timer]);

  const timerHere = timer && (repairId ? timer.repair_id === repairId : timer.customer_id === customerId && !timer.repair_id);

  async function toggleTimer() {
    setBusy(true); setError("");
    try {
      if (timerHere) await stopTimer();
      else await startTimer(repairId ? { repair_id: repairId } : { customer_id: customerId });
      announceTimer();
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("common.saveError"));
    } finally {
      setBusy(false);
    }
  }

  async function remove(entry: TimeEntry) {
    if (!window.confirm(t("time.deleteConfirm"))) return;
    try {
      await deleteTime(entry.id);
      setEntries((list) => list.filter((item) => item.id !== entry.id));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("common.saveError"));
    }
  }

  const total = entries.reduce((sum, entry) => sum + entry.minutes, 0);
  const unbilled = entries.filter((entry) => entry.billable && !entry.invoice_id).reduce((sum, entry) => sum + entry.minutes, 0);
  const canEdit = (entry: TimeEntry) => !entry.invoice_id && (isAdmin || entry.user_id === user?.id);

  return (
    <section className="card">
      <div className="card-header">
        <div><h2>{title ?? t("time.title")}</h2><p>{t("time.total")}: <strong>{formatMinutes(total)}</strong> · {t("time.unbilled")}: <strong>{formatMinutes(unbilled)}</strong></p></div>
        <div className="card-actions">
          <button type="button" className="btn btn-sm" onClick={() => setEditing("new")}><Icon name="plus" size={15} />{t("time.add")}</button>
          <button type="button" className={`btn btn-sm ${timerHere ? "btn-danger" : "btn-primary"}`} disabled={busy} onClick={() => void toggleTimer()}>
            <Icon name="clock" size={15} />{timerHere ? `${t("time.stop")} ${formatClock(timer!.elapsed_seconds + tick)}` : t("time.start")}
          </button>
        </div>
      </div>
      {timer && !timerHere && (
        <div className="card-note">{t("time.runningElsewhere")}{" "}
          <a href={timer.repair_id ? href({ name: "repair", id: timer.repair_id }) : href({ name: "customer", id: timer.customer_id })}>{timer.repair_number ?? timer.customer_name}</a>
          {" "}· {t("time.startReplaces")}
        </div>
      )}
      {error && <div className="card-body" style={{ paddingBottom: 0 }}><div className="alert error">{error}</div></div>}
      {entries.length === 0 ? <div className="empty">{t("time.empty")}</div> : (
        <div className="table-wrap"><table className="responsive compact">
          <thead><tr><th>{t("time.date")}</th><th>{t("time.technician")}</th><th>{t("time.duration")}</th><th>{t("time.description")}</th><th>{t("time.billing")}</th><th /></tr></thead>
          <tbody>{entries.map((entry) => (
            <tr key={entry.id}>
              <td data-label={t("time.date")} className="cell-title nowrap"><strong>{formatPlainDate(entry.work_date)}</strong>{!repairId && entry.repair_number && <> · <a href={href({ name: "repair", id: entry.repair_id! })}>{entry.repair_number}</a></>}</td>
              <td data-label={t("time.technician")}>{entry.technician ?? "—"}</td>
              <td data-label={t("time.duration")} className="nowrap">{formatMinutes(entry.minutes)}</td>
              <td data-label={t("time.description")}>{entry.description || "—"}</td>
              <td data-label={t("time.billing")}>{!entry.billable ? <span className="badge">{t("time.notBillable")}</span>
                : entry.invoice_id ? <a className="badge success" href={href({ name: "invoice", id: entry.invoice_id })}>{entry.invoice_number}</a>
                  : <span className="badge warning">{t("time.unbilled")}</span>}</td>
              <td className="actions">{canEdit(entry) && <div className="page-actions">
                <button type="button" className="btn btn-sm btn-icon btn-ghost" onClick={() => setEditing(entry)} aria-label={t("common.edit")}><Icon name="pencil" size={14} /></button>
                <button type="button" className="btn btn-sm btn-icon btn-ghost" onClick={() => void remove(entry)} aria-label={t("common.delete")}><Icon name="trash" size={14} /></button>
              </div>}</td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
      {editing && <TimeEntryModal target={{ repairId, customerId }} entry={editing === "new" ? null : editing} onClose={() => setEditing(null)}
        onSaved={() => { setEditing(null); void load(); }} />}
    </section>
  );
}
