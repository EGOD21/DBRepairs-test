import { useEffect, useState } from "react";
import Icon from "./Icon";
import { announceTimer, getTimer, RunningTimer, stopTimer, timerChangedEvent } from "../data/billing";
import { formatClock } from "../lib/format";
import { useI18n } from "../i18n/I18nProvider";
import { href } from "../router";

/** Your running timer, visible on every page, with a stop button. */
export default function RunningTimerChip({ refreshKey }: { refreshKey: unknown }) {
  const { t } = useI18n();
  const [timer, setTimer] = useState<RunningTimer | null>(null);
  const [started, setStarted] = useState(0);
  const [now, setNow] = useState(Date.now());

  const load = () => getTimer().then((current) => { setTimer(current); setStarted(Date.now() - (current?.elapsed_seconds ?? 0) * 1000); }).catch(() => setTimer(null));
  useEffect(() => { void load(); }, [refreshKey]);
  useEffect(() => {
    window.addEventListener(timerChangedEvent, load);
    return () => window.removeEventListener(timerChangedEvent, load);
  }, []);
  useEffect(() => {
    if (!timer) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [timer]);

  if (!timer) return null;
  const target = timer.repair_id ? href({ name: "repair", id: timer.repair_id }) : href({ name: "customer", id: timer.customer_id });
  return (
    <div className="timer-chip" role="status">
      <span className="timer-dot" />
      <a href={target} title={timer.customer_name}><strong>{formatClock((now - started) / 1000)}</strong><span className="timer-label">{timer.repair_number ?? timer.customer_name}</span></a>
      <button type="button" onClick={() => void stopTimer().then(announceTimer)} aria-label={t("time.stop")} title={t("time.stop")}><Icon name="check" size={14} /></button>
    </div>
  );
}
