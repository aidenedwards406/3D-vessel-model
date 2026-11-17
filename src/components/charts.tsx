/**
 * SVG charts. Colours are passed in explicitly so the same components render
 * on screen (current theme) and in exports (light, print-ready).
 */
import { useState, type ReactNode } from 'react';
import { niceCeil, niceTicks } from '../lib/colormaps';
import { describe, quantile, stars, formatP, type Descriptives } from '../lib/stats/tests';
import { qt } from '../lib/stats/distributions';
import type { ChromeColors } from './RegionMap';

export interface GroupSeries {
  id: string;
  name: string;
  color: string;
  values: number[];
}

export type ErrorBar = 'sd' | 'sem' | 'ci';

const FONT = 'system-ui, -apple-system, Segoe UI, sans-serif';

export function errorHalfWidth(d: Descriptives, kind: ErrorBar): number {
  if (d.n < 2) return 0;
  if (kind === 'sd') return d.sd;
  if (kind === 'sem') return d.sem;
  return qt(0.975, d.n - 1) * d.sem;
}

export function errorLabel(kind: ErrorBar) {
  return kind === 'sd' ? '± SD' : kind === 'sem' ? '± SEM' : '95% CI';
}

function jitter(i: number, width: number) {
  const x = Math.sin(i * 12.9898 + 78.233) * 43758.5453;
  return (x - Math.floor(x) - 0.5) * width;
}

function wrapLabel(s: string, max = 14): string[] {
  const words = s.split(/\s+/);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    if ((cur + ' ' + w).trim().length > max && cur) {
      lines.push(cur);
      cur = w;
    } else cur = (cur + ' ' + w).trim();
  }
  if (cur) lines.push(cur);
  return lines.slice(0, 3);
}

interface Tip {
  x: number;
  y: number;
  content: ReactNode;
}

function ChartTip({ tip, colors }: { tip: Tip | null; colors: ChromeColors }) {
  if (!tip) return null;
  return (
    <div
      className="pointer-events-none absolute z-10 rounded-lg border px-2.5 py-1.5 text-[12px] shadow-lg"
      style={{ left: tip.x + 12, top: tip.y + 12, background: colors.surface, borderColor: colors.grid, color: colors.ink }}
    >
      {tip.content}
    </div>
  );
}

function YAxis({ ticks, y, left, right, colors, label, top, bottom }: { ticks: number[]; y: (v: number) => number; left: number; right: number; colors: ChromeColors; label: string; top: number; bottom: number }) {
  return (
    <g>
      {ticks.map((t) => (
        <g key={t}>
          <line x1={left} x2={right} y1={y(t)} y2={y(t)} stroke={colors.grid} strokeWidth={1} />
          <text x={left - 8} y={y(t) + 4} fontSize={11} textAnchor="end" fill={colors.muted} style={{ fontVariantNumeric: 'tabular-nums' }}>
            {+t.toFixed(2)}
          </text>
        </g>
      ))}
      <text x={14} y={(top + bottom) / 2} fontSize={11.5} fill={colors.ink2} textAnchor="middle" transform={`rotate(-90 14 ${(top + bottom) / 2})`}>
        {label}
      </text>
    </g>
  );
}

