import { useState } from "react";
import Modal from "./Modal";
import { Asset, AssetInput, assetKinds, blankAsset, createAsset, deleteAsset, updateAsset } from "../data/records";
import { fill } from "../lib/format";
import { useI18n } from "../i18n/I18nProvider";

const toInput = (asset: Asset): AssetInput => {
  const { id: _id, customer_name: _c, repair_count: _r, credential_count: _k, ...rest } = asset;
  return Object.fromEntries(Object.entries(rest).map(([key, value]) => [key, value ?? ""])) as unknown as AssetInput;
};

/** Add or edit a piece of the customer's equipment. `initial` pre-fills a new one (for example from a repair). */
export default function AssetModal({ customerId, asset, initial, onClose, onSaved, onDeleted }: {
  customerId: number; asset?: Asset | null; initial?: Partial<AssetInput>; onClose: () => void; onSaved: (asset: Asset) => void; onDeleted?: () => void;
}) {
  const { t } = useI18n();
  const [form, setForm] = useState<AssetInput>(asset ? toInput(asset) : { ...blankAsset(customerId), ...initial });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const set = <K extends keyof AssetInput>(key: K, value: AssetInput[K]) => setForm((f) => ({ ...f, [key]: value }));
  const field = (key: keyof AssetInput, label: string, props: Record<string, unknown> = {}) => (
    <label className="field"><span>{label}</span><input value={String(form[key] ?? "")} onChange={(e) => set(key, e.target.value as never)} {...props} /></label>
  );

  async function save() {
    setBusy(true); setError("");
    try {
      onSaved(asset ? await updateAsset(asset.id, form) : await createAsset(form));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("common.saveError"));
      setBusy(false);
    }
  }
  async function remove() {
    if (!asset || !window.confirm(fill(t("asset.deleteConfirm"), { name: asset.name }))) return;
    try { await deleteAsset(asset.id); onDeleted?.(); } catch (cause) { setError(cause instanceof Error ? cause.message : t("common.saveError")); }
  }

  return (
    <Modal title={asset ? t("asset.edit") : t("asset.add")} onClose={onClose} wide
      footer={<>{asset && onDeleted && <button type="button" className="btn btn-danger" style={{ marginRight: "auto" }} onClick={() => void remove()}>{t("common.delete")}</button>}
        <button type="button" className="btn" onClick={onClose}>{t("common.cancel")}</button>
        <button type="button" className="btn btn-primary" disabled={busy || !form.name.trim()} onClick={() => void save()}>{t("common.save")}</button></>}>
      <div className="modal-body">
        <div className="form-grid three">
          <label className="field"><span>{t("asset.kind")}</span><select value={form.kind} onChange={(e) => set("kind", e.target.value as AssetInput["kind"])}>
            {assetKinds.map((kind) => <option key={kind} value={kind}>{t(`asset.kind.${kind}`)}</option>)}</select></label>
          {field("name", `${t("asset.name")} *`, { placeholder: t("asset.namePlaceholder") })}
          <label className="field"><span>{t("asset.status")}</span><select value={form.status} onChange={(e) => set("status", e.target.value as AssetInput["status"])}>
            <option value="active">{t("asset.status.active")}</option><option value="retired">{t("asset.status.retired")}</option></select></label>
          {field("brand", t("repair.brand"))}
          {field("model", t("repair.model"))}
          {field("serial_number", t("repair.serialNumber"))}
          {field("asset_tag", t("asset.tag"))}
          {field("location", t("asset.location"), { placeholder: t("asset.locationPlaceholder") })}
          {field("os", t("asset.os"))}
          {field("cpu", t("asset.cpu"))}
          {field("ram", t("asset.ram"))}
          {field("storage", t("asset.storage"))}
          {field("ip_address", t("asset.ip"))}
          {field("mac_address", t("asset.mac"))}
          {field("purchase_date", t("asset.purchaseDate"), { type: "date" })}
          {field("warranty_end", t("asset.warrantyEnd"), { type: "date" })}
          <label className="field full"><span>{t("asset.notes")}</span><textarea rows={3} value={form.notes ?? ""} onChange={(e) => set("notes", e.target.value)} /></label>
        </div>
        {error && <div className="alert error">{error}</div>}
      </div>
    </Modal>
  );
}
