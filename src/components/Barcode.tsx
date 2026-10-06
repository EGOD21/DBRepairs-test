import { code128Widths } from "../lib/code128";

/** Code 128 barcode as SVG. It scales to its box, so it prints sharply at any size. */
export default function Barcode({ value, className = "barcode" }: { value: string; className?: string }) {
  let widths: number[];
  try {
    widths = code128Widths(value);
  } catch {
    return null;
  }
  const quiet = 10;
  const total = widths.reduce((sum, width) => sum + width, 0) + quiet * 2;
  let x = quiet;
  const bars: { x: number; width: number }[] = [];
  widths.forEach((width, index) => {
    if (index % 2 === 0) bars.push({ x, width });
    x += width;
  });
  return (
    <svg className={className} viewBox={`0 0 ${total} 40`} preserveAspectRatio="none" role="img" aria-label={value}>
      <rect x={0} y={0} width={total} height={40} fill="#fff" />
      {bars.map((bar) => <rect key={bar.x} x={bar.x} y={0} width={bar.width} height={40} fill="#000" />)}
    </svg>
  );
}