/** Mean ± error bar per group with every observation as a dot. */
export function GroupDotChart({
  groups,
  width,
  height = 300,
  colors,
  errorBar = 'sd',
  yLabel = 'Damage (%)',
  title,
  pointLabel = 'value',
  interactive = true,
}: {
  groups: GroupSeries[];
  width: number;
  height?: number;
  colors: ChromeColors;
  errorBar?: ErrorBar;
  yLabel?: string;
  title?: string;
  pointLabel?: string;
  interactive?: boolean;
}) {
  const [tip, setTip] = useState<Tip | null>(null);
  const top = title ? 34 : 14;
  const left = 56;
  const right = width - 12;
  const bottom = height - 46;
  const stats = groups.map((g) => describe(g.values));
  let max = 0;
  groups.forEach((g, i) => {
    for (const v of g.values) max = Math.max(max, v);
    const d = stats[i];
    if (d.n) max = Math.max(max, d.mean + errorHalfWidth(d, errorBar));
  });
  const yMax = niceCeil(max || 1);
  const y = (v: number) => bottom - (v / yMax) * (bottom - top);
  const band = (right - left) / Math.max(1, groups.length);
  const ticks = niceTicks(0, yMax, 6);
  return (
    <div className="relative" style={{ width }}>
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} fontFamily={FONT} role="img" aria-label={title ?? 'Damage by treatment group'}>
        {title && (
          <text x={0} y={16} fontSize={13.5} fontWeight={600} fill={colors.ink}>
            {title}
          </text>
        )}
        <YAxis ticks={ticks} y={y} left={left} right={right} colors={colors} label={yLabel} top={top} bottom={bottom} />
        <line x1={left} x2={right} y1={bottom} y2={bottom} stroke={colors.axis} strokeWidth={1} />
        {groups.map((g, i) => {
          const cx = left + band * (i + 0.5);
          const d = stats[i];
          const e = errorHalfWidth(d, errorBar);
          const spread = Math.min(46, band * 0.42);
          return (
            <g key={g.id}>
              {g.values.map((v, j) => (
                <circle key={j} cx={cx + jitter(j + i * 997, spread)} cy={y(v)} r={3.4} fill={g.color} fillOpacity={0.55} stroke={colors.surface} strokeWidth={1} />
              ))}
              {d.n > 0 && (
                <>
                  {d.n > 1 && (
                    <g stroke={colors.ink} strokeWidth={1.5}>
                      <line x1={cx} x2={cx} y1={y(Math.max(0, d.mean - e))} y2={y(d.mean + e)} />
                      <line x1={cx - 7} x2={cx + 7} y1={y(d.mean + e)} y2={y(d.mean + e)} />
                      <line x1={cx - 7} x2={cx + 7} y1={y(Math.max(0, d.mean - e))} y2={y(Math.max(0, d.mean - e))} />
                    </g>
                  )}
                  <line x1={cx - 18} x2={cx + 18} y1={y(d.mean)} y2={y(d.mean)} stroke={colors.ink} strokeWidth={3} strokeLinecap="round" />
                </>
              )}
              {wrapLabel(g.name).map((line, k) => (
                <text key={k} x={cx} y={bottom + 17 + k * 13} fontSize={11.5} textAnchor="middle" fill={colors.ink2}>
                  {line}
                </text>
              ))}
              {interactive && (
                <rect
                  x={cx - band / 2}
                  y={top}
                  width={band}
                  height={bottom - top}
                  fill="transparent"
                  onMouseMove={(ev) => {
                    const r = (ev.currentTarget.ownerSVGElement as SVGSVGElement).getBoundingClientRect();
                    setTip({
                      x: ev.clientX - r.left,
                      y: ev.clientY - r.top,
                      content: (
                        <div>
                          <div className="font-semibold">{d.n ? `${d.mean.toFixed(2)}%` : '–'}</div>
                          <div style={{ color: colors.ink2 }}>
                            {g.name} · mean{d.n > 1 ? ` ${errorLabel(errorBar)} ${e.toFixed(2)}` : ''} · n = {d.n} {pointLabel}
                            {d.n === 1 ? '' : 's'}
                          </div>
                        </div>
                      ),
                    });
                  }}
                  onMouseLeave={() => setTip(null)}
                />
              )}
            </g>
          );
        })}
      </svg>
      {interactive && <ChartTip tip={tip} colors={colors} />}
    </div>
  );
}

