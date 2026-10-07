import { useEffect, useState } from "react";
import Icon from "./Icon";
import ScanButton from "./ScanButton";
import Modal from "./Modal";
import { adjustStock, blankStock, createStock, deleteStock, listStock, StockInput, StockItem, StockMovement, stockMovements, stockReasons, updateStock } from "../data/shopfloor";
import { formatDbDate } from "../data/dates";
import { fill, formatMoney } from "../lib/format";
import { useI18n } from "../i18n/I18nProvider";
import { useSession } from "../session";
import { href } from "../router";

const toInput = (item: StockItem): StockInput => ({
  sku: item.sku ?? "", name: item.name, category: item.category ?? "", brand: item.brand ?? "", part_number: item.part_number ?? "", barcode: item.barcode ?? "",
  supplier: item.supplier ?? "", url: item.url ?? "", cost: item.cost?.toString() ?? "", price: item.price?.toString() ?? "", reorder_level: String(item.reorder_level),
  reorder_quantity: item.reorder_quantity?.toString() ?? "", location: item.location ?? "", notes: item.notes ?? "", active: item.active,
});

/** Parts on the shelf: quantities, reorder levels, deliveries and corrections. */
export default function StockTab() {
  const { t } = useI18n();
  const [items, setItems] = useState<StockItem[]>([]);
  const [search, setSearch] = useState("");
  const [lowOnly, setLowOnly] = useState(false);
  const [editing, setEditing] = useState<StockItem | "new" | null>(null);
  const [adjusting, setAdjusting] = useState<StockItem | null>(null);
  const [history, setHistory] = useState<StockItem | null>(null);
  const [error, setError] = useState("");

  const load = () => listStock({ search, low: lowOnly }).then(setItems).catch(() => setError(t("common.databaseError")));
  useEffect(() => { const timer = window.setTimeout(() => void load(), 200); return () => window.clearTimeout(timer); }, [search, lowOnly]);

  const value = items.reduce((sum, item) => sum + (item.cost ?? 0) * Math.max(0, item.quantity), 0);
  const low = items.filter((item) => item.low).length;

  return (
    <section className="card">
      <div className="toolbar">
        <div className="search"><Icon name="search" size={16} /><input className="input" type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("stock.search")} /><ScanButton onResult={setSearch} /></div>
        <label className="check"><input type="checkbox" checked={lowOnly} onChange={(e) => setLowOnly(e.target.checked)} />{t("stock.lowOnly")}{low > 0 && !lowOnly ? ` (${low})` : ""}</label>
        <span className="count">{fill(t("stock.summary"), { count: items.length, value: formatMoney(value) })}</span>
        <button type="button" className="btn btn-primary btn-sm" onClick={() => setEditing("new")}><Icon name="plus" size={15} />{t("stock.add")}</button>
      </div>
      {error && <div className="card-body"><div className="alert error">{error}</div></div>}
      {items.length === 0 ? <div className="empty"><strong>{t("stock.empty")}</strong><span>{t("stock.emptyHint")}</span></div> : (
        <div className="table-wrap"><table className="responsive">
          <thead><tr><th>{t("part.name")}</th><th>{t("stock.category")}</th><th>{t("stock.location")}</th><th className="num">{t("stock.onHand")}</th><th className="num">{t("stock.price")}</th><th /></tr></thead>
          <tbody>{items.map((item) => (
            <tr key={item.id}>
              <td data-label={t("part.name")} className="cell-title"><strong>{item.name}</strong>
                <div className="muted" style={{ fontSize: 12 }}>{[item.sku, item.part_number, item.brand].filter(Boolean).join(" · ")}</div></td>
              <td data-label={t("stock.category")}>{item.category || "—"}</td>
              <td data-label={t("stock.location")}>{item.location || "—"}</td>
              <td data-label={t("stock.onHand")} className="num"><span className={`badge ${item.quantity <= 0 ? "danger" : item.low ? "warning" : ""}`}>{item.quantity}</span>
                {item.reorder_level > 0 && <small className="muted"> / {t("stock.min")} {item.reorder_level}</small>}</td>
              <td data-label={t("stock.price")} className="num nowrap">{formatMoney(item.price)}</td>
              <td className="actions"><div className="page-actions">
                <button type="button" className="btn btn-sm" onClick={() => setAdjusting(item)}><Icon name="plus" size={14} />{t("stock.adjust")}</button>
                <button type="button" className="btn btn-sm btn-icon btn-ghost" onClick={() => setHistory(item)} aria-label={t("stock.history")} title={t("stock.history")}><Icon name="clock" size={14} /></button>
                <button type="button" className="btn btn-sm btn-icon btn-ghost" onClick={() => setEditing(item)} aria-label={t("common.edit")}><Icon name="pencil" size={14} /></button>
              </div></td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
      {editing && <StockModal item={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void load(); }} />}
      {adjusting && <AdjustModal item={adjusting} onClose={() => setAdjusting(null)} onSaved={() => { setAdjusting(null); void load(); }} />}
      {history && <HistoryModal item={history} onClose={() => setHistory(null)} />}
    </section>
  );
}

function StockModal({ item, onClose, onSaved }: { item: StockItem | null; onClose: () => void; onSaved: () => void }) {
  const { t } = useI18n();
  const { isAdmin } = useSession();
  const [form, setForm] = useState<StockInput>(item ? toInput(item) : blankStock);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const set = <K extends keyof StockInput>(key: K, value: StockInput[K]) => setForm((f) => ({ ...f, [key]: value }));
  const field = (key: keyof StockInput, label: string, props: Record<string, unknown> = {}) => (
    <label className="field"><span>{label}</span><input value={String(form[key] ?? "")} onChange={(e) => set(key, e.target.value as never)} {...props} /></label>
  );
  async function save() {
    setBusy(true); setError("");
    try { if (item) await updateStock(item.id, form); else await createStock(form); onSaved(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : t("common.saveError")); setBusy(false); }
  }
  async function remove() {
    if (!item || !window.confirm(fill(t("stock.deleteConfirm"), { name: item.name }))) return;
    try { await deleteStock(item.id); onSaved(); } catch (cause) { setError(cause instanceof Error ? cause.message : t("common.saveError")); }
  }
  return (
    <Modal title={item ? t("stock.edit") : t("stock.add")} onClose={onClose} wide
      footer={<>{item && isAdmin && <button type="button" className="btn btn-danger" style={{ marginRight: "auto" }} onClick={() => void remove()}>{t("common.delete")}</button>}
        <button type="button" className="btn" onClick={onClose}>{t("common.cancel")}</button>
        <button type="button" className="btn btn-primary" disabled={busy || !form.name.trim()} onClick={() => void save()}>{t("common.save")}</button></>}>
      <div className="modal-body">
        <div className="form-grid three">
          <label className="field" style={{ gridColumn: "span 2" }}><span>{t("part.name")} *</span><input value={form.name} onChange={(e) => set("name", e.target.value)} placeholder={t("stock.namePlaceholder")} /></label>
          {field("sku", t("stock.sku"))}
          {field("category", t("stock.category"), { placeholder: t("stock.categoryPlaceholder") })}
          {field("brand", t("repair.brand"))}
          {field("part_number", t("part.partNumber"))}
          {field("barcode", t("stock.barcode"))}
          {field("location", t("stock.location"), { placeholder: t("stock.locationPlaceholder") })}
          {field("supplier", t("part.supplier"))}
          <label className="field" style={{ gridColumn: "span 3" }}><span>{t("part.url")}</span><input type="url" value={form.url} onChange={(e) => set("url", e.target.value)} placeholder="https://" /></label>
          {field("cost", t("stock.cost"), { type: "number", min: 0, step: "0.01" })}
          {field("price", t("stock.price"), { type: "number", min: 0, step: "0.01" })}
          {!item && field("quantity", t("stock.startQuantity"), { type: "number", min: 0, step: 1 })}
          {field("reorder_level", t("stock.reorderLevel"), { type: "number", min: 0, step: 1 })}
          {field("reorder_quantity", t("stock.reorderQuantity"), { type: "number", min: 1, step: 1 })}
          <label className="check"><input type="checkbox" checked={form.active} onChange={(e) => set("active", e.target.checked)} />{t("stock.active")}</label>
          <label className="field full"><span>{t("part.notes")}</span><input value={form.notes} onChange={(e) => set("notes", e.target.value)} /></label>
        </div>
        <p className="hint">{t("stock.priceHint")}</p>
        {error && <div className="alert error">{error}</div>}
      </div>
    </Modal>
  );
}

function AdjustModal({ item, onClose, onSaved }: { item: StockItem; onClose: () => void; onSaved: () => void }) {
  const { t } = useI18n();
  const [mode, setMode] = useState<"in" | "out" | "set">("in");
  const [amount, setAmount] = useState(String(item.reorder_quantity ?? 1));
  const [reason, setReason] = useState("received");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const n = Math.round(Number(amount) || 0);
  const change = mode === "in" ? n : mode === "out" ? -n : n - item.quantity;
  async function save() {
    if (!change) { onClose(); return; }
    try { await adjustStock(item.id, change, mode === "set" ? "adjusted" : reason, note); onSaved(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : t("common.saveError")); }
  }
  return (
    <Modal title={item.name} subtitle={fill(t("stock.currently"), { count: item.quantity })} onClose={onClose}
      footer={<><button type="button" className="btn" onClick={onClose}>{t("common.cancel")}</button><button type="button" className="btn btn-primary" onClick={() => void save()}>{t("common.save")}</button></>}>
      <div className="modal-body">
        <div className="segmented" role="group">
          {(["in", "out", "set"] as const).map((m) => <button key={m} type="button" className={mode === m ? "active" : ""} onClick={() => { setMode(m); setReason(m === "in" ? "received" : "damaged"); }}>{t(`stock.mode.${m}`)}</button>)}
        </div>
        <div className="form-grid">
          <label className="field"><span>{mode === "set" ? t("stock.countedQuantity") : t("part.quantity")}</span><input type="number" min="0" step="1" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus /></label>
          {mode !== "set" && <label className="field"><span>{t("stock.reason")}</span><select value={reason} onChange={(e) => setReason(e.target.value)}>
            {stockReasons.filter((r) => (mode === "in" ? ["received", "returned", "adjusted"] : ["sold", "damaged", "adjusted", "used"]).includes(r)).map((r) => <option key={r} value={r}>{t(`stock.reason.${r}`)}</option>)}</select></label>}
          <label className="field full"><span>{t("billing.note")}</span><input value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("stock.notePlaceholder")} /></label>
        </div>
        <p className="hint">{fill(t("stock.after"), { count: item.quantity + change })}</p>
        {error && <div className="alert error">{error}</div>}
      </div>
    </Modal>
  );
}

function HistoryModal({ item, onClose }: { item: StockItem; onClose: () => void }) {
  const { t } = useI18n();
  const [moves, setMoves] = useState<StockMovement[]>([]);
  useEffect(() => { stockMovements(item.id).then(setMoves).catch(() => {}); }, [item.id]);
  return (
    <Modal title={item.name} subtitle={t("stock.history")} onClose={onClose}>
      <div className="modal-body">
        {moves.length === 0 ? <p className="muted">{t("activity.empty")}</p> : (
          <div className="payment-list">{moves.map((m) => (
            <div key={m.id} className="payment-item">
              <div><strong className={m.change > 0 ? "" : "text-danger"}>{m.change > 0 ? "+" : ""}{m.change}</strong> <span className="muted">{t(`stock.reason.${m.reason}`)}</span>
                {m.repair_id && <> · <a href={href({ name: "repair", id: m.repair_id })}>{m.repair_number}</a></>}</div>
              <small className="muted">{formatDbDate(m.created_at)}{m.user_name ? ` · ${m.user_name}` : ""}{m.note ? ` · ${m.note}` : ""}</small>
            </div>
          ))}</div>
        )}
      </div>
    </Modal>
  );
}
