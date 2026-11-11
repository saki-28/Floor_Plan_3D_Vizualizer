/**
 * The Results page's charts, drawn as plain SVG at the size they are shown, so text stays at its
 * real size. Rules are amber and the trained model blue (--series-rules, --series-model; both
 * checked for colour-blind separation in light and dark). Every chart has a hover read-out; bars
 * carry their values as labels and series are named in a legend, so no figure depends on colour.
 * Single plans are only read out on hover: the page shows summaries, not all 400 plans.
 */

import React, { useEffect, useRef, useState } from 'react';

export const SERIES = {
  rules: { label: 'Rules', color: 'var(--series-rules)' },
  model: { label: 'Trained model', color: 'var(--series-model)' },
} as const;
export type SeriesKey = keyof typeof SERIES;

export const pct = (value: number, digits = 1) => `${(value * 100).toFixed(digits)}%`;

/** The width the element is laid out at, kept up to date. */
function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.floor(entry.contentRect.width)));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, width];
}

interface TipState {
  x: number;
  y: number;
  rows: { key?: SeriesKey; value: string; label: string }[];
  title?: string;
}

/** The hover read-out: values first and strong, names after; a short line keys each series. */
const Tooltip: React.FC<{ tip: TipState | null; width: number }> = ({ tip, width }) => {
  if (!tip) return null;
  const left = Math.min(Math.max(tip.x + 12, 0), Math.max(0, width - 220));
  return (
    <div
      role="status"
      className="pointer-events-none absolute z-10 w-max max-w-[220px] rounded-md border border-line bg-surface px-3 py-2 text-xs shadow-sm"
      style={{ left, top: Math.max(0, tip.y - 12) }}
    >
      {tip.title && <div className="mb-1 truncate text-muted">{tip.title}</div>}
      {tip.rows.map((row) => (
        <div key={row.label} className="flex items-center gap-2">
          {row.key && <span className="inline-block h-0.5 w-3 rounded-full" style={{ background: SERIES[row.key].color }} />}
          <span className="num font-semibold text-ink">{row.value}</span>
          <span className="text-muted">{row.label}</span>
        </div>
      ))}
    </div>
  );
};

/** The key for charts with both series: a rect per series, as the marks are bars or dots. */
export const Legend: React.FC<{ keys?: SeriesKey[] }> = ({ keys = ['rules', 'model'] }) => (
  <div className="flex flex-wrap gap-4 text-xs text-muted">
    {keys.map((key) => (
      <span key={key} className="flex items-center gap-1.5">
        <span className="inline-block h-2.5 w-2.5 rounded-[3px]" style={{ background: SERIES[key].color }} />
        {SERIES[key].label}
      </span>
    ))}
  </div>
);

/** A bar from x0 to x1 with only its data end rounded (4px), square at the baseline. */
function barPath(x0: number, x1: number, y: number, h: number): string {
  const r = Math.min(4, (x1 - x0) / 2, h / 2);
  if (x1 - x0 <= 0) return '';
  return `M${x0},${y}H${x1 - r}A${r},${r} 0 0 1 ${x1},${y + r}V${y + h - r}A${r},${r} 0 0 1 ${x1 - r},${y + h}H${x0}Z`;
}

export interface BarGroup {
  label: string;
  note?: string;
  values: Partial<Record<SeriesKey, number | null>>;
}

/**
 * Horizontal grouped bars on a 0–100% scale: one row per group, one 12px bar per series, the value
 * at each bar's tip. A missing value (the rules find no doors) is said in words, not drawn as zero.
 */