/** Box plots (median, quartiles, 1.5×IQR whiskers) with significance brackets. */
export function BoxPlotChart({
  groups,
  width,
  height = 340,
  colors,
  pairs = [],
  alpha = 0.05,
  yLabel = 'Damage (%)',
  title,
  showPoints = true,
  interactive = true,
}: {
  groups: GroupSeries[];
  width: number;
  height?: number;
  colors: ChromeColors;
  pairs?: { a: number; b: number; p: number }[];
  alpha?: number;
  yLabel?: string;
  title?: string;
  showPoints?: boolean;
  interactive?: boolean;
}) {
  const [tip, setTip] = useState<Tip | null>(null);
  const sig = pairs.filter((p) => p.p < alpha).sort((a, b) => Math.abs(a.b - a.a) - Math.abs(b.b - b.a));
  // Stack brackets so they never overlap.
  const levels: { a: number; b: number }[][] = [];
  const placed = sig.map((p) => {
    const lo = Math.min(p.a, p.b);
    const hi = Math.max(p.a, p.b);
    let lv = 0;
    while (levels[lv]?.some((q) => !(hi < q.a || lo > q.b))) lv++;
    (levels[lv] ??= []).push({ a: lo, b: hi });
    return { ...p, lo, hi, lv };
  });
  const nLevels = levels.length;
  const top = (title ? 34 : 14) + nLevels * 22;
  const left = 56;
  const right = width - 12;
  const bottom = height - 46;
  let max = 0;
  for (const g of groups) for (const v of g.values) max = Math.max(max, v);
  const yMax = niceCeil(max || 1);
  const y = (v: number) => bottom - (v / yMax) * (bottom - top);
  const band = (right - left) / Math.max(1, groups.length);
  const ticks = niceTicks(0, yMax, 6);
  const boxW = Math.min(52, band * 0.42);
  const xOf = (i: number) => left + band * (i + 0.5);
  return (
    <div className="relative" style={{ width }}>
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} fontFamily={FONT} role="img" aria-label={title ?? 'Box plot of damage by treatment'}>
        {title && (
          <text x={0} y={16} fontSize={13.5} fontWeight={600} fill={colors.ink}>
            {title}
          </text>
        )}
        <YAxis ticks={ticks} y={y} left={left} right={right} colors={colors} label={yLabel} top={top} bottom={bottom} />
        <line x1={left} x2={right} y1={bottom} y2={bottom} stroke={colors.axis} strokeWidth={1} />
        {groups.map((g, i) => {
          const s = [...g.values].sort((a, b) => a - b);
          if (!s.length) return null;
          const q1 = quantile(s, 0.25);
          const q3 = quantile(s, 0.75);
          const med = quantile(s, 0.5);
          const iqr = q3 - q1;
          const lo = s.find((v) => v >= q1 - 1.5 * iqr) ?? s[0];
          const hi = [...s].reverse().find((v) => v <= q3 + 1.5 * iqr) ?? s[s.length - 1];
          const mean = s.reduce((a, b) => a + b, 0) / s.length;
          const cx = xOf(i);
          const outliers = s.filter((v) => v < lo || v > hi);
          return (
            <g key={g.id}>
              <line x1={cx} x2={cx} y1={y(hi)} y2={y(q3)} stroke={colors.ink2} strokeWidth={1.25} />
              <line x1={cx} x2={cx} y1={y(q1)} y2={y(lo)} stroke={colors.ink2} strokeWidth={1.25} />
              <line x1={cx - boxW / 4} x2={cx + boxW / 4} y1={y(hi)} y2={y(hi)} stroke={colors.ink2} strokeWidth={1.25} />
              <line x1={cx - boxW / 4} x2={cx + boxW / 4} y1={y(lo)} y2={y(lo)} stroke={colors.ink2} strokeWidth={1.25} />
              <rect x={cx - boxW / 2} y={y(q3)} width={boxW} height={Math.max(1, y(q1) - y(q3))} rx={4} fill={g.color} fillOpacity={0.16} stroke={g.color} strokeWidth={1.75} />
              {showPoints &&
                g.values.map((v, j) => (
                  <circle key={j} cx={cx + jitter(j + i * 131, boxW * 0.8)} cy={y(v)} r={2.4} fill={g.color} fillOpacity={0.5} />
                ))}
              <line x1={cx - boxW / 2} x2={cx + boxW / 2} y1={y(med)} y2={y(med)} stroke={colors.ink} strokeWidth={2.25} />
              <path d={`M ${cx} ${y(mean) - 5} L ${cx + 5} ${y(mean)} L ${cx} ${y(mean) + 5} L ${cx - 5} ${y(mean)} Z`} fill={colors.surface} stroke={colors.ink} strokeWidth={1.4} />
              {outliers.map((v, j) => (
                <circle key={`o${j}`} cx={cx} cy={y(v)} r={3} fill="none" stroke={colors.ink2} strokeWidth={1.2} />
              ))}
              {wrapLabel(g.name).map((line, k) => (
                <text key={k} x={cx} y={bottom + 17 + k * 13} fontSize={11.5} textAnchor="middle" fill={colors.ink2}>
                  {line}
                </text>
              ))}
              {interactive && (
                <rect
                  x={cx - band / 2}
                  y={top}
                  width={band}
                  height={bottom - top}
                  fill="transparent"
                  onMouseMove={(ev) => {
                    const r = (ev.currentTarget.ownerSVGElement as SVGSVGElement).getBoundingClientRect();
                    setTip({
                      x: ev.clientX - r.left,
                      y: ev.clientY - r.top,
                      content: (
                        <div>
                          <div className="font-semibold">Median {med.toFixed(2)}%</div>
                          <div style={{ color: colors.ink2 }}>
                            {g.name} · IQR {q1.toFixed(2)}–{q3.toFixed(2)} · mean {mean.toFixed(2)} · n = {s.length}
                          </div>
                        </div>
                      ),
                    });
                  }}
                  onMouseLeave={() => setTip(null)}
                />
              )}
            </g>
          );
        })}
        {placed.map((p, i) => {
          const yy = top - 10 - p.lv * 22;
          const x1 = xOf(p.lo);
          const x2 = xOf(p.hi);
          return (
            <g key={i}>
              <path d={`M ${x1} ${yy + 6} L ${x1} ${yy} L ${x2} ${yy} L ${x2} ${yy + 6}`} fill="none" stroke={colors.ink2} strokeWidth={1.2} />
              <text x={(x1 + x2) / 2} y={yy - 3} fontSize={12} fontWeight={700} textAnchor="middle" fill={colors.ink}>
                {stars(p.p)}
                <title>{`p = ${formatP(p.p)}`}</title>
              </text>
            </g>
          );
        })}
      </svg>
      {interactive && <ChartTip tip={tip} colors={colors} />}
    </div>
  );
}

