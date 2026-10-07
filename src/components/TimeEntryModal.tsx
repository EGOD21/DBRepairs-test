import { useState } from "react";
import Modal from "./Modal";
import { createTime, TimeEntry, updateTime } from "../data/billing";
import { todayIso } from "../lib/format";
import { useI18n } from "../i18n/I18nProvider";
import { useSession } from "../session";

type Props = {
  target: { repairId?: number | null; customerId: number };
  entry?: TimeEntry | null;
  onClose: () => void;
  onSaved: (entry: TimeEntry) => void;
};

/** Log hours by hand (work done before the timer was started, on-site visits, phone support). */
export default function TimeEntryModal({ target, entry, onClose, onSaved }: Props) {
  const { t } = useI18n();
  const { isAdmin } = useSession();
  const [date, setDate] = useState(entry?.work_date ?? todayIso());
  const [hours, setHours] = useState(String(entry ? Math.floor(entry.minutes / 60) : 0));
  const [minutes, setMinutes] = useState(String(entry ? entry.minutes % 60 : 30));
  const [description, setDescription] = useState(entry?.description ?? "");
  const [billable, setBillable] = useState(entry?.billable ?? true);
  const [rate, setRate] = useState(entry?.hourly_rate?.toString() ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const total = (Number(hours) || 0) * 60 + (Number(minutes) || 0);

  async function save() {
    if (total < 1 || total > 1440) { setError(t("time.invalidDuration")); return; }
    setBusy(true); setError("");
    const input = {
      repair_id: entry ? entry.repair_id : target.repairId ?? null, customer_id: target.customerId, work_date: date, minutes: total,
      description, billable, hourly_rate: isAdmin && rate !== "" ? Number(rate) : undefined,
    };
    try {
      onSaved(entry ? await updateTime(entry.id, input) : await createTime(input));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("common.saveError"));
      setBusy(false);
    }
  }

  return (
    <Modal title={entry ? t("time.edit") : t("time.add")} onClose={onClose}
      footer={<><button type="button" className="btn" onClick={onClose}>{t("common.cancel")}</button>
        <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void save()}>{busy ? t("common.saving") : t("common.save")}</button></>}>
      <div className="modal-body">
        <div className="form-grid">
          <label className="field"><span>{t("time.date")}</span><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
          <div className="field"><span>{t("time.duration")}</span>
            <div className="duration-inputs">
              <input type="number" min="0" max="24" inputMode="numeric" value={hours} onChange={(e) => setHours(e.target.value)} aria-label={t("time.hours")} /><span>h</span>
              <input type="number" min="0" max="59" step="5" inputMode="numeric" value={minutes} onChange={(e) => setMinutes(e.target.value)} aria-label={t("time.minutes")} /><span>min</span>
            </div>
          </div>
          <label className="field full"><span>{t("time.description")}</span><textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} placeholder={t("time.descriptionPlaceholder")} /></label>
          <label className="check"><input type="checkbox" checked={billable} onChange={(e) => setBillable(e.target.checked)} />{t("time.billable")}</label>
          {isAdmin && <label className="field"><span>{t("time.rate")}</span><input type="number" min="0" step="0.01" value={rate} onChange={(e) => setRate(e.target.value)} placeholder={t("time.rateDefault")} /></label>}
        </div>
        {error && <div className="alert error">{error}</div>}
      </div>
    </Modal>
  );
}
