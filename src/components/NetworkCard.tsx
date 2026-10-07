import { ChangeEvent, useEffect, useRef, useState } from "react";
import Icon from "./Icon";
import { CustomerNetwork, deleteFile, fileUrl, getNetwork, NetworkItem, networkKinds, saveNetwork } from "../data/records";
import { uploadFile } from "../data/api";
import { formatBytes } from "../data/photos";
import { formatDbDate } from "../data/dates";
import { useI18n } from "../i18n/I18nProvider";

type Draft = { isp: string; wan_ip: string; notes: string; items: (NetworkItem & { key: number })[] };
let key = 0;

/** ISP, addresses, VLANs, Wi-Fi and diagrams for a customer's network. */
export default function NetworkCard({ customerId }: { customerId: number }) {
  const { t } = useI18n();
  const [data, setData] = useState<CustomerNetwork | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const input = useRef<HTMLInputElement>(null);

  const load = () => getNetwork(customerId).then(setData).catch(() => setError(t("common.databaseError")));
  useEffect(() => { void load(); }, [customerId]);

  function edit() {
    setDraft({ isp: data?.network?.isp ?? "", wan_ip: data?.network?.wan_ip ?? "", notes: data?.network?.notes ?? "",
      items: (data?.items ?? []).map((item) => ({ ...item, key: ++key })) });
  }
  const setItem = (k: number, patch: Partial<NetworkItem>) => setDraft((d) => d && { ...d, items: d.items.map((item) => (item.key === k ? { ...item, ...patch } : item)) });

  async function save() {
    if (!draft) return;
    setBusy(true); setError("");
    try {
      await saveNetwork(customerId, { ...draft, items: draft.items.filter((item) => item.name.trim()).map(({ key: _k, ...item }) => item) });
      setDraft(null);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("common.saveError"));
    } finally {
      setBusy(false);
    }
  }

  async function upload(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    setError("");
    for (const file of files) {
      try { await uploadFile(`/customers/${customerId}/files`, file); } catch (cause) { setError(cause instanceof Error ? cause.message : t("common.saveError")); }
    }
    await load();
  }

  async function removeFile(id: number) {
    if (!window.confirm(t("network.deleteFileConfirm"))) return;
    try { await deleteFile(id); await load(); } catch (cause) { setError(cause instanceof Error ? cause.message : t("common.saveError")); }
  }

  const network = data?.network;
  return (
    <section className="card">
      <div className="card-header">
        <div><h2>{t("network.title")}</h2><p>{network ? `${t("network.updated")} ${formatDbDate(network.updated_at)}${network.updated_by ? ` · ${network.updated_by}` : ""}` : t("network.hint")}</p></div>
        <div className="card-actions">
          {draft ? <>
            <button type="button" className="btn btn-sm" onClick={() => setDraft(null)}>{t("common.cancel")}</button>
            <button type="button" className="btn btn-sm btn-primary" disabled={busy} onClick={() => void save()}>{t("common.save")}</button>
          </> : <button type="button" className="btn btn-sm" onClick={edit}><Icon name="pencil" size={14} />{t("common.edit")}</button>}
        </div>
      </div>
      <div className="card-body" style={{ display: "grid", gap: 16 }}>
        {error && <div className="alert error">{error}</div>}
        {draft ? (<>
          <div className="form-grid">
            <label className="field"><span>{t("network.isp")}</span><input value={draft.isp} onChange={(e) => setDraft({ ...draft, isp: e.target.value })} /></label>
            <label className="field"><span>{t("network.wanIp")}</span><input value={draft.wan_ip} onChange={(e) => setDraft({ ...draft, wan_ip: e.target.value })} /></label>
          </div>
          <div className="network-editor">
            {draft.items.map((item) => (
              <div key={item.key} className="network-row">
                <select className="input" value={item.kind} onChange={(e) => setItem(item.key, { kind: e.target.value as NetworkItem["kind"] })} aria-label={t("network.kind")}>
                  {networkKinds.map((kind) => <option key={kind} value={kind}>{t(`network.kind.${kind}`)}</option>)}</select>
                <input className="input" value={item.name} placeholder={t("network.name")} onChange={(e) => setItem(item.key, { name: e.target.value })} />
                <input className="input mono" value={item.value ?? ""} placeholder={t("network.value")} onChange={(e) => setItem(item.key, { value: e.target.value })} />
                <input className="input" value={item.notes ?? ""} placeholder={t("network.notes")} onChange={(e) => setItem(item.key, { notes: e.target.value })} />
                <button type="button" className="btn btn-sm btn-icon btn-ghost" onClick={() => setDraft({ ...draft, items: draft.items.filter((other) => other.key !== item.key) })} aria-label={t("common.delete")}><Icon name="trash" size={14} /></button>
              </div>
            ))}
            <button type="button" className="btn btn-sm" onClick={() => setDraft({ ...draft, items: [...draft.items, { key: ++key, kind: "subnet", name: "", value: "", notes: "" }] })}><Icon name="plus" size={14} />{t("network.addRow")}</button>
          </div>
          <label className="field"><span>{t("network.freeNotes")}</span><textarea rows={6} value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} placeholder={t("network.freeNotesPlaceholder")} /></label>
          <p className="hint">{t("network.noPasswords")}</p>
        </>) : (<>
          {(network?.isp || network?.wan_ip) && <dl className="info-list two">
            {network?.isp && <div><dt>{t("network.isp")}</dt><dd>{network.isp}</dd></div>}
            {network?.wan_ip && <div><dt>{t("network.wanIp")}</dt><dd className="mono">{network.wan_ip}</dd></div>}
          </dl>}
          {data && data.items.length > 0 && (
            <div className="table-wrap"><table className="responsive compact">
              <thead><tr><th>{t("network.kind")}</th><th>{t("network.name")}</th><th>{t("network.value")}</th><th>{t("network.notes")}</th></tr></thead>
              <tbody>{data.items.map((item) => (
                <tr key={item.id}><td data-label={t("network.kind")} className="cell-title"><span className="badge">{t(`network.kind.${item.kind}`)}</span> <strong className="show-mobile-inline">{item.name}</strong></td>
                  <td data-label={t("network.name")} className="hide-mobile"><strong>{item.name}</strong></td>
                  <td data-label={t("network.value")} className="mono">{item.value || "—"}</td><td data-label={t("network.notes")}>{item.notes || ""}</td></tr>
              ))}</tbody>
            </table></div>
          )}
          {network?.notes && <p className="pre">{network.notes}</p>}
          {!network && (data?.items.length ?? 0) === 0 && <p className="muted">{t("network.empty")}</p>}
        </>)}
        <div className="network-files">
          <div className="title-row"><strong>{t("network.files")}</strong>
            <button type="button" className="btn btn-sm" onClick={() => input.current?.click()}><Icon name="upload" size={14} />{t("network.upload")}</button></div>
          <input ref={input} type="file" multiple hidden accept="image/png,image/jpeg,image/webp,application/pdf" onChange={(e) => void upload(e)} />
          {(data?.files.length ?? 0) === 0 ? <p className="muted">{t("network.noFiles")}</p> : (
            <div className="file-grid">{data!.files.map((file) => (
              <div key={file.id} className="file-tile">
                <a href={fileUrl(file.id)} target="_blank" rel="noopener noreferrer">
                  {file.content_type === "application/pdf" ? <span className="file-icon"><Icon name="file" size={28} />PDF</span> : <img src={fileUrl(file.id)} alt="" loading="lazy" />}
                </a>
                <div className="file-meta"><span className="truncate" title={file.original_name ?? ""}>{file.original_name}</span><small className="muted">{formatBytes(file.size)}</small></div>
                <button type="button" className="btn btn-sm btn-icon btn-ghost" onClick={() => void removeFile(file.id)} aria-label={t("common.delete")}><Icon name="trash" size={14} /></button>
              </div>
            ))}</div>
          )}
        </div>
      </div>
    </section>
  );
}