export interface BreakdownSeries {
  id: string;
  name: string;
  color: string;
  stats: (Descriptives | null)[];
}

/** Mean per category (section, side or position) for each treatment. */
export function BreakdownChart({
  categories,
  series,
  width,
  height = 260,
  colors,
  errorBar = 'sem',
  yLabel = 'Damage (%)',
  title,
  connect = false,
  interactive = true,
}: {
  categories: string[];
  series: BreakdownSeries[];
  width: number;
  height?: number;
  colors: ChromeColors;
  errorBar?: ErrorBar;
  yLabel?: string;
  title?: string;
  connect?: boolean;
  interactive?: boolean;
}) {
  const [tip, setTip] = useState<Tip | null>(null);
  // Legend items wrap onto as many rows as needed.
  const legendItems: { s: BreakdownSeries; x: number; row: number }[] = [];
  if (series.length > 1) {
    let x = 0;
    let row = 0;
    for (const s of series) {
      const w = 22 + s.name.length * 6.3 + 12;
      if (x > 0 && x + w > width) {
        x = 0;
        row++;
      }
      legendItems.push({ s, x, row });
      x += w;
    }
  }
  const legendRows = legendItems.length ? legendItems[legendItems.length - 1].row + 1 : 0;
  const legendH = legendRows * 18;
  const top = (title ? 30 : 10) + legendH + 10;
  const left = 56;
  const right = width - 12;
  const bottom = height - 30;
  let max = 0;
  for (const s of series)
    for (const d of s.stats) if (d && d.n) max = Math.max(max, d.mean + errorHalfWidth(d, errorBar));
  const yMax = niceCeil(max || 1);
  const y = (v: number) => bottom - (Math.max(0, v) / yMax) * (bottom - top);
  const band = (right - left) / Math.max(1, categories.length);
  const dodge = Math.min(14, (band * 0.6) / Math.max(1, series.length));
  const xOf = (c: number, si: number) => left + band * (c + 0.5) + (si - (series.length - 1) / 2) * dodge;
  const ticks = niceTicks(0, yMax, 5);
  return (
    <div className="relative" style={{ width }}>
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} fontFamily={FONT} role="img" aria-label={title ?? 'Damage breakdown'}>
        {title && (
          <text x={0} y={16} fontSize={13} fontWeight={600} fill={colors.ink}>
            {title}
          </text>
        )}
        {legendItems.map(({ s, x, row }) => (
          <g key={s.id} transform={`translate(${x}, ${(title ? 30 : 10) + 2 + row * 18})`}>
            <circle cx={6} cy={6} r={4.5} fill={s.color} />
            <text x={16} y={10} fontSize={11.5} fill={colors.ink2}>
              {s.name}
            </text>
          </g>
        ))}
        <YAxis ticks={ticks} y={y} left={left} right={right} colors={colors} label={yLabel} top={top} bottom={bottom} />
        <line x1={left} x2={right} y1={bottom} y2={bottom} stroke={colors.axis} strokeWidth={1} />
        {categories.map((c, i) => (
          <text key={c} x={left + band * (i + 0.5)} y={bottom + 18} fontSize={11.5} textAnchor="middle" fill={colors.ink2}>
            {c}
          </text>
        ))}
        {series.map((s, si) => {
          const pts = s.stats.map((d, ci) => (d && d.n ? { x: xOf(ci, si), y: y(d.mean), d, ci } : null));
          return (
            <g key={s.id}>
              {connect && (
                <polyline
                  points={pts
                    .filter((p): p is NonNullable<typeof p> => !!p)
                    .map((p) => `${p.x},${p.y}`)
                    .join(' ')}
                  fill="none"
                  stroke={s.color}
                  strokeWidth={2}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
              )}
              {pts.map((p) => {
                if (!p) return null;
                const e = errorHalfWidth(p.d, errorBar);
                return (
                  <g key={p.ci}>
                    {p.d.n > 1 && (
                      <line x1={p.x} x2={p.x} y1={y(p.d.mean - e)} y2={y(p.d.mean + e)} stroke={s.color} strokeWidth={1.5} />
                    )}
                    <circle cx={p.x} cy={p.y} r={4.5} fill={s.color} stroke={colors.surface} strokeWidth={2} />
                    {interactive && (
                      <circle
                        cx={p.x}
                        cy={p.y}
                        r={12}
                        fill="transparent"
                        onMouseMove={(ev) => {
                          const r = (ev.currentTarget.ownerSVGElement as SVGSVGElement).getBoundingClientRect();
                          setTip({
                            x: ev.clientX - r.left,
                            y: ev.clientY - r.top,
                            content: (
                              <div>
                                <div className="font-semibold">{p.d.mean.toFixed(2)}%</div>
                                <div style={{ color: colors.ink2 }}>
                                  {s.name} · {categories[p.ci]} · n = {p.d.n}
                                  {p.d.n > 1 ? ` · ${errorLabel(errorBar)} ${e.toFixed(2)}` : ''}
                                </div>
                              </div>
                            ),
                          });
                        }}
                        onMouseLeave={() => setTip(null)}
                      />
                    )}
                  </g>
                );
              })}
            </g>
          );
        })}
      </svg>
      {interactive && <ChartTip tip={tip} colors={colors} />}
    </div>
  );
}
