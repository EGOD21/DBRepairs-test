import { useEffect, useState } from "react";
import Icon from "../components/Icon";
import { StatusBadge } from "../components/Badges";
import AssetModal from "../components/AssetModal";
import VaultCard from "../components/VaultCard";
import { warrantyState } from "../components/AssetsCard";
import { AssetDetail, getAsset } from "../data/records";
import { formatDbDate } from "../data/dates";
import { formatPlainDate } from "../lib/format";
import { useI18n } from "../i18n/I18nProvider";
import { href, navigate } from "../router";

export default function AssetPage({ id }: { id: number }) {
  const { t } = useI18n();
  const [asset, setAsset] = useState<AssetDetail | null>(null);
  const [missing, setMissing] = useState(false);
  const [editing, setEditing] = useState(false);

  const load = () => getAsset(id).then(setAsset).catch(() => setMissing(true));
  useEffect(() => { void load(); }, [id]);

  if (missing) return <div className="page"><div className="empty"><strong>{t("asset.notFound")}</strong></div></div>;
  if (!asset) return <div className="page"><div className="empty">{t("common.loading")}</div></div>;

  const warranty = warrantyState(asset.warranty_end);
  const specs: [string, string | null][] = [
    [t("repair.brand"), asset.brand], [t("repair.model"), asset.model], [t("repair.serialNumber"), asset.serial_number], [t("asset.tag"), asset.asset_tag],
    [t("asset.os"), asset.os], [t("asset.cpu"), asset.cpu], [t("asset.ram"), asset.ram], [t("asset.storage"), asset.storage],
    [t("asset.ip"), asset.ip_address], [t("asset.mac"), asset.mac_address], [t("asset.location"), asset.location],
    [t("asset.purchaseDate"), asset.purchase_date ? formatPlainDate(asset.purchase_date) : null],
  ];

  return (
    <div className="page">
      <a className="back-link" href={href({ name: "customer", id: asset.customer_id })}><Icon name="back" size={15} />{asset.customer_name}</a>
      <header className="page-header">
        <div>
          <div className="title-row"><h1>{asset.name}</h1><span className="badge">{t(`asset.kind.${asset.kind}`)}</span>
            {asset.status === "retired" && <span className="badge">{t("asset.status.retired")}</span>}
            {asset.warranty_end && <span className={`badge ${warranty === "expired" ? "danger" : warranty === "soon" ? "warning" : "success"}`}>{t("asset.warrantyEnd")} {formatPlainDate(asset.warranty_end)}</span>}</div>
          <p><a href={href({ name: "customer", id: asset.customer_id })}>{asset.customer_name}</a></p>
        </div>
        <div className="page-actions">
          <button type="button" className="btn" onClick={() => setEditing(true)}><Icon name="pencil" size={16} />{t("common.edit")}</button>
          <a className="btn btn-primary" href={href({ name: "repairs", filter: `new:${asset.customer_id}` })}><Icon name="plus" size={16} />{t("repair.new")}</a>
        </div>
      </header>
      <div className="detail-grid">
        <div className="detail-main">
          <section className="card">
            <div className="card-header"><h2>{t("asset.history")}</h2></div>
            {asset.repairs.length === 0 ? <div className="empty">{t("asset.noRepairs")}</div> : (
              <div className="table-wrap"><table className="responsive compact">
                <thead><tr><th>{t("repair.number")}</th><th>{t("repair.reportedFault")}</th><th>{t("repair.status")}</th><th>{t("repair.openedAt")}</th></tr></thead>
                <tbody>{asset.repairs.map((r) => (
                  <tr key={r.id} className="clickable" onClick={() => navigate({ name: "repair", id: r.id })}>
                    <td data-label={t("repair.number")} className="cell-title nowrap"><strong><a href={href({ name: "repair", id: r.id })}>{r.repair_number}</a></strong></td>
                    <td data-label={t("repair.reportedFault")}>{r.reported_fault || "—"}</td>
                    <td data-label={t("repair.status")}><StatusBadge code={r.status_code} labelKey={r.status_label_key} /></td>
                    <td data-label={t("repair.openedAt")} className="nowrap muted">{formatDbDate(r.opened_at)}</td>
                  </tr>
                ))}</tbody>
              </table></div>
            )}
          </section>
          <VaultCard customerId={asset.customer_id} assetId={asset.id} />
          {asset.notes && <section className="card"><div className="card-header"><h2>{t("asset.notes")}</h2></div><div className="card-body pre">{asset.notes}</div></section>}
        </div>
        <div className="detail-side">
          <section className="card">
            <div className="card-header"><h2>{t("asset.specs")}</h2></div>
            <div className="card-body"><dl className="info-list">{specs.filter(([, value]) => value).map(([label, value]) => <div key={label}><dt>{label}</dt><dd className="mono">{value}</dd></div>)}</dl></div>
          </section>
          {asset.wipes.length > 0 && (
            <section className="card"><div className="card-header"><h2>{t("wipe.title")}</h2></div>
              <div className="card-body"><div className="payment-list">{asset.wipes.map((wipe) => (
                <div key={wipe.id} className="payment-item"><strong>{wipe.certificate_number}</strong><small className="muted">{wipe.drive_serial} · {t(`wipe.method.${wipe.method}`)} · {new Date(wipe.completed_at).toLocaleDateString()}</small></div>
              ))}</div></div></section>
          )}
        </div>
      </div>
      {editing && <AssetModal customerId={asset.customer_id} asset={asset} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); void load(); }}
        onDeleted={() => navigate({ name: "customer", id: asset.customer_id })} />}
    </div>
  );
}
