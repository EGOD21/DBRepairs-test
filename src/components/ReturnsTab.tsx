import { useEffect, useState } from "react";
import Icon from "./Icon";
import Modal from "./Modal";
import { createReturn, deleteReturn, listReturns, ReturnStatus, returnStatuses, SupplierReturn, updateReturn } from "../data/shopfloor";
import { formatMoney, formatPlainDate } from "../lib/format";
import { useI18n } from "../i18n/I18nProvider";
import { href } from "../router";

const tone: Record<ReturnStatus, string> = { to_ship: "warning", shipped: "accent", replaced: "success", credited: "success", rejected: "danger", closed: "" };

export function ReturnStatusBadge({ status }: { status: ReturnStatus }) {
  const { t } = useI18n();
  return <span className={`badge ${tone[status]}`}>{t(`return.status.${status}`)}</span>;
}

/** Parts going back to suppliers, from "to ship" to credited or replaced. */
export default function ReturnsTab() {
  const { t } = useI18n();
  const [returns, setReturns] = useState<SupplierReturn[]>([]);
  const [openOnly, setOpenOnly] = useState(true);
  const [editing, setEditing] = useState<SupplierReturn | "new" | null>(null);
  const load = () => listReturns(openOnly).then(setReturns).catch(() => setReturns([]));
  useEffect(() => { void load(); }, [openOnly]);

  return (
    <section className="card">
      <div className="toolbar">
        <label className="check"><input type="checkbox" checked={openOnly} onChange={(e) => setOpenOnly(e.target.checked)} />{t("return.openOnly")}</label>
        <span className="count" />
        <button type="button" className="btn btn-primary btn-sm" onClick={() => setEditing("new")}><Icon name="plus" size={15} />{t("return.add")}</button>
      </div>
      {returns.length === 0 ? <div className="empty"><strong>{t("return.empty")}</strong></div> : (
        <div className="table-wrap"><table className="responsive">
          <thead><tr><th>{t("return.item")}</th><th>{t("part.supplier")}</th><th>{t("return.rma")}</th><th>{t("repair.number")}</th><th>{t("billing.state")}</th><th /></tr></thead>
          <tbody>{returns.map((r) => (
            <tr key={r.id}>
              <td data-label={t("return.item")} className="cell-title"><strong>{r.quantity > 1 ? `${r.quantity} × ` : ""}{r.item}</strong>
                <div className="muted" style={{ fontSize: 12 }}>{[r.part_number, r.serial_number, r.reason].filter(Boolean).join(" · ")}</div></td>
              <td data-label={t("part.supplier")}>{r.supplier}</td>
              <td data-label={t("return.rma")} className="mono">{r.supplier_rma || "—"}{r.tracking && <div className="muted" style={{ fontSize: 12 }}>{r.tracking}</div>}</td>
              <td data-label={t("repair.number")}>{r.repair_id ? <a href={href({ name: "repair", id: r.repair_id })}>{r.repair_number}</a> : "—"}</td>
              <td data-label={t("billing.state")}><ReturnStatusBadge status={r.status} />{r.credit_amount ? <div className="muted" style={{ fontSize: 12 }}>{formatMoney(r.credit_amount)}</div> : null}</td>
              <td className="actions"><button type="button" className="btn btn-sm btn-icon btn-ghost" onClick={() => setEditing(r)} aria-label={t("common.edit")}><Icon name="pencil" size={14} /></button></td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
      {editing && <ReturnModal value={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void load(); }} />}
    </section>
  );
}

export function ReturnModal({ value, initial, onClose, onSaved }: { value: SupplierReturn | null; initial?: Partial<SupplierReturn>; onClose: () => void; onSaved: () => void }) {
  const { t } = useI18n();
  const [form, setForm] = useState<Partial<SupplierReturn>>(value ?? { quantity: 1, status: "to_ship", ...initial });
  const [error, setError] = useState("");
  const set = <K extends keyof SupplierReturn>(key: K, v: SupplierReturn[K] | string) => setForm((f) => ({ ...f, [key]: v }));
  const field = (key: keyof SupplierReturn, label: string, props: Record<string, unknown> = {}) => (
    <label className="field"><span>{label}</span><input value={String(form[key] ?? "")} onChange={(e) => set(key, e.target.value)} {...props} /></label>
  );
  async function save() {
    try { if (value) await updateReturn(value.id, form); else await createReturn(form); onSaved(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : t("common.saveError")); }
  }
  async function remove() {
    if (!value || !window.confirm(t("return.deleteConfirm"))) return;
    try { await deleteReturn(value.id); onSaved(); } catch (cause) { setError(cause instanceof Error ? cause.message : t("common.saveError")); }
  }
  return (
    <Modal title={value ? t("return.edit") : t("return.add")} onClose={onClose} wide
      footer={<>{value && <button type="button" className="btn btn-danger" style={{ marginRight: "auto" }} onClick={() => void remove()}>{t("common.delete")}</button>}
        <button type="button" className="btn" onClick={onClose}>{t("common.cancel")}</button>
        <button type="button" className="btn btn-primary" disabled={!form.item?.trim() || !form.supplier?.trim()} onClick={() => void save()}>{t("common.save")}</button></>}>
      <div className="modal-body">
        <div className="form-grid three">
          <label className="field" style={{ gridColumn: "span 2" }}><span>{t("return.item")} *</span><input value={form.item ?? ""} onChange={(e) => set("item", e.target.value)} /></label>
          {field("quantity", t("part.quantity"), { type: "number", min: 1 })}
          {field("supplier", `${t("part.supplier")} *`)}
          {field("part_number", t("part.partNumber"))}
          {field("serial_number", t("repair.serialNumber"))}
          <label className="field"><span>{t("billing.state")}</span><select value={form.status} onChange={(e) => set("status", e.target.value)}>
            {returnStatuses.map((s) => <option key={s} value={s}>{t(`return.status.${s}`)}</option>)}</select></label>
          {field("supplier_rma", t("return.rma"))}
          {field("tracking", t("return.tracking"))}
          {field("shipped_at", t("return.shippedAt"), { type: "date" })}
          {field("resolved_at", t("return.resolvedAt"), { type: "date" })}
          {field("credit_amount", t("return.credit"), { type: "number", min: 0, step: "0.01" })}
          <label className="field full"><span>{t("return.reason")}</span><textarea rows={2} value={form.reason ?? ""} onChange={(e) => set("reason", e.target.value)} placeholder={t("return.reasonPlaceholder")} /></label>
          <label className="field full"><span>{t("part.notes")}</span><input value={form.notes ?? ""} onChange={(e) => set("notes", e.target.value)} /></label>
        </div>
        {form.repair_number && <p className="hint">{t("repair.number")}: {form.repair_number} · {formatPlainDate(form.created_at)}</p>}
        {error && <div className="alert error">{error}</div>}
      </div>
    </Modal>
  );
}
