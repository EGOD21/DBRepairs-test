import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Icon from "../components/Icon";
import { photoUrl, RepairPhoto } from "../data/photos";
import { useI18n } from "../i18n/I18nProvider";
import { fill } from "../lib/format";
import { OfficeSettings, RepairPrintData } from "./types";

const layouts = [1, 2, 4, 6] as const;
type Layout = typeof layouts[number];

type Props = { photos: RepairPhoto[]; data: RepairPrintData; office: OfficeSettings; onClose: () => void };

/** A4 photo sheets: a repair header on every page and 1, 2, 4 or 6 photos per page. */
export default function PhotoPrint({ photos, data, office, onClose }: Props) {
  const { t } = useI18n();
  const [perPage, setPerPage] = useState<Layout>(photos.length === 1 ? 1 : 4);
  const [captions, setCaptions] = useState(true);

  useEffect(() => {
    const style = document.createElement("style");
    style.textContent = "@media print { @page { size: A4 portrait; margin: 0; } }";
    document.head.appendChild(style);
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => { style.remove(); window.removeEventListener("keydown", onKey); };
  }, [onClose]);

  const pages: RepairPhoto[][] = [];
  for (let i = 0; i < photos.length; i += perPage) pages.push(photos.slice(i, i + perPage));
  const device = [data.deviceType, data.brand, data.model].filter(Boolean).join(" · ");

  return createPortal(
    <div className="print-overlay">
      <div className="print-toolbar">
        <div>
          <span className="muted">{t("photos.perPage")}</span>
          <div className="segmented" role="tablist">
            {layouts.map((layout) => <button type="button" key={layout} className={perPage === layout ? "active" : ""} onClick={() => setPerPage(layout)}>{layout}</button>)}
          </div>
          <label className="check"><input type="checkbox" checked={captions} onChange={(event) => setCaptions(event.target.checked)} />{t("photos.showCaptions")}</label>
        </div>
        <div>
          <button type="button" className="btn" onClick={onClose}>{t("common.close")}</button>
          <button type="button" className="btn btn-primary" onClick={() => window.print()}><Icon name="printer" size={16} />{t("print.print")}</button>
        </div>
      </div>
      <div className="print-stage photo-pages">
        {pages.map((page, pageIndex) => (
          <section className="print-sheet photo-sheet" key={pageIndex}>
            <header className="photo-sheet-head">
              <div className="slip-brand-wrap">
                <img src={office.logoDataUrl || "/dbrepairs-icon.png"} alt="" />
                <div><strong>{office.companyName || "DBRepairs"}</strong><span>{t("photos.title")} · {data.repairNumber}</span></div>
              </div>
              <div className="photo-sheet-meta">
                <strong>{data.customerName}</strong>
                {device && <span>{device}</span>}
                <span>{fill(t("photos.pageOf"), { page: String(pageIndex + 1), pages: String(pages.length) })}</span>
              </div>
            </header>
            <div className={`photo-sheet-grid per-${perPage}`}>
              {page.map((photo) => (
                <figure key={photo.id}>
                  <div><img src={photoUrl(photo.id)} alt="" /></div>
                  {captions && (photo.caption ? <figcaption>{photo.caption}</figcaption> : null)}
                </figure>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>,
    document.body,
  );
}
