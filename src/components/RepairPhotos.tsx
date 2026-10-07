import { ChangeEvent, DragEvent, useEffect, useRef, useState } from "react";
import Icon from "./Icon";
import PhotoLightbox from "./PhotoLightbox";
import { deletePhotos, listRepairPhotos, photoDownloadUrl, photoUrl, RepairPhoto, uploadRepairPhoto } from "../data/photos";
import { fill } from "../lib/format";
import { useI18n } from "../i18n/I18nProvider";

type Props = {
  repairId: number;
  /** Called whenever the number of photos changes. */
  onCountChange?: (count: number) => void;
  /** Opens the print view for these photos. */
  onPrint: (photos: RepairPhoto[]) => void;
};

type Progress = { done: number; total: number; failed: number };

export default function RepairPhotos({ repairId, onCountChange, onPrint }: Props) {
  const { t } = useI18n();
  const [photos, setPhotos] = useState<RepairPhoto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [progress, setProgress] = useState<Progress | null>(null);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [viewing, setViewing] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const cameraInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setLoading(true);
    listRepairPhotos(repairId).then(setPhotos).catch(() => setError(t("photos.loadError"))).finally(() => setLoading(false));
  }, [repairId]);

  useEffect(() => { if (!loading) onCountChange?.(photos.length); }, [photos.length, loading]);

  // Photos go up one at a time so a phone on Wi-Fi is never flooded, and one
  // failure does not stop the rest.
  async function upload(files: File[]) {
    const images = files.filter((file) => file.type.startsWith("image/") || /\.(jpe?g|png|webp|heic|heif)$/i.test(file.name));
    if (!images.length || progress) return;
    setError("");
    const state = { done: 0, total: images.length, failed: 0 };
    setProgress({ ...state });
    for (const file of images) {
      try {
        const photo = await uploadRepairPhoto(repairId, file);
        setPhotos((current) => [...current, photo]);
      } catch (cause) {
        console.error(cause);
        state.failed += 1;
      }
      state.done += 1;
      setProgress({ ...state });
    }
    setProgress(null);
    if (state.failed) setError(fill(t("photos.uploadFailed"), { count: String(state.failed) }));
  }

  function picked(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    void upload(files);
  }

  function dropped(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    setDragging(false);
    void upload(Array.from(event.dataTransfer.files));
  }

  function toggle(id: number) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function stopSelecting() { setSelecting(false); setSelected(new Set()); }

  async function removeSelected() {
    const ids = [...selected];
    if (!ids.length || !window.confirm(fill(t("photos.deleteSelectedConfirm"), { count: String(ids.length) }))) return;
    try {
      await deletePhotos(ids);
      setPhotos((current) => current.filter((photo) => !selected.has(photo.id)));
      stopSelecting();
    } catch (cause) {
      console.error(cause);
      setError(t("photos.deleteError"));
    }
  }

  // Browsers ask once before saving several files from the same page.
  function downloadSelected() {
    photos.filter((photo) => selected.has(photo.id)).forEach((photo, index) => {
      window.setTimeout(() => {
        const link = document.createElement("a");
        link.href = photoDownloadUrl(photo.id);
        link.download = "";
        document.body.appendChild(link);
        link.click();
        link.remove();
      }, index * 400);
    });
  }

  const chosen = photos.filter((photo) => selected.has(photo.id));
  const viewIndex = viewing === null ? -1 : photos.findIndex((photo) => photo.id === viewing);

  return (
    <section className={`card photos-card${dragging ? " dragging" : ""}`}
      onDragOver={(event) => { if (event.dataTransfer.types.includes("Files")) { event.preventDefault(); setDragging(true); } }}
      onDragLeave={(event) => { if (event.currentTarget === event.target) setDragging(false); }}
      onDrop={dropped}>
      <div className="card-header">
        <h2>{t("photos.title")}{photos.length > 0 && <span className="count-pill">{photos.length}</span>}</h2>
        <div className="card-actions">
          {selecting ? (
            <>
              <button type="button" className="btn btn-sm" onClick={() => setSelected(selected.size === photos.length ? new Set() : new Set(photos.map((photo) => photo.id)))}>
                {selected.size === photos.length ? t("photos.selectNone") : t("photos.selectAll")}
              </button>
              <button type="button" className="btn btn-sm" disabled={!chosen.length} onClick={() => onPrint(chosen)}><Icon name="printer" size={15} />{t("print.print")}</button>
              <button type="button" className="btn btn-sm" disabled={!chosen.length} onClick={downloadSelected}><Icon name="download" size={15} /><span className="hide-mobile">{t("photos.download")}</span></button>
              <button type="button" className="btn btn-sm btn-danger" disabled={!chosen.length} onClick={() => void removeSelected()}><Icon name="trash" size={15} /><span className="hide-mobile">{t("common.delete")}</span></button>
              <button type="button" className="btn btn-sm btn-ghost" onClick={stopSelecting}>{t("common.done")}</button>
            </>
          ) : (
            <>
              {photos.length > 0 && <button type="button" className="btn btn-sm" onClick={() => setSelecting(true)}><Icon name="checkSquare" size={15} /><span className="hide-mobile">{t("photos.select")}</span></button>}
              {photos.length > 0 && <button type="button" className="btn btn-sm" onClick={() => onPrint(photos)}><Icon name="printer" size={15} /><span className="hide-mobile">{t("print.print")}</span></button>}
              <button type="button" className="btn btn-sm show-mobile-inline" onClick={() => cameraInput.current?.click()} disabled={Boolean(progress)}><Icon name="camera" size={15} />{t("photos.takePhoto")}</button>
              <button type="button" className="btn btn-sm btn-primary" onClick={() => fileInput.current?.click()} disabled={Boolean(progress)}><Icon name="upload" size={15} />{t("photos.add")}</button>
            </>
          )}
        </div>
      </div>
      <input ref={fileInput} type="file" accept="image/*" multiple hidden onChange={picked} />
      <input ref={cameraInput} type="file" accept="image/*" capture="environment" hidden onChange={picked} />
      <div className="card-body">
        {progress && (
          <div className="upload-progress" role="status">
            <span>{fill(t("photos.uploading"), { done: String(progress.done), total: String(progress.total) })}</span>
            <div className="progress-bar"><div style={{ width: `${Math.round((progress.done / progress.total) * 100)}%` }} /></div>
          </div>
        )}
        {error && <div className="alert error">{error}</div>}
        {loading ? <p className="muted">{t("common.loading")}</p> : photos.length === 0 ? (
          <button type="button" className="photo-drop" onClick={() => fileInput.current?.click()}>
            <Icon name="image" size={26} />
            <strong>{t("photos.emptyTitle")}</strong>
            <span>{t("photos.emptyHint")}</span>
          </button>
        ) : (
          <div className="photo-grid">
            {photos.map((photo) => (
              <button type="button" key={photo.id} className={`photo-tile${selected.has(photo.id) ? " selected" : ""}`}
                onClick={() => (selecting ? toggle(photo.id) : setViewing(photo.id))}
                aria-label={photo.caption || photo.original_name || t("photos.photo")} aria-pressed={selecting ? selected.has(photo.id) : undefined}>
                <img src={photoUrl(photo.id, "thumb")} alt="" loading="lazy" />
                {selecting && <span className="photo-check">{selected.has(photo.id) && <Icon name="check" size={14} />}</span>}
                {photo.caption && <span className="photo-caption">{photo.caption}</span>}
              </button>
            ))}
          </div>
        )}
      </div>
      {viewIndex >= 0 && (
        <PhotoLightbox photos={photos} index={viewIndex} onIndex={(index) => setViewing(photos[index]?.id ?? null)} onClose={() => setViewing(null)}
          onChange={(photo) => setPhotos((current) => current.map((item) => (item.id === photo.id ? photo : item)))}
          onDelete={(photo) => {
            const next = photos.filter((item) => item.id !== photo.id);
            setPhotos(next);
            setViewing(next.length ? next[Math.min(viewIndex, next.length - 1)].id : null);
          }} />
      )}
    </section>
  );
}
