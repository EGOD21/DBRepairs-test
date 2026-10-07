import { useEffect, useState } from "react";
import Modal from "./Modal";
import Icon from "./Icon";
import ScanButton from "./ScanButton";
import { listStock, StockItem, takeFromStock } from "../data/shopfloor";
import { formatMoney } from "../lib/format";
import { useI18n } from "../i18n/I18nProvider";

/** Take a part off the shelf for this repair (search by name, SKU or a scanned barcode). */
export default function UseStockModal({ repairId, onClose, onSaved }: { repairId: number; onClose: () => void; onSaved: () => void }) {
  const { t } = useI18n();
  const [search, setSearch] = useState("");
  const [items, setItems] = useState<StockItem[]>([]);
  const [chosen, setChosen] = useState<StockItem | null>(null);
  const [quantity, setQuantity] = useState("1");
  const [error, setError] = useState("");

  useEffect(() => {
    const timer = window.setTimeout(() => {
      listStock({ search }).then((list) => {
        setItems(list);
        // A barcode scanner types the code; jump straight to an exact match.
        const exact = list.find((item) => search && (item.barcode === search.trim() || item.sku?.toLowerCase() === search.trim().toLowerCase()));
        if (exact) setChosen(exact);
      }).catch(() => {});
    }, 150);
    return () => window.clearTimeout(timer);
  }, [search]);

  async function save() {
    if (!chosen) return;
    try { await takeFromStock(repairId, chosen.id, Number(quantity) || 1); onSaved(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : t("common.saveError")); }
  }

  return (
    <Modal title={t("stock.useTitle")} onClose={onClose}
      footer={<><button type="button" className="btn" onClick={onClose}>{t("common.cancel")}</button>
        <button type="button" className="btn btn-primary" disabled={!chosen} onClick={() => void save()}>{t("stock.use")}</button></>}>
      <div className="modal-body">
        <div className="search"><Icon name="search" size={16} /><input className="input" type="search" autoFocus value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("stock.search")} /><ScanButton onResult={setSearch} /></div>
        <div className="pick-list">{items.slice(0, 50).map((item) => (
          <button key={item.id} type="button" className={`pick-item${chosen?.id === item.id ? " active" : ""}`} onClick={() => setChosen(item)} disabled={item.quantity <= 0}>
            <span><strong>{item.name}</strong><small className="muted">{[item.sku, item.location].filter(Boolean).join(" · ")}</small></span>
            <span className="pick-meta"><span className={`badge ${item.quantity <= 0 ? "danger" : item.low ? "warning" : ""}`}>{item.quantity}</span>{formatMoney(item.price)}</span>
          </button>
        ))}</div>
        {chosen && <label className="field"><span>{t("part.quantity")}</span><input type="number" min="1" max={chosen.quantity} value={quantity} onChange={(e) => setQuantity(e.target.value)} /></label>}
        {error && <div className="alert error">{error}</div>}
      </div>
    </Modal>
  );
}
