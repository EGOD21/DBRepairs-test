import { KeyboardEvent, useEffect, useMemo, useState } from "react";
import Icon from "../components/Icon";
import ScanButton from "../components/ScanButton";
import { isServerMode } from "../data/runtime";
import { PriorityBadge, StatusBadge } from "../components/Badges";
import RepairCreateModal from "../components/RepairCreateModal";
import DeleteRepairDialog from "../components/DeleteRepairDialog";
import { isClosed, isOverdue, listRepairs, listStatuses, priorities, Priority, Repair, RepairStatus } from "../data/repairs";
import { getSettings } from "../data/settings";
import { formatDbDate } from "../data/dates";
import { deviceLabel, fill, formatPlainDate } from "../lib/format";
import { useI18n } from "../i18n/I18nProvider";
import { href, navigate } from "../router";
import { queueAutoPrint } from "../print/data";
import { TicketKind } from "../print/types";

type Scope = "all" | "open" | "closed" | "overdue";

export default function RepairsPage({ filter }: { filter?: string }) {
  const { t } = useI18n();
  const [repairs, setRepairs] = useState<Repair[]>([]);
  const [statuses, setStatuses] = useState<RepairStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [priorityFilter, setPriorityFilter] = useState<Priority | "">("");
  const [scope, setScope] = useState<Scope>("all");
  const [creating, setCreating] = useState<{ customerId?: number } | null>(null);
  const [autoPrint, setAutoPrint] = useState("none");
  const [deleting, setDeleting] = useState<Repair | null>(null);

  async function load() {
    try {
      const [r, s] = await Promise.all([listRepairs(), listStatuses()]);
      setRepairs(r); setStatuses(s);
    } catch (cause) {
      console.error(cause);
      setError(t("common.databaseError"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    getSettings().then((s) => setAutoPrint(s["print.autoPrint"] || "none")).catch(() => {});
  }, []);

  // Links from the dashboard and customer pages arrive as ?filter=...
  useEffect(() => {
    if (!filter) return;
    if (filter === "new") setCreating({});
    else if (filter.startsWith("new:")) setCreating({ customerId: Number(filter.slice(4)) || undefined });
    else if (filter.startsWith("q:")) setSearch(filter.slice(2));
    else if (filter === "open" || filter === "closed" || filter === "overdue") setScope(filter);
    else setStatusFilter(filter);
  }, [filter]);

  // A repair number linked from chat opens that repair directly.
  useEffect(() => {
    if (!filter?.startsWith("q:") || loading) return;
    const match = repairs.find((r) => r.repair_number === filter.slice(2));
    if (match) navigate({ name: "repair", id: match.id });
  }, [filter, loading, repairs]);

  const filtered = useMemo(() => {
    const q = search.trim().toLocaleLowerCase();
    return repairs.filter((r) => {
      if (statusFilter && r.status_code !== statusFilter) return false;
      if (priorityFilter && r.priority !== priorityFilter) return false;
      if (scope === "open" && isClosed(r)) return false;
      if (scope === "closed" && !isClosed(r)) return false;
      if (scope === "overdue" && !isOverdue(r)) return false;
      if (!q) return true;
      return [r.repair_number, r.customer_name, r.customer_company, r.device_type, r.brand, r.model, r.serial_number, r.imei, r.reported_fault, r.technician]
        .some((value) => (value || "").toLocaleLowerCase().includes(q));
    });
  }, [repairs, search, statusFilter, priorityFilter, scope]);

  // A barcode scanner types the repair number and presses Enter.
  function onSearchKey(event: KeyboardEvent<HTMLElement>) {
    if (event.key !== "Enter") return;
    const exact = repairs.find((r) => r.repair_number.toLowerCase() === search.trim().toLowerCase());
    const target = exact ?? (filtered.length === 1 ? filtered[0] : undefined);
    if (target) navigate({ name: "repair", id: target.id });
  }

  // The camera reads a repair label: jump straight to it, otherwise search for the text.
  function openScanned(text: string) {
    const exact = repairs.find((r) => r.repair_number.toLowerCase() === text.toLowerCase());
    if (exact) navigate({ name: "repair", id: exact.id });
    else setSearch(text);
  }

  function created(id: number, print: boolean) {
    if (print) {
      const kind: TicketKind = autoPrint === "label" || autoPrint === "receipt" ? autoPrint : "intake";
      queueAutoPrint(id, kind);
    }
    setCreating(null);
    navigate({ name: "repair", id });
  }

  function closeCreate() {
    setCreating(null);
    if (filter?.startsWith("new")) window.history.replaceState(null, "", href({ name: "repairs" }));
  }

  return (
    <div className="page">
      <header className="page-header">
        <div><h1>{t("repairs.title")}</h1><p>{t("repairs.subtitle")}</p></div>
        <div className="page-actions"><button type="button" className="btn btn-primary" onClick={() => setCreating({})}><Icon name="plus" size={16} />{t("repair.new")}</button></div>
      </header>
      {error && <div className="alert error">{error}</div>}
      <section className="card">
        <div className="toolbar">
          <div className="search">
            <Icon name="search" size={16} />
            <input className="input" value={search} onChange={(e) => setSearch(e.target.value)} onKeyDown={onSearchKey} placeholder={t("repairs.search")} aria-label={t("repairs.search")} />
            {isServerMode && <ScanButton onResult={openScanned} />}
          </div>
          <div className="segmented" role="group">
            {(["all", "open", "overdue", "closed"] as Scope[]).map((s) => <button key={s} type="button" className={scope === s ? "active" : ""} onClick={() => setScope(s)}>{t(`repairs.scope.${s}`)}</button>)}
          </div>
          <select className="input" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label={t("repairs.filterStatus")}>
            <option value="">{t("repairs.allStatuses")}</option>
            {statuses.map((s) => <option key={s.id} value={s.code}>{t(s.label_key)}</option>)}
          </select>
          <select className="input" value={priorityFilter} onChange={(e) => setPriorityFilter(e.target.value as Priority | "")} aria-label={t("repair.priority")}>
            <option value="">{t("repairs.allPriorities")}</option>
            {priorities.map((p) => <option key={p} value={p}>{t(`priority.${p}`)}</option>)}
          </select>
          <span className="count">{fill(t("repairs.results"), { count: filtered.length })}</span>
        </div>
        {loading ? <div className="empty">{t("common.loading")}</div> : filtered.length === 0 ? (
          <div className="empty"><strong>{repairs.length ? t("repairs.noResults") : t("repairs.empty")}</strong></div>
        ) : (
          <div className="table-wrap"><table className="responsive">
            <thead><tr><th>{t("repair.number")}</th><th>{t("repair.customer")}</th><th>{t("repair.device")}</th><th>{t("repair.status")}</th><th>{t("repair.dueDate")}</th><th>{t("repair.technician")}</th><th>{t("repair.openedAt")}</th><th></th></tr></thead>
            <tbody>{filtered.map((r) => {
              const overdue = isOverdue(r);
              return (
                <tr key={r.id} className="clickable" onClick={() => navigate({ name: "repair", id: r.id })}>
                  <td data-label={t("repair.number")} className="cell-title nowrap"><strong><a href={href({ name: "repair", id: r.id })}>{r.repair_number}</a></strong></td>
                  <td data-label={t("repair.customer")}><div>{r.customer_name}{r.customer_company && <div className="muted" style={{ fontSize: 12 }}>{r.customer_company}</div>}</div></td>
                  <td data-label={t("repair.device")}>{deviceLabel(r)}</td>
                  <td data-label={t("repair.status")}><div className="title-row"><StatusBadge code={r.status_code} labelKey={r.status_label_key} /><PriorityBadge priority={r.priority} quiet />{r.parts_pending > 0 && <span className="badge warning" title={t("parts.pending")}><Icon name="package" size={12} />{r.parts_pending}</span>}{r.photo_count > 0 && <span className="badge" title={t("photos.title")}><Icon name="camera" size={12} />{r.photo_count}</span>}</div></td>
                  <td data-label={t("repair.dueDate")} className="nowrap" style={overdue ? { color: "var(--danger)", fontWeight: 600 } : undefined}>{formatPlainDate(r.due_date)}</td>
                  <td data-label={t("repair.technician")} className="muted">{r.technician || "—"}</td>
                  <td data-label={t("repair.openedAt")} className="nowrap muted">{formatDbDate(r.opened_at)}</td>
                  <td className="actions" onClick={(e) => e.stopPropagation()}>
                    <div className="row-actions">
                      <a className="btn btn-sm" href={href({ name: "repair", id: r.id })}>{t("repair.open")}</a>
                      <button type="button" className="btn btn-sm btn-icon btn-danger" title={t("common.delete")} aria-label={t("common.delete")} onClick={() => setDeleting(r)}><Icon name="trash" size={15} /></button>
                    </div>
                  </td>
                </tr>
              );
            })}</tbody>
          </table></div>
        )}
      </section>
      {creating && <RepairCreateModal statuses={statuses} repairs={repairs} initialCustomerId={creating.customerId} autoPrintKind={autoPrint} onClose={closeCreate} onCreated={created} />}
      {deleting && <DeleteRepairDialog repair={deleting} onClose={() => setDeleting(null)}
        onDeleted={() => { setRepairs((list) => list.filter((r) => r.id !== deleting.id)); setDeleting(null); }} />}
    </div>
  );
}
