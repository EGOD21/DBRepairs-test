import { useI18n } from "../i18n/I18nProvider";
import { Priority } from "../data/repairs";
import { PartStatus } from "../data/parts";

const statusTone: Record<string, string> = {
  RECEIVED: "", DIAGNOSIS: "accent", WAITING_CUSTOMER: "warning", WAITING_PARTS: "warning", IN_REPAIR: "accent",
  REPAIRED: "success", READY: "success", DELIVERED: "", CANCELLED: "danger",
};

export function StatusBadge({ code, labelKey }: { code: string; labelKey: string }) {
  const { t } = useI18n();
  return <span className={`badge ${statusTone[code] ?? ""}`}>{t(labelKey)}</span>;
}

const priorityTone: Record<Priority, string> = { low: "", normal: "", high: "warning", urgent: "danger" };

export function PriorityBadge({ priority, quiet = false }: { priority: Priority; quiet?: boolean }) {
  const { t } = useI18n();
  if (quiet && priority === "normal") return null;
  return <span className={`badge ${priorityTone[priority]}`}>{t(`priority.${priority}`)}</span>;
}

const partTone: Record<PartStatus, string> = { needed: "danger", ordered: "warning", received: "accent", installed: "success", cancelled: "" };

export function PartStatusBadge({ status }: { status: PartStatus }) {
  const { t } = useI18n();
  return <span className={`badge ${partTone[status]}`}>{t(`part.status.${status}`)}</span>;
}

const docTone: Record<string, string> = {
  draft: "", sent: "accent", unpaid: "accent", partial: "warning", overdue: "danger", paid: "success", void: "",
  approved: "success", declined: "danger", converted: "primary", expired: "warning",
};

/** Invoice and estimate state: draft, unpaid, partial, overdue, paid, approved… */
export function DocStateBadge({ state }: { state: string }) {
  const { t } = useI18n();
  return <span className={`badge ${docTone[state] ?? ""}`}>{t(`billing.state.${state}`)}</span>;
}
