import { useEffect, useState } from "react";
import Icon from "./Icon";
import PhotoLightbox from "./PhotoLightbox";
import { ArchivedPhotoGroup, formatBytes, getStorage, listArchivedPhotos, prunePhotos, RepairPhoto, StorageSummary, verifyStorage, VerifyResult } from "../data/photos";
import { saveSettings } from "../data/settings";
import { formatDbDate } from "../data/dates";
import { fill } from "../lib/format";
import { useI18n } from "../i18n/I18nProvider";

type Notice = { tone: "success" | "error" | "warning"; text: string } | null;

/** Settings > Storage: how much space photos use and ways to clean them up. */
export default function StorageSettings() {
  const { t } = useI18n();
  const [summary, setSummary] = useState<StorageSummary | null>(null);
  const [archived, setArchived] = useState<ArchivedPhotoGroup[]>([]);
  const [days, setDays] = useState("0");
  const [olderThan, setOlderThan] = useState("30");
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState<Notice>(null);
  const [check, setCheck] = useState<VerifyResult | null>(null);
  const [viewing, setViewing] = useState<{ photos: RepairPhoto[]; index: number } | null>(null);

  async function load() {
    const [s, a] = await Promise.all([getStorage(), listArchivedPhotos()]);
    setSummary(s);
    setArchived(a);
    setDays(String(s.autoDeleteDays));
  }

  useEffect(() => { load().catch(() => setNotice({ tone: "error", text: t("common.databaseError") })); }, []);

  async function run(label: string, action: () => Promise<Notice>) {
    setBusy(label); setNotice(null);
    try {
      setNotice(await action());
      await load();
    } catch (cause) {
      setNotice({ tone: "error", text: cause instanceof Error && cause.message ? cause.message : t("common.saveError") });
    } finally {
      setBusy("");
    }
  }

  const removed = (result: { deleted: number; bytes: number }): Notice =>
    ({ tone: "success", text: fill(t("storage.removed"), { count: String(result.deleted), size: formatBytes(result.bytes) }) });

  function prune(target: "closed" | "archived", age: number, repairNumber?: string, count?: number) {
    const question = repairNumber
      ? fill(t("storage.deleteGroupConfirm"), { count: String(count ?? 0), number: repairNumber })
      : fill(t(target === "closed" ? "storage.pruneClosedConfirm" : "storage.pruneArchivedConfirm"), { days: String(age) });
    if (!window.confirm(question)) return;
    void run(`${target}${repairNumber ?? ""}`, async () => removed(await prunePhotos(target, age, repairNumber)));
  }

  const ageDays = Math.max(0, Math.floor(Number(olderThan) || 0));
  const disk = summary?.disk;
  const used = disk ? Math.min(100, Math.round(((disk.total - disk.free) / disk.total) * 100)) : 0;

  if (!summary) return notice ? <div className={`alert ${notice.tone}`}>{notice.text}</div> : <p className="muted">{t("common.loading")}</p>;

  return (
    <div className="storage-settings">
      {notice && <div className={`alert ${notice.tone}`} role="status">{notice.text}</div>}
      {!summary.available && <div className="alert error"><Icon name="alert" size={16} />{t("storage.unavailable")}</div>}

      <div className="stat-grid storage-stats">
        <div className="stat"><span><Icon name="image" size={15} />{t("storage.allPhotos")}</span><strong>{formatBytes(summary.photos.bytes)}</strong><small>{fill(t("storage.photoCount"), { count: String(summary.photos.count) })}</small></div>
        <div className="stat"><span><Icon name="check" size={15} />{t("storage.closedPhotos")}</span><strong>{formatBytes(summary.closed.bytes)}</strong><small>{fill(t("storage.photoCount"), { count: String(summary.closed.count) })}</small></div>
        <div className="stat"><span><Icon name="database" size={15} />{t("storage.archivedPhotos")}</span><strong>{formatBytes(summary.archived.bytes)}</strong><small>{fill(t("storage.photoCount"), { count: String(summary.archived.count) })}</small></div>
      </div>

      {disk && (
        <div className="storage-disk">
          <div className="storage-disk-row"><span><Icon name="hardDrive" size={15} />{t("storage.disk")}</span><span>{fill(t("storage.diskFree"), { free: formatBytes(disk.free), total: formatBytes(disk.total) })}</span></div>
          <div className={`progress-bar${used > 90 ? " danger" : ""}`}><div style={{ width: `${used}%` }} /></div>
          {summary.path && <small className="hint">{t("storage.location")}: <code>{summary.path}</code></small>}
        </div>
      )}

      <div className="storage-block">
        <h3>{t("storage.autoTitle")}</h3>
        <p className="hint">{t("storage.autoHint")}</p>
        <div className="inline-form">
          <select value={["0", "30", "90", "180", "365"].includes(days) ? days : "custom"} onChange={(e) => setDays(e.target.value === "custom" ? "60" : e.target.value)}>
            <option value="0">{t("storage.autoNever")}</option>
            {["30", "90", "180", "365"].map((value) => <option key={value} value={value}>{fill(t("storage.afterDays"), { days: value })}</option>)}
            <option value="custom">{t("storage.custom")}</option>
          </select>
          {!["0", "30", "90", "180", "365"].includes(days) && <input type="number" min="1" max="36500" value={days} onChange={(e) => setDays(e.target.value)} aria-label={t("storage.days")} />}
          <button type="button" className="btn btn-primary" disabled={busy !== "" || String(summary.autoDeleteDays) === days || !/^\d{1,5}$/.test(days)}
            onClick={() => void run("auto", async () => { await saveSettings({ "photos.autoDeleteDays": days === "0" ? "" : days }); return { tone: "success", text: t("common.saved") }; })}>{t("common.save")}</button>
        </div>
      </div>

      <div className="storage-block">
        <h3>{t("storage.cleanTitle")}</h3>
        <p className="hint">{t("storage.cleanHint")}</p>
        <div className="inline-form">
          <label className="inline-label">{t("storage.olderThan")}<input type="number" min="0" max="36500" value={olderThan} onChange={(e) => setOlderThan(e.target.value)} />{t("storage.days")}</label>
        </div>
        <div className="page-actions">
          <button type="button" className="btn btn-danger" disabled={busy !== "" || !summary.closed.count} onClick={() => prune("closed", ageDays)}><Icon name="trash" size={15} />{t("storage.pruneClosed")}</button>
          <button type="button" className="btn btn-danger" disabled={busy !== "" || !summary.archived.count} onClick={() => prune("archived", ageDays)}><Icon name="trash" size={15} />{t("storage.pruneArchived")}</button>
        </div>
      </div>

      <div className="storage-block">
        <h3>{t("storage.archivedTitle")}</h3>
        <p className="hint">{t("storage.archivedHint")}</p>
        {archived.length === 0 ? <p className="muted">{t("storage.archivedEmpty")}</p> : (
          <div className="table-wrap"><table className="responsive">
            <thead><tr><th>{t("print.repairNumber")}</th><th>{t("customer.name")}</th><th>{t("storage.archivedOn")}</th><th>{t("photos.title")}</th><th /></tr></thead>
            <tbody>{archived.map((group) => (
              <tr key={group.repair_number}>
                <td className="cell-title"><strong>{group.repair_number}</strong></td>
                <td data-label={t("customer.name")}>{group.customer_name || "—"}</td>
                <td data-label={t("storage.archivedOn")}>{formatDbDate(group.archived_at)}</td>
                <td data-label={t("photos.title")}>{group.count} · {formatBytes(Number(group.bytes))}</td>
                <td className="actions"><div className="page-actions">
                  <button type="button" className="btn btn-sm" onClick={() => setViewing({ index: 0, photos: group.ids.map((id) => archivedPhoto(id, group)) })}><Icon name="image" size={15} />{t("storage.view")}</button>
                  <button type="button" className="btn btn-sm btn-danger" disabled={busy !== ""} onClick={() => prune("archived", 0, group.repair_number, group.count)}><Icon name="trash" size={15} />{t("common.delete")}</button>
                </div></td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </div>

      <div className="storage-block">
        <h3>{t("storage.checkTitle")}</h3>
        <p className="hint">{t("storage.checkHint")}</p>
        <div className="page-actions">
          <button type="button" className="btn" disabled={busy !== "" || !summary.available} onClick={() => void run("verify", async () => {
            const result = await verifyStorage(false);
            setCheck(result);
            return result.missing.length || result.orphans
              ? { tone: "warning", text: fill(t("storage.checkProblems"), { missing: String(result.missing.length), orphans: String(result.orphans) }) }
              : { tone: "success", text: fill(t("storage.checkOk"), { count: String(result.checked) }) };
          })}>{busy === "verify" ? t("storage.checking") : t("storage.check")}</button>
          {check && (check.missing.length > 0 || check.orphans > 0) && (
            <button type="button" className="btn btn-danger" disabled={busy !== ""} onClick={() => void run("fix", async () => {
              await verifyStorage(true);
              setCheck(null);
              return { tone: "success", text: t("storage.fixed") };
            })}>{t("storage.fix")}</button>
          )}
        </div>
      </div>

      <div className="storage-block">
        <h3>{t("storage.backupTitle")}</h3>
        <p className="hint">{t("storage.backupHint")}</p>
        <pre className="code-block">docker run --rm -v dbrepairs_repair_photos:/photos -v "$PWD":/out alpine tar czf /out/dbrepairs-photos.tgz -C /photos .</pre>
      </div>

      {viewing && <PhotoLightbox readOnly photos={viewing.photos} index={viewing.index} onIndex={(index) => setViewing({ ...viewing, index })} onClose={() => setViewing(null)} />}
    </div>
  );
}

// The archived list only carries ids; the viewer needs just enough to show each photo.
function archivedPhoto(id: number, group: ArchivedPhotoGroup): RepairPhoto {
  return {
    id, repair_id: null, repair_number: group.repair_number, customer_name: group.customer_name, original_name: null, content_type: "image/jpeg",
    size: 0, thumb_size: 0, has_thumb: false, caption: null, created_at: group.archived_at, archived_at: group.archived_at, uploaded_by_name: null,
  };
}