export const GroupedBars: React.FC<{ groups: BarGroup[]; label: string; max?: number; missingText?: string }> = ({
  groups,
  label,
  max = 1,
  missingText = 'not measured',
}) => {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [tip, setTip] = useState<TipState | null>(null);
  const keys: SeriesKey[] = ['rules', 'model'];
  const bar = 12;
  const gap = 2;
  const labelHeight = 22;
  const rowHeight = labelHeight + keys.length * bar + (keys.length - 1) * gap + 18;
  const valueRoom = 52;
  const plotWidth = Math.max(0, width - valueRoom);
  const x = (v: number) => (v / max) * plotWidth;
  const height = groups.length * rowHeight + 18;
  // Round tick steps: 5% on a short scale, 25% on the full one.
  const tickStep = max <= 0.3 ? 0.05 : 0.25;
  const ticks = Array.from({ length: Math.round(max / tickStep) + 1 }, (_, i) => i * tickStep);

  return (
    <div ref={ref} className="relative" onPointerLeave={() => setTip(null)}>
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label={label} className="block overflow-visible">
          {ticks.map((t) => (
            <g key={t}>
              <line x1={x(t)} x2={x(t)} y1={0} y2={height - 18} stroke="var(--border)" strokeWidth={1} />
              <text x={x(t)} y={height - 4} textAnchor={t === 0 ? 'start' : 'middle'} className="num fill-[var(--muted)] text-[11px]">
                {pct(t, 0)}
              </text>
            </g>
          ))}
          {groups.map((group, g) => {
            const top = g * rowHeight;
            return (
              <g key={group.label}>
                <text x={0} y={top + 15} className="fill-[var(--text)] text-[13px]">
                  {group.label}
                  {group.note && (
                    <tspan dx={8} className="fill-[var(--muted)] text-[12px]">
                      {group.note}
                    </tspan>
                  )}
                </text>
                {keys.map((key, k) => {
                  const value = group.values[key];
                  const y = top + labelHeight + k * (bar + gap);
                  const show = (e: React.PointerEvent | React.FocusEvent) => {
                    const box = ref.current?.getBoundingClientRect();
                    const px = 'clientX' in e && box ? e.clientX - box.left : x(value ?? 0);
                    setTip({ x: px, y, title: group.label, rows: [{ key, value: value == null ? '–' : pct(value), label: SERIES[key].label }] });
                  };
                  return (
                    <g key={key} tabIndex={0} onPointerMove={show} onFocus={show} onBlur={() => setTip(null)} className="outline-none">
                      <rect x={0} y={y - 1} width={Math.max(plotWidth, 1)} height={bar + 2} fill="transparent" />
                      {value != null ? (
                        <>
                          <path d={barPath(0, Math.max(x(value), 2), y, bar)} fill={SERIES[key].color} />
                          <text x={x(value) + 6} y={y + bar - 2} className="num fill-[var(--text)] text-[12px]">
                            {pct(value)}
                          </text>
                        </>
                      ) : (
                        <text x={0} y={y + bar - 2} className="fill-[var(--muted)] text-[12px]">
                          {SERIES[key].label}: {missingText}
                        </text>
                      )}
                    </g>
                  );
                })}
              </g>
            );
          })}
        </svg>
      )}
      <Tooltip tip={tip} width={width} />
    </div>
  );
};

export interface PlanPoint {
  plan: string;
  /** How the plan is named in the read-out. */
  label: string;
  rules: number;
  model: number;
}

/**
 * One dot per test plan: the rules' score across, the model's up. Above the diagonal the model did
 * better. The pointer picks the nearest dot, so no one has to land on an 8px mark.
 */
export const PlanScatter: React.FC<{ points: PlanPoint[]; label: string }> = ({ points, label }) => {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const side = Math.min(width, 460);
  const left = 40;
  const bottom = 34;
  const top = 8;
  // Room for the last x tick's label, which is centred on the plot's right edge.
  const right = 20;
  const plot = Math.max(0, side - left - right);
  const height = plot + top + bottom;
  const sx = (v: number) => left + v * plot;
  const sy = (v: number) => top + (1 - v) * plot;
  const ticks = [0, 0.25, 0.5, 0.75, 1];

  const pick = (e: React.PointerEvent<SVGSVGElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - box.left;
    const py = e.clientY - box.top;
    let best = -1;
    let bestDistance = 24 * 24;
    points.forEach((p, i) => {
      const d = (sx(p.rules) - px) ** 2 + (sy(p.model) - py) ** 2;
      if (d < bestDistance) {
        bestDistance = d;
        best = i;
      }
    });
    setHover(best >= 0 ? best : null);
  };
  const hovered = hover !== null ? points[hover] : null;

  return (
    <div ref={ref} className="relative">
      {plot > 0 && (
        <svg width={side} height={height} role="img" aria-label={label} onPointerMove={pick} onPointerLeave={() => setHover(null)} className="block touch-none">
          {ticks.map((t) => (
            <g key={t}>
              <line x1={sx(t)} x2={sx(t)} y1={top} y2={top + plot} stroke="var(--border)" strokeWidth={1} />
              <line x1={left} x2={left + plot} y1={sy(t)} y2={sy(t)} stroke="var(--border)" strokeWidth={1} />
              <text x={sx(t)} y={top + plot + 16} textAnchor="middle" className="num fill-[var(--muted)] text-[11px]">
                {pct(t, 0)}
              </text>
              <text x={left - 6} y={sy(t) + 4} textAnchor="end" className="num fill-[var(--muted)] text-[11px]">
                {pct(t, 0)}
              </text>
            </g>
          ))}
          <line x1={sx(0)} y1={sy(0)} x2={sx(1)} y2={sy(1)} stroke="var(--muted)" strokeWidth={1} />
          <text x={sx(0.04)} y={sy(0.93)} className="fill-[var(--muted)] text-[12px]">
            Model better
          </text>
          <text x={sx(0.96)} y={sy(0.06)} textAnchor="end" className="fill-[var(--muted)] text-[12px]">
            Rules better
          </text>
          {points.map((p, i) => (
            <circle key={p.plan} cx={sx(p.rules)} cy={sy(p.model)} r={4} fill={SERIES.model.color} fillOpacity={hover === i ? 1 : 0.55} stroke="var(--surface)" strokeWidth={1} />
          ))}
          {hovered && <circle cx={sx(hovered.rules)} cy={sy(hovered.model)} r={6} fill={SERIES.model.color} stroke="var(--surface)" strokeWidth={2} />}
          <text x={left + plot / 2} y={height - 2} textAnchor="middle" className="fill-[var(--muted)] text-[12px]">
            Rules, wall IoU
          </text>
          <text transform={`translate(11 ${top + plot / 2}) rotate(-90)`} textAnchor="middle" className="fill-[var(--muted)] text-[12px]">
            Trained model, wall IoU
          </text>
        </svg>
      )}
      <Tooltip
        width={side}
        tip={
          hovered
            ? {
                x: sx(hovered.rules),
                y: sy(hovered.model),
                title: hovered.label,
                rows: [
                  { key: 'model', value: pct(hovered.model), label: SERIES.model.label },
                  { key: 'rules', value: pct(hovered.rules), label: SERIES.rules.label },
                ],
              }
            : null
        }
      />
    </div>
  );
};

