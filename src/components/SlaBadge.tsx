import Icon from "./Icon";
import { Repair } from "../data/repairs";
import { fill } from "../lib/format";
import { useI18n } from "../i18n/I18nProvider";

function hoursText(ms: number) {
  const minutes = Math.round(Math.abs(ms) / 60000);
  return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h ${minutes % 60 ? `${minutes % 60} min` : ""}`.trim();
}

/** Response promise for contract customers: time left, met, or missed. */
export default function SlaBadge({ repair }: { repair: Pick<Repair, "sla_due_at" | "first_response_at"> }) {
  const { t } = useI18n();
  if (!repair.sla_due_at) return null;
  const due = new Date(repair.sla_due_at).getTime();
  if (repair.first_response_at) {
    const met = new Date(repair.first_response_at).getTime() <= due;
    return <span className={`badge ${met ? "success" : "danger"}`} title={new Date(repair.sla_due_at).toLocaleString()}><Icon name="clock" size={12} />{met ? t("sla.met") : t("sla.missed")}</span>;
  }
  const left = due - Date.now();
  return <span className={`badge ${left < 0 ? "danger" : left < 2 * 3600_000 ? "warning" : "accent"}`} title={new Date(repair.sla_due_at).toLocaleString()}>
    <Icon name="clock" size={12} />{left < 0 ? fill(t("sla.late"), { time: hoursText(left) }) : fill(t("sla.left"), { time: hoursText(left) })}</span>;
}
