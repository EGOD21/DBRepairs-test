import { useState } from "react";
import Modal from "./Modal";
import Icon from "./Icon";
import { deleteRepair, Repair } from "../data/repairs";
import { fill } from "../lib/format";
import { useI18n } from "../i18n/I18nProvider";

type Props = { repair: Pick<Repair, "id" | "repair_number" | "photo_count">; onClose: () => void; onDeleted: () => void };

/** Confirms deleting a repair and asks what to do with its photos. */
export default function DeleteRepairDialog({ repair, onClose, onDeleted }: Props) {
  const { t } = useI18n();
  const [photos, setPhotos] = useState<"delete" | "keep">("delete");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function confirm() {
    setBusy(true); setError("");
    try {
      await deleteRepair(repair.id, photos);
      onDeleted();
    } catch (cause) {
      console.error(cause);
      setError(t("repair.deleteError"));
      setBusy(false);
    }
  }

  return (
    <Modal title={fill(t("repair.deleteTitle"), { number: repair.repair_number })} subtitle={t("repair.deleteWarning")} onClose={onClose}
      footer={<>
        <button type="button" className="btn" onClick={onClose} disabled={busy}>{t("common.cancel")}</button>
        <button type="button" className="btn btn-danger" onClick={() => void confirm()} disabled={busy}><Icon name="trash" size={16} />{busy ? t("common.deleting") : t("common.delete")}</button>
      </>}>
      <div className="modal-body">
        {repair.photo_count > 0 && (
          <fieldset className="choice-list">
            <legend>{fill(t("photos.whatToDo"), { count: String(repair.photo_count) })}</legend>
            <label className={`choice${photos === "delete" ? " active" : ""}`}>
              <input type="radio" name="photos" checked={photos === "delete"} onChange={() => setPhotos("delete")} />
              <span><strong>{t("photos.deleteWithRepair")}</strong><small>{t("photos.deleteWithRepairHint")}</small></span>
            </label>
            <label className={`choice${photos === "keep" ? " active" : ""}`}>
              <input type="radio" name="photos" checked={photos === "keep"} onChange={() => setPhotos("keep")} />
              <span><strong>{t("photos.keepArchived")}</strong><small>{t("photos.keepArchivedHint")}</small></span>
            </label>
          </fieldset>
        )}
        {error && <div className="alert error">{error}</div>}
      </div>
    </Modal>
  );
}
