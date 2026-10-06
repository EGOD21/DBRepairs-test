import { useEffect, useState } from "react";
import Icon from "../components/Icon";
import { listParts, Part, PartFilter, partStatuses, safeLink, toPartInput, updatePart } from "../data/parts";
import { formatDbDate } from "../data/dates";
import { deviceLabel, fill, formatMoney } from "../lib/format";
import { useI18n } from "../i18n/I18nProvider";
import { href } from "../router";

export default function PartsPage() {
  const { t } = useI18n();
  const [filter, setFilter] = useState<PartFilter>("open");
  const [parts, setParts] = useState<Part[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function load(current = filter) {
    try {
      setParts(await listParts(current));
      setError("");
    } catch (cause) {
      console.error(cause);
      setError(t("common.databaseError"));
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { setLoading(true); void load(filter); }, [filter]);

  async function setStatus(part: Part, status: Part["status"]) {
    try {
      await updatePart(part.id, { ...toPartInput(part), status });
      await load();
    } catch {
      setError(t("common.saveError"));
    }
  }

  const toOrder = parts.filter((p) => p.status === "needed");
  const orderTotal = toOrder.reduce((sum, p) => sum + (p.unit_cost ?? 0) * p.quantity, 0);

  return (
    <div className="page">
      <header className="page-header">
        <div><h1>{t("parts.title")}</h1><p>{t("parts.subtitle")}</p></div>
      </header>
      {error && <div className="alert error">{error}</div>}
      {filter === "open" && toOrder.length > 0 && (
        <div className="alert warning"><Icon name="package" size={16} />{fill(t("parts.toOrderSummary"), { count: toOrder.length, total: formatMoney(orderTotal) })}</div>
      )}
      <section className="card">
        <div className="toolbar">
          <div className="segmented" role="group">
            {(["open", "needed", "ordered", "all"] as PartFilter[]).map((f) => <button key={f} type="button" className={filter === f ? "active" : ""} onClick={() => setFilter(f)}>{t(`parts.filter.${f}`)}</button>)}
          </div>
          <span className="count">{fill(t("parts.count"), { count: parts.length })}</span>
        </div>
        {loading ? <div className="empty">{t("common.loading")}</div> : parts.length === 0 ? <div className="empty"><strong>{t("parts.empty")}</strong><span>{t("parts.emptyHint")}</span></div> : (
          <div className="table-wrap"><table>
            <thead><tr><th>{t("part.name")}</th><th>{t("part.quantity")}</th><th>{t("part.unitCost")}</th><th>{t("part.supplier")}</th><th>{t("repair.number")}</th><th>{t("part.status")}</th><th></th></tr></thead>
            <tbody>{parts.map((part) => {
              const link = safeLink(part.url);
              return (
                <tr key={part.id}>
                  <td><strong>{part.name}</strong>{part.part_number && <div className="muted" style={{ fontSize: 12 }}>#{part.part_number}</div>}</td>
                  <td>{part.quantity}</td>
                  <td className="nowrap">{formatMoney(part.unit_cost)}</td>
                  <td>{part.supplier || "—"}{part.ordered_at && <div className="muted" style={{ fontSize: 12 }}>{t("part.orderedOn")} {formatDbDate(part.ordered_at)}</div>}</td>
                  <td><a className="strong" href={href({ name: "repair", id: part.repair_id })}>{part.repair_number}</a><div className="muted" style={{ fontSize: 12 }}>{part.customer_name} · {deviceLabel(part)}</div></td>
                  <td>
                    <select className="input" style={{ minHeight: 30, padding: "3px 8px", width: "auto" }} value={part.status} onChange={(e) => void setStatus(part, e.target.value as Part["status"])} aria-label={t("part.status")}>
                      {partStatuses.map((s) => <option key={s} value={s}>{t(`part.status.${s}`)}</option>)}
                    </select>
                  </td>
                  <td className="actions">
                    {link && <a className="btn btn-sm btn-primary" href={link} target="_blank" rel="noopener noreferrer"><Icon name="external" size={14} />{t("part.order")}</a>}
                  </td>
                </tr>
              );
            })}</tbody>
          </table></div>
        )}
      </section>
    </div>
  );
}
