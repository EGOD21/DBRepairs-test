import { useEffect, useState } from "react";
import Icon from "./Icon";
import Modal from "./Modal";
import WipeCertificate from "../print/WipeCertificate";
import { Asset, createWipe, deleteWipe, listAssets, listWipes, updateWipe, Wipe, WipeInput, wipeMethods } from "../data/records";
import { AppSettings, emptySettings, getSettings } from "../data/settings";
import { officeFromSettings } from "../print/data";
import { useI18n } from "../i18n/I18nProvider";
import { useSession } from "../session";

const localDateTime = (iso?: string) => {
  const date = iso ? new Date(iso) : new Date();
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};

/** Drive wipes for a repair or customer, each printable as a certificate. */
export default function WipesCard({ customerId, repairId }: { customerId: number; repairId?: number }) {
  const { t } = useI18n();
  const [wipes, setWipes] = useState<Wipe[]>([]);
  const [editing, setEditing] = useState<Wipe | "new" | null>(null);
  const [printing, setPrinting] = useState<Wipe | null>(null);
  const [settings, setSettings] = useState<AppSettings>(emptySettings);

  const load = () => listWipes(repairId ? { repairId } : { customerId }).then(setWipes).catch(() => setWipes([]));
  useEffect(() => { void load(); getSettings().then(setSettings).catch(() => {}); }, [customerId, repairId]);

  return (
    <section className="card">
      <div className="card-header">
        <div><h2>{t("wipe.title")}</h2><p>{t("wipe.hint")}</p></div>
        <button type="button" className="btn btn-sm" onClick={() => setEditing("new")}><Icon name="plus" size={15} />{t("wipe.add")}</button>
      </div>
      {wipes.length === 0 ? <div className="empty">{t("wipe.empty")}</div> : (
        <div className="table-wrap"><table className="responsive compact">
          <thead><tr><th>{t("wipe.certificate")}</th><th>{t("wipe.drive")}</th><th>{t("wipe.method")}</th><th>{t("wipe.result")}</th><th /></tr></thead>
          <tbody>{wipes.map((wipe) => (
            <tr key={wipe.id}>
              <td data-label={t("wipe.certificate")} className="cell-title nowrap"><strong>{wipe.certificate_number}</strong><div className="muted" style={{ fontSize: 12 }}>{new Date(wipe.completed_at).toLocaleDateString()}{!repairId && wipe.repair_number ? ` · ${wipe.repair_number}` : ""}</div></td>
              <td data-label={t("wipe.drive")}><span className="mono">{wipe.drive_serial}</span>{wipe.drive_model && <div className="muted" style={{ fontSize: 12 }}>{wipe.drive_model}{wipe.capacity ? ` · ${wipe.capacity}` : ""}</div>}</td>
              <td data-label={t("wipe.method")}>{t(`wipe.method.${wipe.method}`)}</td>
              <td data-label={t("wipe.result")}><span className={`badge ${wipe.result === "passed" ? "success" : "danger"}`}>{t(`wipe.result.${wipe.result}`)}</span></td>
              <td className="actions"><div className="page-actions">
                <button type="button" className="btn btn-sm" onClick={() => setPrinting(wipe)}><Icon name="printer" size={14} /><span className="hide-mobile">{t("wipe.print")}</span></button>
                <button type="button" className="btn btn-sm btn-icon btn-ghost" onClick={() => setEditing(wipe)} aria-label={t("common.edit")}><Icon name="pencil" size={14} /></button>
              </div></td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
      {editing && <WipeModal customerId={customerId} repairId={repairId} wipe={editing === "new" ? null : editing} onClose={() => setEditing(null)}
        onSaved={(saved) => { setEditing(null); void load(); if (saved) setPrinting(saved); }} />}
      {printing && <WipeCertificate wipe={printing} office={officeFromSettings(settings)} statement={settings["wipe.statement"]} onClose={() => setPrinting(null)} />}
    </section>
  );
}

function WipeModal({ customerId, repairId, wipe, onClose, onSaved }: { customerId: number; repairId?: number; wipe: Wipe | null; onClose: () => void; onSaved: (wipe: Wipe | null) => void }) {
  const { t } = useI18n();
  const { user, isAdmin } = useSession();
  const [form, setForm] = useState<WipeInput>(wipe ? {
    customer_id: wipe.customer_id, repair_id: wipe.repair_id, asset_id: wipe.asset_id, method: wipe.method, result: wipe.result, verified: wipe.verified,
    drive_model: wipe.drive_model ?? "", drive_serial: wipe.drive_serial, capacity: wipe.capacity ?? "", interface: wipe.interface ?? "", tool: wipe.tool ?? "",
    passes: wipe.passes?.toString() ?? "", completed_at: localDateTime(wipe.completed_at), technician: wipe.technician ?? "", notes: wipe.notes ?? "",
  } : {
    customer_id: customerId, repair_id: repairId ?? null, asset_id: null, method: "nist_purge", result: "passed", verified: true, drive_model: "", drive_serial: "",
    capacity: "", interface: "", tool: "", passes: "", completed_at: localDateTime(), technician: user?.displayName ?? "", notes: "",
  });
  const [assets, setAssets] = useState<Asset[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const set = <K extends keyof WipeInput>(key: K, value: WipeInput[K]) => setForm((f) => ({ ...f, [key]: value }));
  useEffect(() => { listAssets({ customerId }).then(setAssets).catch(() => {}); }, [customerId]);

  async function save() {
    setBusy(true); setError("");
    try {
      const input = { ...form, completed_at: new Date(form.completed_at).toISOString() };
      onSaved(wipe ? await updateWipe(wipe.id, input) : await createWipe(input));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("common.saveError"));
      setBusy(false);
    }
  }
  async function remove() {
    if (!wipe || !window.confirm(t("wipe.deleteConfirm"))) return;
    try { await deleteWipe(wipe.id); onSaved(null); } catch (cause) { setError(cause instanceof Error ? cause.message : t("common.saveError")); }
  }
  const text = (key: keyof WipeInput, label: string, props: Record<string, unknown> = {}) => (
    <label className="field"><span>{label}</span><input value={String(form[key] ?? "")} onChange={(e) => set(key, e.target.value as never)} {...props} /></label>
  );

  return (
    <Modal title={wipe ? wipe.certificate_number : t("wipe.add")} onClose={onClose} wide
      footer={<>{wipe && isAdmin && <button type="button" className="btn btn-danger" style={{ marginRight: "auto" }} onClick={() => void remove()}>{t("common.delete")}</button>}
        <button type="button" className="btn" onClick={onClose}>{t("common.cancel")}</button>
        <button type="button" className="btn btn-primary" disabled={busy || !form.drive_serial.trim()} onClick={() => void save()}>{wipe ? t("common.save") : t("wipe.saveAndPrint")}</button></>}>
      <div className="modal-body">
        <div className="form-grid three">
          {text("drive_serial", `${t("wipe.serial")} *`, { className: "mono" })}
          {text("drive_model", t("wipe.model"))}
          {text("capacity", t("wipe.capacity"), { placeholder: "1 TB" })}
          {text("interface", t("wipe.interface"), { placeholder: "SATA / NVMe / SAS" })}
          <label className="field"><span>{t("wipe.method")}</span><select value={form.method} onChange={(e) => set("method", e.target.value as WipeInput["method"])}>
            {wipeMethods.map((method) => <option key={method} value={method}>{t(`wipe.method.${method}`)}</option>)}</select></label>
          {text("tool", t("wipe.tool"), { placeholder: "Parted Magic, nwipe, Blancco…" })}
          {text("passes", t("wipe.passes"), { type: "number", min: 1, max: 100 })}
          {text("completed_at", t("wipe.completedAt"), { type: "datetime-local" })}
          {text("technician", t("repair.technician"))}
          <label className="field"><span>{t("wipe.result")}</span><select value={form.result} onChange={(e) => set("result", e.target.value as WipeInput["result"])}>
            <option value="passed">{t("wipe.result.passed")}</option><option value="failed">{t("wipe.result.failed")}</option></select></label>
          {assets.length > 0 && <label className="field"><span>{t("asset.title")}</span><select value={form.asset_id ?? ""} onChange={(e) => set("asset_id", e.target.value ? Number(e.target.value) : null)}>
            <option value="">—</option>{assets.map((asset) => <option key={asset.id} value={asset.id}>{asset.name}</option>)}</select></label>}
          <label className="check"><input type="checkbox" checked={form.verified} onChange={(e) => set("verified", e.target.checked)} />{t("wipe.verified")}</label>
          <label className="field full"><span>{t("wipe.notes")}</span><textarea rows={2} value={form.notes} onChange={(e) => set("notes", e.target.value)} /></label>
        </div>
        {error && <div className="alert error">{error}</div>}
      </div>
    </Modal>
  );
}
