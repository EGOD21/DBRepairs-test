import { PointerEvent, useEffect, useRef, useState } from "react";
import { useI18n } from "../i18n/I18nProvider";

/** Sign with a finger, stylus or mouse. Reports a PNG data URL, or "" when cleared. */
export default function SignaturePad({ onChange, height = 180 }: { onChange: (dataUrl: string) => void; height?: number }) {
  const { t } = useI18n();
  const canvas = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const last = useRef<{ x: number; y: number } | null>(null);
  const [empty, setEmpty] = useState(true);

  // Sharp lines on high-density screens: draw at device pixels, show at CSS pixels.
  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    const ratio = window.devicePixelRatio || 1;
    element.width = element.offsetWidth * ratio;
    element.height = height * ratio;
    const context = element.getContext("2d");
    if (!context) return;
    context.scale(ratio, ratio);
    context.fillStyle = "#fff";
    context.fillRect(0, 0, element.width, element.height);
    context.lineWidth = 2.2;
    context.lineCap = "round";
    context.lineJoin = "round";
    context.strokeStyle = "#111";
  }, [height]);

  const point = (event: PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  function down(event: PointerEvent<HTMLCanvasElement>) {
    event.currentTarget.setPointerCapture(event.pointerId);
    drawing.current = true;
    last.current = point(event);
    const context = event.currentTarget.getContext("2d");
    context?.beginPath();
    context?.arc(last.current.x, last.current.y, 1.1, 0, Math.PI * 2);
    context?.fill();
  }

  function move(event: PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current || !last.current) return;
    const context = event.currentTarget.getContext("2d");
    if (!context) return;
    const next = point(event);
    context.beginPath();
    context.moveTo(last.current.x, last.current.y);
    context.lineTo(next.x, next.y);
    context.stroke();
    last.current = next;
    if (empty) setEmpty(false);
  }

  function up() {
    if (!drawing.current) return;
    drawing.current = false;
    last.current = null;
    if (canvas.current) { setEmpty(false); onChange(canvas.current.toDataURL("image/png")); }
  }

  function clear() {
    const element = canvas.current;
    const context = element?.getContext("2d");
    if (!element || !context) return;
    context.save();
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.fillStyle = "#fff";
    context.fillRect(0, 0, element.width, element.height);
    context.restore();
    context.fillStyle = "#111";
    setEmpty(true);
    onChange("");
  }

  return (
    <div className="signature-pad">
      <canvas ref={canvas} style={{ height }} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} aria-label={t("signature.area")} />
      <div className="signature-pad-foot">
        <span className="muted">{empty ? t("signature.hint") : "✓"}</span>
        <button type="button" className="btn btn-sm btn-ghost" onClick={clear}>{t("signature.clear")}</button>
      </div>
    </div>
  );
}