export interface CurvePoint {
  step: number;
  wallIoU: number;
  openingsIoU: number;
}

/**
 * The model's wall IoU on the validation plans as training went on (one series, so no legend: the
 * heading names it). A crosshair snaps to the nearest check; the kept checkpoint is labelled.
 */
export const TrainingCurve: React.FC<{ points: CurvePoint[]; kept: number; label: string }> = ({ points, kept, label }) => {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const left = 40;
  const right = 16;
  const top = 12;
  const bottom = 34;
  const height = 220;
  const plotW = Math.max(0, width - left - right);
  const plotH = height - top - bottom;
  const maxStep = Math.max(...points.map((p) => p.step));
  const yMin = 0.5;
  const yMax = 0.8;
  const sx = (step: number) => left + (step / maxStep) * plotW;
  const sy = (v: number) => top + (1 - (v - yMin) / (yMax - yMin)) * plotH;
  const yTicks = [0.5, 0.6, 0.7, 0.8];
  const tickStep = maxStep > 25000 ? 10000 : 5000;
  const xTicks = Array.from({ length: Math.floor(maxStep / tickStep) + 1 }, (_, i) => i * tickStep);
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${sx(p.step)},${sy(p.wallIoU)}`).join('');
  const keptPoint = points.find((p) => p.step === kept);

  const pick = (e: React.PointerEvent<SVGSVGElement>) => {
    const px = e.clientX - e.currentTarget.getBoundingClientRect().left;
    let best = 0;
    points.forEach((p, i) => {
      if (Math.abs(sx(p.step) - px) < Math.abs(sx(points[best].step) - px)) best = i;
    });
    setHover(best);
  };
  const hovered = hover !== null ? points[hover] : null;

  return (
    <div ref={ref} className="relative">
      {plotW > 0 && (
        <svg width={width} height={height} role="img" aria-label={label} onPointerMove={pick} onPointerLeave={() => setHover(null)} className="block touch-none">
          {yTicks.map((t) => (
            <g key={t}>
              <line x1={left} x2={left + plotW} y1={sy(t)} y2={sy(t)} stroke="var(--border)" strokeWidth={1} />
              <text x={left - 6} y={sy(t) + 4} textAnchor="end" className="num fill-[var(--muted)] text-[11px]">
                {pct(t, 0)}
              </text>
            </g>
          ))}
          {xTicks.map((t) => (
            <text key={t} x={sx(t)} y={top + plotH + 16} textAnchor={t === 0 ? 'start' : 'middle'} className="num fill-[var(--muted)] text-[11px]">
              {t.toLocaleString('en')}
            </text>
          ))}
          <text x={left + plotW / 2} y={height - 2} textAnchor="middle" className="fill-[var(--muted)] text-[12px]">
            Training step
          </text>
          {hovered && <line x1={sx(hovered.step)} x2={sx(hovered.step)} y1={top} y2={top + plotH} stroke="var(--muted)" strokeWidth={1} />}
          <path d={path} fill="none" stroke={SERIES.model.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          {points.map((p) => (
            <circle key={p.step} cx={sx(p.step)} cy={sy(p.wallIoU)} r={p.step === kept ? 5 : 4} fill={SERIES.model.color} stroke="var(--surface)" strokeWidth={2} />
          ))}
          {keptPoint && (
            <text x={sx(keptPoint.step) - 8} y={sy(keptPoint.wallIoU) - 12} textAnchor="end" className="num fill-[var(--text)] text-[12px]">
              Kept: step {keptPoint.step.toLocaleString('en')}, {pct(keptPoint.wallIoU)}
            </text>
          )}
        </svg>
      )}
      <Tooltip
        width={width}
        tip={
          hovered
            ? {
                x: sx(hovered.step),
                y: sy(hovered.wallIoU),
                title: `Step ${hovered.step.toLocaleString('en')}`,
                rows: [
                  { key: 'model', value: pct(hovered.wallIoU), label: 'walls' },
                  { value: pct(hovered.openingsIoU), label: 'doors and windows' },
                ],
              }
            : null
        }
      />
    </div>
  );
};
