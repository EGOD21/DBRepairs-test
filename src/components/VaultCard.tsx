import { useEffect, useState } from "react";
import Icon from "./Icon";
import Modal from "./Modal";
import { Asset, createCredential, Credential, CredentialInput, deleteCredential, listAssets, listCredentials, revealCredential, updateCredential, vaultStatus } from "../data/records";
import { fill } from "../lib/format";
import { useI18n } from "../i18n/I18nProvider";

const HIDE_AFTER_MS = 30_000;

/** Saved logins for a customer or one piece of equipment. Passwords stay hidden until asked for, and every view is logged. */
export default function VaultCard({ customerId, assetId }: { customerId: number; assetId?: number }) {
  const { t } = useI18n();
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [items, setItems] = useState<Credential[]>([]);
  const [shown, setShown] = useState<Record<number, string>>({});
  const [editing, setEditing] = useState<Credential | "new" | null>(null);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState<number | null>(null);

  const load = () => listCredentials(assetId ? { assetId } : { customerId }).then(setItems).catch(() => setError(t("common.databaseError")));
  useEffect(() => { vaultStatus().then((s) => setEnabled(s.enabled)).catch(() => setEnabled(false)); void load(); }, [customerId, assetId]);

  async function reveal(item: Credential) {
    if (shown[item.id] !== undefined) { setShown(({ [item.id]: _gone, ...rest }) => rest); return; }
    try {
      const { secret } = await revealCredential(item.id);
      setShown((current) => ({ ...current, [item.id]: secret }));
      window.setTimeout(() => setShown(({ [item.id]: _gone, ...rest }) => rest), HIDE_AFTER_MS);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("common.saveError"));
    }
  }

  async function copy(item: Credential) {
    try {
      const secret = shown[item.id] ?? (await revealCredential(item.id)).secret;
      await navigator.clipboard.writeText(secret);
      setCopied(item.id);
      window.setTimeout(() => setCopied(null), 2000);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("vault.copyFailed"));
    }
  }

  return (
    <section className="card">
      <div className="card-header">
        <div><h2><Icon name="lock" size={16} /> {t("vault.title")}</h2><p>{t("vault.hint")}</p></div>
        {enabled && <button type="button" className="btn btn-sm" onClick={() => setEditing("new")}><Icon name="plus" size={15} />{t("vault.add")}</button>}
      </div>
      {enabled === false && <div className="card-body"><div className="alert warning">{t("vault.off")}</div></div>}
      {error && <div className="card-body"><div className="alert error">{error}</div></div>}
      {items.length === 0 ? (enabled ? <div className="empty">{t("vault.empty")}</div> : null) : (
        <div className="vault-list">{items.map((item) => (
          <div key={item.id} className="vault-item">
            <div className="vault-main">
              <strong>{item.label}</strong>
              {!assetId && item.asset_name && <span className="badge">{item.asset_name}</span>}
              {item.username && <span className="mono">{item.username}</span>}
              {item.has_secret && <span className="mono vault-secret">{shown[item.id] ?? "••••••••••"}</span>}
              {item.url && <a href={item.url} target="_blank" rel="noopener noreferrer" className="muted">{item.url}</a>}
              {item.notes && <small className="muted pre">{item.notes}</small>}
            </div>
            <div className="page-actions">
              {item.has_secret && <button type="button" className="btn btn-sm" onClick={() => void reveal(item)}><Icon name={shown[item.id] !== undefined ? "eyeOff" : "eye"} size={14} />{shown[item.id] !== undefined ? t("vault.hide") : t("vault.show")}</button>}
              {item.has_secret && <button type="button" className="btn btn-sm" onClick={() => void copy(item)}><Icon name={copied === item.id ? "check" : "copy"} size={14} />{copied === item.id ? t("vault.copied") : t("vault.copy")}</button>}
              {enabled && <button type="button" className="btn btn-sm btn-icon btn-ghost" onClick={() => setEditing(item)} aria-label={t("common.edit")}><Icon name="pencil" size={14} /></button>}
            </div>
          </div>
        ))}</div>
      )}
      {editing && <CredentialModal customerId={customerId} assetId={assetId} item={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); setShown({}); void load(); }} />}
    </section>
  );
}

