import { useEffect, useState } from "react";
import Icon from "./Icon";
import AssetModal from "./AssetModal";
import { Asset, listAssets } from "../data/records";
import { formatPlainDate, todayIso } from "../lib/format";
import { useI18n } from "../i18n/I18nProvider";
import { href, navigate } from "../router";

export function warrantyState(warrantyEnd: string | null) {
  if (!warrantyEnd) return null;
  const today = todayIso();
  if (warrantyEnd < today) return "expired";
  const soon = new Date(Date.now() + 60 * 86400_000).toISOString().slice(0, 10);
  return warrantyEnd <= soon ? "soon" : "ok";
}

/** The customer's equipment: servers, PCs, laptops, network gear. */
export default function AssetsCard({ customerId }: { customerId: number }) {
  const { t } = useI18n();
  const [assets, setAssets] = useState<Asset[]>([]);
  const [adding, setAdding] = useState(false);
  const [showRetired, setShowRetired] = useState(false);

  const load = () => listAssets({ customerId }).then(setAssets).catch(() => setAssets([]));
  useEffect(() => { void load(); }, [customerId]);
  const shown = assets.filter((asset) => showRetired || asset.status === "active");
  const retired = assets.length - assets.filter((asset) => asset.status === "active").length;

  return (
    <section className="card">
      <div className="card-header">
        <div><h2>{t("asset.title")}</h2><p>{t("asset.hint")}</p></div>
        <div className="card-actions">
          {retired > 0 && <label className="check"><input type="checkbox" checked={showRetired} onChange={(e) => setShowRetired(e.target.checked)} />{t("asset.showRetired")} ({retired})</label>}
          <button type="button" className="btn btn-sm" onClick={() => setAdding(true)}><Icon name="plus" size={15} />{t("asset.add")}</button>
        </div>
      </div>
      {shown.length === 0 ? <div className="empty">{t("asset.empty")}</div> : (
        <div className="table-wrap"><table className="responsive compact">
          <thead><tr><th>{t("asset.name")}</th><th>{t("asset.kind")}</th><th>{t("repair.serialNumber")}</th><th>{t("asset.ip")}</th><th>{t("asset.warrantyEnd")}</th><th>{t("nav.repairs")}</th></tr></thead>
          <tbody>{shown.map((asset) => {
            const warranty = warrantyState(asset.warranty_end);
            return (
              <tr key={asset.id} className="clickable" onClick={() => navigate({ name: "asset", id: asset.id })}>
                <td data-label={t("asset.name")} className="cell-title"><strong><a href={href({ name: "asset", id: asset.id })}>{asset.name}</a></strong>
                  <div className="muted" style={{ fontSize: 12 }}>{[asset.brand, asset.model].filter(Boolean).join(" ")}{asset.status === "retired" ? ` · ${t("asset.status.retired")}` : ""}</div></td>
                <td data-label={t("asset.kind")}>{t(`asset.kind.${asset.kind}`)}</td>
                <td data-label={t("repair.serialNumber")} className="mono">{asset.serial_number || "—"}</td>
                <td data-label={t("asset.ip")} className="mono">{asset.ip_address || "—"}</td>
                <td data-label={t("asset.warrantyEnd")} className="nowrap">{asset.warranty_end ? <span className={`badge ${warranty === "expired" ? "danger" : warranty === "soon" ? "warning" : ""}`}>{formatPlainDate(asset.warranty_end)}</span> : "—"}</td>
                <td data-label={t("nav.repairs")}>{asset.repair_count}</td>
              </tr>
            );
          })}</tbody>
        </table></div>
      )}
      {adding && <AssetModal customerId={customerId} onClose={() => setAdding(false)} onSaved={() => { setAdding(false); void load(); }} />}
    </section>
  );
}
