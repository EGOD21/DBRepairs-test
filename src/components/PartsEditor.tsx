import { FormEvent, useEffect, useState } from "react";
import Icon from "./Icon";
import { blankPartInput, createPart, deletePart, listRepairParts, Part, PartInput, partStatuses, safeLink, toPartInput, updatePart } from "../data/parts";
import { formatMoney } from "../lib/format";
import { useI18n } from "../i18n/I18nProvider";
import { isServerMode } from "../data/runtime";
import UseStockModal from "./UseStockModal";
import { ReturnModal } from "./ReturnsTab";

/** Parts a repair needs: what to order, where, the link, and how far along it is. */
export default function PartsEditor({ repairId, onChange }: { repairId: number; onChange?: (parts: Part[]) => void }) {
  const { t } = useI18n();
  const [parts, setParts] = useState<Part[]>([]);
  const [editing, setEditing] = useState<number | "new" | null>(null);
  const [form, setForm] = useState<PartInput>(blankPartInput);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [usingStock, setUsingStock] = useState(false);
  const [returning, setReturning] = useState<Part | null>(null);

  async function load() {
    try {
      const list = await listRepairParts(repairId);
      setParts(list);
      onChange?.(list);
    } catch {
      setError(t("common.databaseError"));
    }
  }
  useEffect(() => { void load(); }, [repairId]);

  const set = <K extends keyof PartInput>(key: K, value: PartInput[K]) => setForm((f) => ({ ...f, [key]: value }));

  function startNew() { setForm(blankPartInput); setEditing("new"); setError(""); }
  function startEdit(part: Part) { setForm(toPartInput(part)); setEditing(part.id); setError(""); }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!form.name.trim() || saving) return;
    setSaving(true); setError("");
    try {
      if (editing === "new") await createPart(repairId, form);
      else if (typeof editing === "number") await updatePart(editing, form);
      setEditing(null);
      await load();
    } catch (cause) {
      setError(cause instanceof Error && cause.message ? cause.message : t("common.saveError"));
    } finally {
      setSaving(false);
    }
  }

  async function quickStatus(part: Part, status: Part["status"]) {
    try {
      await updatePart(part.id, { ...toPartInput(part), status });
      await load();
    } catch {
      setError(t("common.saveError"));
    }
  }

  async function remove(part: Part) {
    if (!window.confirm(t("part.deleteConfirm").replace("{name}", part.name))) return;
    try { await deletePart(part.id); await load(); } catch { setError(t("common.saveError")); }
  }

  const total = parts.filter((p) => p.status !== "cancelled").reduce((sum, p) => sum + (p.unit_cost ?? 0) * p.quantity, 0);

  return (
    <section className="card">
      <div className="card-header">
        <div><h2>{t("parts.title")}</h2><p>{t("parts.hint")}</p></div>
        {editing === null && <div className="card-actions">
          {isServerMode && <button type="button" className="btn btn-sm" onClick={() => setUsingStock(true)}><Icon name="package" size={15} />{t("stock.fromStock")}</button>}
          <button type="button" className="btn btn-sm" onClick={startNew}><Icon name="plus" size={15} />{t("part.add")}</button>
        </div>}
      </div>
      {error && <div className="card-body"><div className="alert error">{error}</div></div>}
      {parts.length === 0 && editing === null ? <div className="empty">{t("parts.emptyRepair")}</div> : parts.length > 0 && (
        <div className="table-wrap"><table className="responsive">
          <thead><tr><th>{t("part.name")}</th><th>{t("part.quantity")}</th><th>{t("part.unitCost")}</th><th>{t("part.supplier")}</th><th>{t("part.status")}</th><th></th></tr></thead>
          <tbody>{parts.map((part) => {
            const link = safeLink(part.url);
            return (
              <tr key={part.id}>
                <td data-label={t("part.name")} className="cell-title"><strong>{part.name}</strong>{part.part_number && <div className="muted" style={{ fontSize: 12 }}>#{part.part_number}</div>}{part.notes && <div className="muted" style={{ fontSize: 12 }}>{part.notes}</div>}</td>
                <td data-label={t("part.quantity")}>{part.quantity}</td>
                <td data-label={t("part.unitCost")} className="nowrap">{formatMoney(part.unit_cost)}</td>
                <td data-label={t("part.supplier")}>{link ? <a href={link} target="_blank" rel="noopener noreferrer" className="nowrap">{part.supplier || t("part.orderLink")} <Icon name="external" size={13} className="inline-icon" /></a> : (part.supplier || "—")}</td>
                <td data-label={t("part.status")}>
                  <select className="input" style={{ minHeight: 30, padding: "3px 8px", width: "auto" }} value={part.status} onChange={(e) => void quickStatus(part, e.target.value as Part["status"])} aria-label={t("part.status")}>
                    {partStatuses.map((s) => <option key={s} value={s}>{t(`part.status.${s}`)}</option>)}
                  </select>
                </td>
                <td className="actions"><div className="row-actions">
                  <button type="button" className="btn btn-sm btn-icon btn-ghost" title={t("common.edit")} aria-label={t("common.edit")} onClick={() => startEdit(part)}><Icon name="pencil" size={14} /></button>
                  {isServerMode && <button type="button" className="btn btn-sm btn-icon btn-ghost" title={t("return.add")} aria-label={t("return.add")} onClick={() => setReturning(part)}><Icon name="back" size={14} /></button>}
                  <button type="button" className="btn btn-sm btn-icon btn-ghost" title={t("common.delete")} aria-label={t("common.delete")} onClick={() => void remove(part)}><Icon name="trash" size={14} /></button>
                </div></td>
              </tr>
            );
          })}</tbody>
          {total > 0 && <tfoot><tr><td colSpan={2} className="muted">{t("parts.total")}</td><td className="nowrap"><strong>{formatMoney(total)}</strong></td><td colSpan={3} /></tr></tfoot>}
        </table></div>
      )}
      {editing !== null && (
        <form className="part-form" onSubmit={(e) => void save(e)}>
          <div className="form-grid three">
            <label className="field" style={{ gridColumn: "span 2" }}><span>{t("part.name")} *</span><input autoFocus value={form.name} onChange={(e) => set("name", e.target.value)} placeholder={t("part.namePlaceholder")} /></label>
            <label className="field"><span>{t("part.partNumber")}</span><input value={form.part_number} onChange={(e) => set("part_number", e.target.value)} /></label>
            <label className="field" style={{ gridColumn: "span 2" }}><span>{t("part.url")}</span><input type="url" inputMode="url" value={form.url} onChange={(e) => set("url", e.target.value)} placeholder="https://" /></label>
            <label className="field"><span>{t("part.supplier")}</span><input value={form.supplier} onChange={(e) => set("supplier", e.target.value)} /></label>
            <label className="field"><span>{t("part.quantity")}</span><input type="number" min="1" step="1" value={form.quantity} onChange={(e) => set("quantity", e.target.value)} /></label>
            <label className="field"><span>{t("part.unitCost")}</span><input type="number" min="0" step="0.01" value={form.unit_cost} onChange={(e) => set("unit_cost", e.target.value)} /></label>
            <label className="field"><span>{t("part.status")}</span><select value={form.status} onChange={(e) => set("status", e.target.value as Part["status"])}>{partStatuses.map((s) => <option key={s} value={s}>{t(`part.status.${s}`)}</option>)}</select></label>
            <label className="field full"><span>{t("part.notes")}</span><input value={form.notes} onChange={(e) => set("notes", e.target.value)} /></label>
          </div>
          <div className="page-actions" style={{ justifyContent: "flex-end" }}>
            <button type="button" className="btn" onClick={() => setEditing(null)}>{t("common.cancel")}</button>
            <button type="submit" className="btn btn-primary" disabled={saving || !form.name.trim()}>{saving ? t("common.saving") : t("common.save")}</button>
          </div>
        </form>
      )}
      {usingStock && <UseStockModal repairId={repairId} onClose={() => setUsingStock(false)} onSaved={() => { setUsingStock(false); void load(); }} />}
      {returning && <ReturnModal value={null} initial={{ item: returning.name, part_number: returning.part_number, supplier: returning.supplier ?? "", quantity: returning.quantity,
        repair_id: repairId, repair_part_id: returning.id }} onClose={() => setReturning(null)} onSaved={() => setReturning(null)} />}
    </section>
  );
}