function CredentialModal({ customerId, assetId, item, onClose, onSaved }: { customerId: number; assetId?: number; item: Credential | null; onClose: () => void; onSaved: () => void }) {
  const { t } = useI18n();
  const [form, setForm] = useState<CredentialInput>({ customer_id: customerId, asset_id: item?.asset_id ?? assetId ?? null, label: item?.label ?? "",
    username: item?.username ?? "", secret: "", url: item?.url ?? "", notes: item?.notes ?? "" });
  const [assets, setAssets] = useState<Asset[]>([]);
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const set = <K extends keyof CredentialInput>(key: K, value: CredentialInput[K]) => setForm((f) => ({ ...f, [key]: value }));
  useEffect(() => { if (!assetId) listAssets({ customerId }).then(setAssets).catch(() => {}); }, [customerId, assetId]);

  async function save() {
    setBusy(true); setError("");
    try {
      if (item) await updateCredential(item.id, form); else await createCredential(form);
      onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("common.saveError"));
      setBusy(false);
    }
  }
  async function remove() {
    if (!item || !window.confirm(fill(t("vault.deleteConfirm"), { label: item.label }))) return;
    try { await deleteCredential(item.id); onSaved(); } catch (cause) { setError(cause instanceof Error ? cause.message : t("common.saveError")); }
  }

  return (
    <Modal title={item ? t("vault.edit") : t("vault.add")} onClose={onClose}
      footer={<>{item && <button type="button" className="btn btn-danger" style={{ marginRight: "auto" }} onClick={() => void remove()}>{t("common.delete")}</button>}
        <button type="button" className="btn" onClick={onClose}>{t("common.cancel")}</button>
        <button type="button" className="btn btn-primary" disabled={busy || !form.label.trim()} onClick={() => void save()}>{t("common.save")}</button></>}>
      <div className="modal-body">
        <div className="form-grid">
          <label className="field full"><span>{t("vault.label")} *</span><input value={form.label} onChange={(e) => set("label", e.target.value)} placeholder={t("vault.labelPlaceholder")} autoComplete="off" /></label>
          <label className="field"><span>{t("vault.username")}</span><input value={form.username} onChange={(e) => set("username", e.target.value)} autoComplete="off" /></label>
          <label className="field"><span>{t("vault.password")}</span>
            <div className="input-with-button">
              <input type={visible ? "text" : "password"} value={form.secret} onChange={(e) => set("secret", e.target.value)} autoComplete="new-password" placeholder={item ? t("vault.keepPassword") : ""} />
              <button type="button" className="btn btn-icon" onClick={() => setVisible((v) => !v)} aria-label={t("vault.show")}><Icon name={visible ? "eyeOff" : "eye"} size={15} /></button>
            </div></label>
          {!assetId && assets.length > 0 && <label className="field"><span>{t("asset.title")}</span>
            <select value={form.asset_id ?? ""} onChange={(e) => set("asset_id", e.target.value ? Number(e.target.value) : null)}>
              <option value="">—</option>{assets.map((asset) => <option key={asset.id} value={asset.id}>{asset.name}</option>)}</select></label>}
          <label className="field"><span>{t("vault.url")}</span><input value={form.url} onChange={(e) => set("url", e.target.value)} placeholder="https://" /></label>
          <label className="field full"><span>{t("vault.notes")}</span><textarea rows={2} value={form.notes} onChange={(e) => set("notes", e.target.value)} /></label>
        </div>
        <p className="hint">{t("vault.logged")}</p>
        {error && <div className="alert error">{error}</div>}
      </div>
    </Modal>
  );
}
