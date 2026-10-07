import { ReactNode, useState } from "react";
import { useI18n } from "../i18n/I18nProvider";

export type Series = { name: string; slot: 1 | 2 };
export type Datum = { label: string; values: number[]; href?: string };

type Tooltip = { x: number; y: number; title: string; lines: string[] } | null;

function niceMax(value: number) {
  if (value <= 0) return 1;
  const power = 10 ** Math.floor(Math.log10(value));
  const step = [1, 2, 2.5, 5, 10].find((m) => m * power >= value / 4) ?? 10;
  return Math.ceil(value / (step * power)) * step * power;
}

function Legend({ series }: { series: Series[] }) {
  if (series.length < 2) return null;
  return <div className="viz-legend">{series.map((s) => <span key={s.name}><i className={`viz-swatch s${s.slot}`} />{s.name}</span>)}</div>;
}

function ChartFrame({ title, subtitle, table, children, series }: { title: string; subtitle?: string; table: ReactNode; children: ReactNode; series: Series[] }) {
  const { t } = useI18n();
  const [showTable, setShowTable] = useState(false);
  return (
    <section className="card viz">
      <div className="card-header">
        <div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div>
        <button type="button" className="btn btn-sm btn-ghost" onClick={() => setShowTable((v) => !v)} aria-pressed={showTable}>{showTable ? t("reports.showChart") : t("reports.showTable")}</button>
      </div>
      <div className="card-body">
        <Legend series={series} />
        {showTable ? table : children}
      </div>
    </section>
  );
}

function DataTable({ data, series, format, labelHeader }: { data: Datum[]; series: Series[]; format: (n: number) => string; labelHeader: string }) {
  return (
    <div className="table-wrap"><table className="compact">
      <thead><tr><th>{labelHeader}</th>{series.map((s) => <th key={s.name} className="num">{s.name}</th>)}</tr></thead>
      <tbody>{data.map((d) => <tr key={d.label}><td>{d.label}</td>{d.values.map((v, i) => <td key={i} className="num">{format(v)}</td>)}</tr>)}</tbody>
    </table></div>
  );
}

/** Vertical columns over time (one series, or two stacked). */
export function ColumnChart({ title, subtitle, data, series, format, labelHeader, empty }: {
  title: string; subtitle?: string; data: Datum[]; series: Series[]; format: (n: number) => string; labelHeader: string; empty: string;
}) {
  const [tip, setTip] = useState<Tooltip>(null);
  const width = 640, height = 220, left = 56, bottom = 26, top = 10;
  const totals = data.map((d) => d.values.reduce((a, b) => a + b, 0));
  const max = niceMax(Math.max(0, ...totals));
  const band = (width - left) / Math.max(1, data.length);
  const barWidth = Math.min(24, band * 0.6);
  const y = (v: number) => top + (height - top - bottom) * (1 - v / max);
  const ticks = [0, max / 2, max];
  return (
    <ChartFrame title={title} subtitle={subtitle} series={series} table={<DataTable data={data} series={series} format={format} labelHeader={labelHeader} />}>
      {data.length === 0 ? <p className="muted">{empty}</p> : (
        <div className="viz-plot" onMouseLeave={() => setTip(null)}>
          <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={title}>
            {ticks.map((tick) => <g key={tick}><line className="viz-grid" x1={left} x2={width} y1={y(tick)} y2={y(tick)} /><text className="viz-axis" x={left - 8} y={y(tick) + 4} textAnchor="end">{format(tick)}</text></g>)}
            {data.map((d, i) => {
              const x = left + band * i + (band - barWidth) / 2;
              let base = 0;
              return (
                <g key={d.label}>
                  {d.values.map((v, s) => {
                    if (v <= 0) return null;
                    const y0 = y(base), y1 = y(base + v);
                    base += v;
                    const isTop = d.values.slice(s + 1).every((rest) => rest <= 0);
                    // 2px surface gap between stacked segments; only the top end is rounded.
                    const h = Math.max(1, y0 - y1 - (s > 0 ? 2 : 0));
                    return <path key={s} className={`viz-mark s${series[s]?.slot ?? 1}`} d={roundedTop(x, y1, barWidth, h, isTop ? 4 : 0)} />;
                  })}
                  <rect className="viz-hit" x={left + band * i} y={top} width={band} height={height - top - bottom}
                    onMouseMove={(e) => setTip({ x: e.nativeEvent.offsetX, y: e.nativeEvent.offsetY, title: d.label, lines: d.values.map((v, s) => `${series[s]?.name ?? ""}: ${format(v)}`) })} />
                  {(data.length <= 12 || i % Math.ceil(data.length / 12) === 0) && <text className="viz-axis" x={left + band * i + band / 2} y={height - 8} textAnchor="middle">{d.label}</text>}
                </g>
              );
            })}
          </svg>
          {tip && <div className="viz-tooltip" style={{ left: tip.x + 12, top: tip.y }}><strong>{tip.title}</strong>{tip.lines.map((line) => <span key={line}>{line}</span>)}</div>}
        </div>
      )}
    </ChartFrame>
  );
}

function roundedTop(x: number, y: number, w: number, h: number, r: number) {
  const radius = Math.min(r, w / 2, h);
  return `M${x},${y + h} V${y + radius} Q${x},${y} ${x + radius},${y} H${x + w - radius} Q${x + w},${y} ${x + w},${y + radius} V${y + h} Z`;
}

/** Horizontal bars for categories (one series, or two stacked). Values are labelled at the bar end. */
export function BarList({ title, subtitle, data, series, format, labelHeader, empty }: {
  title: string; subtitle?: string; data: Datum[]; series: Series[]; format: (n: number) => string; labelHeader: string; empty: string;
}) {
  const totals = data.map((d) => d.values.reduce((a, b) => a + b, 0));
  const max = Math.max(0, ...totals) || 1;
  return (
    <ChartFrame title={title} subtitle={subtitle} series={series} table={<DataTable data={data} series={series} format={format} labelHeader={labelHeader} />}>
      {data.length === 0 ? <p className="muted">{empty}</p> : (
        <div className="viz-bars">{data.map((d, i) => (
          <div key={d.label} className="viz-bar-row" title={`${d.label}: ${d.values.map((v, s) => `${series[s]?.name ?? ""} ${format(v)}`).join(" · ")}`}>
            <span className="viz-bar-label">{d.href ? <a href={d.href}>{d.label}</a> : d.label}</span>
            <span className="viz-bar-track">
              {d.values.map((v, s) => v > 0 && <span key={s} className={`viz-bar s${series[s]?.slot ?? 1}${s === d.values.length - 1 || d.values.slice(s + 1).every((r) => r <= 0) ? " end" : ""}`} style={{ width: `${(v / max) * 100}%` }} />)}
              <span className="viz-bar-value">{format(totals[i])}</span>
            </span>
          </div>
        ))}</div>
      )}
    </ChartFrame>
  );
}
