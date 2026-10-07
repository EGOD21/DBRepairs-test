import { TouchEvent, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Icon from "./Icon";
import { deletePhoto, photoDownloadUrl, photoUrl, RepairPhoto, updatePhotoCaption } from "../data/photos";
import { formatDbDate } from "../data/dates";
import { useI18n } from "../i18n/I18nProvider";

type Props = {
  photos: RepairPhoto[];
  index: number;
  onIndex: (index: number) => void;
  onClose: () => void;
  onChange?: (photo: RepairPhoto) => void;
  onDelete?: (photo: RepairPhoto) => void;
  /** Archived photos are shown without editing. */
  readOnly?: boolean;
};

/** Full-screen photo viewer: arrows or swipe to move, Esc to close. */
export default function PhotoLightbox({ photos, index, onIndex, onClose, onChange, onDelete, readOnly = false }: Props) {
  const { t } = useI18n();
  const photo = photos[index];
  const [caption, setCaption] = useState(photo?.caption ?? "");
  const [error, setError] = useState("");
  const touchStart = useRef<number | null>(null);
  const editing = useRef(false);

  useEffect(() => { setCaption(photo?.caption ?? ""); setError(""); }, [photo?.id]);

  const go = (step: number) => { if (photos.length > 1) onIndex((index + step + photos.length) % photos.length); };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (editing.current) return;
      if (event.key === "ArrowLeft") go(-1);
      if (event.key === "ArrowRight") go(1);
    };
    window.addEventListener("keydown", onKey);
    document.body.classList.add("no-scroll");
    return () => { window.removeEventListener("keydown", onKey); document.body.classList.remove("no-scroll"); };
  }, [index, photos.length, onClose]);

  if (!photo) return null;

  async function saveCaption() {
    editing.current = false;
    if (!photo || caption.trim() === (photo.caption ?? "")) return;
    try {
      await updatePhotoCaption(photo.id, caption);
      onChange?.({ ...photo, caption: caption.trim() || null });
    } catch {
      setError(t("common.saveError"));
    }
  }

  async function remove() {
    if (!photo || !window.confirm(t("photos.deleteConfirm"))) return;
    try {
      await deletePhoto(photo.id);
      onDelete?.(photo);
    } catch {
      setError(t("photos.deleteError"));
    }
  }

  const onTouchStart = (event: TouchEvent) => { touchStart.current = event.touches[0]?.clientX ?? null; };
  const onTouchEnd = (event: TouchEvent) => {
    const start = touchStart.current;
    const end = event.changedTouches[0]?.clientX;
    touchStart.current = null;
    if (start == null || end == null || Math.abs(end - start) < 50) return;
    go(end < start ? 1 : -1);
  };

  return createPortal(
    <div className="lightbox" role="dialog" aria-modal="true" aria-label={t("photos.title")}>
      <div className="lightbox-bar">
        <span className="lightbox-count">{index + 1} / {photos.length}</span>
        <div>
          <a className="btn btn-sm lightbox-btn" href={photoDownloadUrl(photo.id)} download><Icon name="download" size={15} /><span className="hide-mobile">{t("photos.download")}</span></a>
          {!readOnly && <button type="button" className="btn btn-sm lightbox-btn" onClick={() => void remove()}><Icon name="trash" size={15} /><span className="hide-mobile">{t("common.delete")}</span></button>}
          <button type="button" className="btn btn-sm lightbox-btn" onClick={onClose} aria-label={t("common.close")}><Icon name="x" size={16} /></button>
        </div>
      </div>
      <div className="lightbox-stage" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}
        onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
        {photos.length > 1 && <button type="button" className="lightbox-nav prev" onClick={() => go(-1)} aria-label={t("photos.previous")}><Icon name="chevronLeft" size={26} /></button>}
        <img key={photo.id} src={photoUrl(photo.id)} alt={photo.caption || ""} />
        {photos.length > 1 && <button type="button" className="lightbox-nav next" onClick={() => go(1)} aria-label={t("photos.next")}><Icon name="chevronRight" size={26} /></button>}
      </div>
      <div className="lightbox-foot">
        {readOnly ? (photo.caption && <p>{photo.caption}</p>) : (
          <input className="lightbox-caption" value={caption} placeholder={t("photos.captionPlaceholder")} maxLength={500}
            onFocus={() => { editing.current = true; }} onChange={(event) => setCaption(event.target.value)} onBlur={() => void saveCaption()}
            onKeyDown={(event) => { if (event.key === "Enter") (event.target as HTMLInputElement).blur(); }} />
        )}
        <small>{[photo.uploaded_by_name, formatDbDate(photo.created_at)].filter(Boolean).join(" · ")}</small>
        {error && <small className="lightbox-error">{error}</small>}
      </div>
    </div>,
    document.body,
  );
}
