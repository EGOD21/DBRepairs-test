import { useEffect, useState } from "react";
import Icon from "./Icon";
import Modal from "./Modal";
import SignaturePad from "./SignaturePad";
import AssetModal from "./AssetModal";
import { Asset, checklistItems, defaultChecklist, listAssets, listRepairSignatures, RepairSignature, saveIntake, signRepair } from "../data/records";
import { Repair } from "../data/repairs";
import { AppSettings } from "../data/settings";
import { useI18n } from "../i18n/I18nProvider";
import { href } from "../router";

type Props = { repair: Repair; settings: AppSettings; onChanged: () => void; onSignatures?: (signatures: RepairSignature[]) => void };

/** Counter intake: which equipment it is, the checklist, the data-backup choice and the customer's signatures. */
export default function IntakeCard({ repair, settings, onChanged, onSignatures }: Props) {
  const { t } = useI18n();
  const [assets, setAssets] = useState<Asset[]>([]);
  const [signatures, setSignatures] = useState<RepairSignature[]>([]);
  const [signing, setSigning] = useState<"intake" | "pickup" | null>(null);
  const [addingAsset, setAddingAsset] = useState(false);
  const [error, setError] = useState("");
  const items = checklistItems(settings["intake.checklist"] || defaultChecklist);
  const checked = repair.intake_checklist ?? {};

  useEffect(() => {
    listAssets({ customerId: repair.customer_id }).then(setAssets).catch(() => {});
    listRepairSignatures(repair.id).then((list) => { setSignatures(list); onSignatures?.(list); }).catch(() => {});
  }, [repair.id, repair.customer_id]);

  async function save(patch: Parameters<typeof saveIntake>[1]) {
    setError("");
    try { await saveIntake(repair.id, patch); onChanged(); } catch (cause) { setError(cause instanceof Error ? cause.message : t("common.saveError")); }
  }

  const signature = (kind: "intake" | "pickup") => signatures.find((s) => s.kind === kind);

  return (
    <section className="card">
      <div className="card-header"><div><h2>{t("intake.title")}</h2><p>{t("intake.hint")}</p></div></div>
      <div className="card-body" style={{ display: "grid", gap: 16 }}>
        {error && <div className="alert error">{error}</div>}
        <label className="field"><span>{t("intake.equipment")}</span>
          <div className="input-with-button">
            <select value={repair.asset_id ?? ""} onChange={(e) => void save({ asset_id: e.target.value ? Number(e.target.value) : null })}>
              <option value="">{t("intake.noEquipment")}</option>
              {assets.map((asset) => <option key={asset.id} value={asset.id}>{asset.name}{asset.serial_number ? ` · ${asset.serial_number}` : ""}</option>)}
            </select>
            {repair.asset_id ? <a className="btn" href={href({ name: "asset", id: repair.asset_id })}><Icon name="external" size={14} /></a>
              : <button type="button" className="btn" onClick={() => setAddingAsset(true)} title={t("intake.saveAsEquipment")}><Icon name="plus" size={14} /></button>}
          </div>
          <small>{t("intake.equipmentHint")}</small></label>
        <div className="field"><span>{t("intake.backup")}</span>
          <div className="segmented" role="group">
            {(["requested", "declined", "not_needed"] as const).map((choice) => (
              <button key={choice} type="button" className={repair.data_backup === choice ? "active" : ""} onClick={() => void save({ data_backup: repair.data_backup === choice ? null : choice })}>{t(`intake.backup.${choice}`)}</button>
            ))}
          </div></div>
        <div className="field"><span>{t("intake.checklist")}</span>
          <div className="checklist">{items.map((item) => (
            <label key={item} className="check"><input type="checkbox" checked={Boolean(checked[item])} onChange={(e) => void save({ intake_checklist: { ...checked, [item]: e.target.checked } })} />{item}</label>
          ))}</div></div>
        <div className="signature-pair">
          {(["intake", "pickup"] as const).map((kind) => {
            const existing = signature(kind);
            return (
              <div key={kind} className="signature-slot">
                <div className="title-row"><strong>{t(`intake.signature.${kind}`)}</strong>
                  <button type="button" className="btn btn-sm" onClick={() => setSigning(kind)}><Icon name="pencil" size={14} />{existing ? t("intake.signAgain") : t("intake.sign")}</button></div>
                {existing ? <div className="signature-view"><img src={existing.image} alt="" /><span>{existing.signer_name} · {new Date(existing.signed_at).toLocaleString()}</span></div>
                  : <p className="muted">{t("intake.notSigned")}</p>}
              </div>
            );
          })}
        </div>
      </div>
      {signing && <SignModal kind={signing} repair={repair} settings={settings} onClose={() => setSigning(null)}
        onSaved={() => { setSigning(null); listRepairSignatures(repair.id).then((list) => { setSignatures(list); onSignatures?.(list); }).catch(() => {}); }} />}
      {addingAsset && <AssetModal customerId={repair.customer_id} onClose={() => setAddingAsset(false)}
        initial={{ kind: /laptop|notebook/i.test(repair.device_type ?? "") ? "laptop" : /server/i.test(repair.device_type ?? "") ? "server" : "desktop",
          name: [repair.brand, repair.model].filter(Boolean).join(" ") || repair.device_type || "", brand: repair.brand ?? "", model: repair.model ?? "", serial_number: repair.serial_number ?? "" }}
        onSaved={(asset) => { setAddingAsset(false); setAssets((list) => [...list, asset]); void save({ asset_id: asset.id }); }} />}
    </section>
  );
}

function SignModal({ kind, repair, settings, onClose, onSaved }: { kind: "intake" | "pickup"; repair: Repair; settings: AppSettings; onClose: () => void; onSaved: () => void }) {
  const { t } = useI18n();
  const [name, setName] = useState(repair.customer_name);
  const [image, setImage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const terms = kind === "intake" ? [settings["intake.waiver"] || t("intake.defaultWaiver"), settings["print.terms"]].filter(Boolean).join("\n\n") : t("intake.pickupStatement");

  async function save() {
    setBusy(true); setError("");
    try { await signRepair(repair.id, kind, name, image); onSaved(); } catch (cause) { setError(cause instanceof Error ? cause.message : t("common.saveError")); setBusy(false); }
  }

  return (
    <Modal title={t(`intake.signature.${kind}`)} subtitle={repair.repair_number} onClose={onClose}
      footer={<><button type="button" className="btn" onClick={onClose}>{t("common.cancel")}</button>
        <button type="button" className="btn btn-primary" disabled={busy || !name.trim() || !image} onClick={() => void save()}>{t("intake.confirmSign")}</button></>}>
      <div className="modal-body">
        <div className="waiver-text pre">{terms}</div>
        <label className="field"><span>{t("signature.name")}</span><input value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" /></label>
        <div className="field"><span>{t("signature.title")}</span><SignaturePad onChange={setImage} /></div>
        {error && <div className="alert error">{error}</div>}
      </div>
    </Modal>
  );
}
