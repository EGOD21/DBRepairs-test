import { useEffect, useMemo, useState } from "react";
import Icon from "../components/Icon";
import Modal from "../components/Modal";
import AppointmentModal from "../components/AppointmentModal";
import { Appointment, calendarLink, listAppointments, resetCalendarLink } from "../data/shopfloor";
import { useI18n } from "../i18n/I18nProvider";
import { useSession } from "../session";
import { href } from "../router";

function startOfWeek(date: Date) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const day = (d.getDay() + 6) % 7; // Monday first
  d.setDate(d.getDate() - day);
  return d;
}
const addDays = (date: Date, days: number) => new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
const time = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });

/** The week's on-site visits, remote sessions, drop-offs and pickups. */
export default function SchedulePage() {
  const { t } = useI18n();
  const { user } = useSession();
  const [week, setWeek] = useState(() => startOfWeek(new Date()));
  const [items, setItems] = useState<Appointment[]>([]);
  const [mine, setMine] = useState(false);
  const [editing, setEditing] = useState<{ appointment: Appointment | null; start?: Date } | null>(null);
  const [subscribing, setSubscribing] = useState(false);
  const [error, setError] = useState("");

  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(week, i)), [week]);
  const load = () => listAppointments({ from: week.toISOString(), to: addDays(week, 7).toISOString(), userId: mine ? user?.id : undefined })
    .then(setItems).catch(() => setError(t("common.databaseError")));
  useEffect(() => { void load(); }, [week, mine]);

  const today = new Date();
  const label = `${days[0].toLocaleDateString(undefined, { day: "numeric", month: "short" })} – ${days[6].toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}`;

  return (
    <div className="page">
      <header className="page-header">
        <div><h1>{t("schedule.pageTitle")}</h1><p>{t("schedule.subtitle")}</p></div>
        <div className="page-actions">
          <button type="button" className="btn" onClick={() => setSubscribing(true)}><Icon name="calendar" size={16} />{t("schedule.subscribe")}</button>
          <button type="button" className="btn btn-primary" onClick={() => setEditing({ appointment: null })}><Icon name="plus" size={16} />{t("schedule.add")}</button>
        </div>
      </header>
      <section className="card">
        <div className="toolbar">
          <div className="page-actions">
            <button type="button" className="btn btn-sm btn-icon" onClick={() => setWeek(addDays(week, -7))} aria-label={t("contract.previous")}><Icon name="chevronLeft" size={16} /></button>
            <button type="button" className="btn btn-sm" onClick={() => setWeek(startOfWeek(new Date()))}>{t("schedule.today")}</button>
            <button type="button" className="btn btn-sm btn-icon" onClick={() => setWeek(addDays(week, 7))} aria-label={t("contract.next")}><Icon name="chevronRight" size={16} /></button>
            <strong>{label}</strong>
          </div>
          <label className="check"><input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} />{t("schedule.onlyMine")}</label>
        </div>
        {error && <div className="card-body"><div className="alert error">{error}</div></div>}
        <div className="week-grid">
          {days.map((day) => {
            const list = items.filter((a) => sameDay(new Date(a.starts_at), day) || (a.all_day && new Date(a.starts_at) <= day && new Date(a.ends_at) >= day));
            return (
              <div key={day.toISOString()} className={`week-day${sameDay(day, today) ? " today" : ""}`}>
                <button type="button" className="week-day-head" onClick={() => setEditing({ appointment: null, start: new Date(day.getFullYear(), day.getMonth(), day.getDate(), 9) })} title={t("schedule.add")}>
                  <span>{day.toLocaleDateString(undefined, { weekday: "short" })}</span><strong>{day.getDate()}</strong>
                </button>
                <div className="week-day-items">
                  {list.length === 0 && <span className="week-empty">—</span>}
                  {list.map((a) => (
                    <button key={a.id} type="button" className={`appointment kind-${a.kind} status-${a.status}`} onClick={() => setEditing({ appointment: a })}>
                      <span className="appointment-time">{a.all_day ? t("schedule.allDay") : `${time(a.starts_at)}–${time(a.ends_at)}`}</span>
                      <strong>{a.title}</strong>
                      {a.customer_name && <span>{a.customer_name}</span>}
                      <span className="appointment-meta">{t(`schedule.kind.${a.kind}`)}{a.user_name ? ` · ${a.user_name}` : ""}{a.repair_number ? ` · ${a.repair_number}` : ""}</span>
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </section>
      {editing && <AppointmentModal appointment={editing.appointment} initial={editing.start ? { starts_at: editing.start.toISOString() } : undefined}
        onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void load(); }} />}
      {subscribing && <SubscribeModal onClose={() => setSubscribing(false)} />}
    </div>
  );
}

function SubscribeModal({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const [url, setUrl] = useState("");
  const [copied, setCopied] = useState(false);
  useEffect(() => { calendarLink().then((r) => setUrl(`${window.location.origin}${r.path}`)).catch(() => {}); }, []);
  async function copy() { try { await navigator.clipboard.writeText(url); setCopied(true); } catch { /* select and copy by hand */ } }
  async function reset() {
    if (!window.confirm(t("schedule.resetConfirm"))) return;
    const r = await resetCalendarLink();
    setUrl(`${window.location.origin}${r.path}`); setCopied(false);
  }
  return (
    <Modal title={t("schedule.subscribe")} subtitle={t("schedule.subscribeHint")} onClose={onClose}
      footer={<><button type="button" className="btn btn-danger" style={{ marginRight: "auto" }} onClick={() => void reset()}>{t("schedule.resetLink")}</button>
        <button type="button" className="btn" onClick={onClose}>{t("common.close")}</button>
        <button type="button" className="btn btn-primary" onClick={() => void copy()}><Icon name={copied ? "check" : "copy"} size={15} />{copied ? t("vault.copied") : t("vault.copy")}</button></>}>
      <div className="modal-body">
        <input className="input mono" readOnly value={url} onFocus={(e) => (e.currentTarget as HTMLInputElement).select()} />
        <ol className="steps">
          <li>{t("schedule.stepIphone")}</li>
          <li>{t("schedule.stepGoogle")}</li>
          <li>{t("schedule.stepPrivate")}</li>
        </ol>
        <p className="hint">{t("schedule.tailnetHint")} <a href={href({ name: "settings", section: "account" })}>{t("account.title")}</a></p>
      </div>
    </Modal>
  );
}
