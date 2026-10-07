import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Icon from "./Icon";
import { decodeCode128Image } from "../lib/scan";
import { useI18n } from "../i18n/I18nProvider";

type Detector = { detect: (source: CanvasImageSource) => Promise<{ rawValue: string }[]> };
type DetectorClass = new (options: { formats: string[] }) => Detector;

/** Opens the camera and reads a barcode (repair labels, stock items, certificates). */
export function ScanModal({ onResult, onClose }: { onResult: (text: string) => void; onClose: () => void }) {
  const { t } = useI18n();
  const video = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let stream: MediaStream | null = null;
    let stopped = false;
    let timer = 0;
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d", { willReadFrequently: true });
    // Android Chrome reads many barcode types natively; elsewhere our own Code 128 reader runs.
    const Native = (window as unknown as { BarcodeDetector?: DetectorClass }).BarcodeDetector;
    const native = Native ? new Native({ formats: ["code_128", "qr_code", "ean_13", "ean_8", "upc_a", "code_39"] }) : null;

    async function tick() {
      if (stopped || !video.current || video.current.readyState < 2) { timer = window.setTimeout(tick, 200); return; }
      const v = video.current;
      try {
        let text: string | null = null;
        if (native) text = (await native.detect(v))[0]?.rawValue ?? null;
        if (!text && context) {
          // Full camera resolution: thin bars need at least ~2 pixels each.
          canvas.width = v.videoWidth;
          canvas.height = v.videoHeight;
          context.drawImage(v, 0, 0);
          const band = Math.round(canvas.height / 3);
          const image = context.getImageData(0, band, canvas.width, band);
          text = decodeCode128Image(image.data, image.width, image.height);
        }
        if (text) { stopped = true; navigator.vibrate?.(60); onResult(text.trim()); return; }
      } catch { /* try the next frame */ }
      timer = window.setTimeout(tick, 150);
    }

    navigator.mediaDevices?.getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false })
      .then((media) => {
        stream = media;
        if (stopped) { media.getTracks().forEach((track) => track.stop()); return; }
        if (video.current) { video.current.srcObject = media; void video.current.play(); }
        timer = window.setTimeout(tick, 300);
      })
      .catch(() => setError(window.isSecureContext ? t("scan.denied") : t("scan.needsHttps")));
    if (!navigator.mediaDevices) setError(t("scan.needsHttps"));
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => {
      stopped = true;
      window.clearTimeout(timer);
      window.removeEventListener("keydown", onKey);
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  return createPortal(
    <div className="scanner" role="dialog" aria-modal="true" aria-label={t("scan.title")}>
      <div className="scanner-bar"><strong>{t("scan.title")}</strong><button type="button" className="btn btn-sm lightbox-btn" onClick={onClose} aria-label={t("common.close")}><Icon name="x" size={16} /></button></div>
      <div className="scanner-stage">
        <video ref={video} playsInline muted />
        <div className="scanner-frame" />
      </div>
      <p className="scanner-hint">{error || t("scan.hint")}</p>
    </div>,
    document.body,
  );
}

export default function ScanButton({ onResult, label }: { onResult: (text: string) => void; label?: string }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="btn btn-icon scan-btn" onClick={() => setOpen(true)} title={label ?? t("scan.title")} aria-label={label ?? t("scan.title")}><Icon name="scan" size={16} /></button>
      {open && <ScanModal onClose={() => setOpen(false)} onResult={(text) => { setOpen(false); onResult(text); }} />}
    </>
  );
}
