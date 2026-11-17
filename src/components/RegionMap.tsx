import { useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useDark } from './useTheme';
import { ChevronDown, Map as MapIcon } from 'lucide-react';
import { colorForValue, formatPercent, inkOn } from '../lib/colormaps';
import { positionShort, sideLabel, type Side } from '../lib/naming';
import { regionIndex, type Layout } from '../lib/regions';
import type { RegionValues } from '../lib/study';
import { selectLocation } from '../state/actions';
import { assets } from '../state/assets';
import { currentVessel, getScale, targetValues, useLayout, type Scale } from '../state/derived';
import { useStore } from '../state/store';
import { useShallow } from 'zustand/react/shallow';
import { cx } from './ui';

export interface ChromeColors {
  ink: string;
  ink2: string;
  muted: string;
  grid: string;
  axis: string;
  surface: string;
  noData: string;
  hatch: string;
}

export function chromeColors(dark: boolean): ChromeColors {
  return dark
    ? { ink: '#f0efec', ink2: '#c3c2b7', muted: '#9a988f', grid: '#2c2c2a', axis: '#383835', surface: '#1a1a19', noData: '#5d5c57', hatch: '#3e3d3a' }
    : { ink: '#0b0b0b', ink2: '#52514e', muted: '#74726c', grid: '#e1e0d9', axis: '#c3c2b7', surface: '#fcfcfb', noData: '#c9c8c1', hatch: '#a9a8a2' };
}

export interface RegionMapProps {
  values: RegionValues;
  scale: Scale;
  layout: Layout;
  width: number;
  colors: ChromeColors;
  selected?: { section: number; side: Side; position: string } | null;
  onSelect?: (section: number, side: Side, position: string) => void;
  onHover?: (index: number | null) => void;
  showValues?: boolean;
  title?: string;
}

export function RegionMap({ values, scale, layout, width, colors, selected, onSelect, onHover, showValues = true, title }: RegionMapProps) {
  const pid = useId().replace(/:/g, '');
  const [hover, setHover] = useState<number | null>(null);
  const left = 54;
  const right = 8;
  const top = title ? 40 : 22;
  const rowH = 34;
  const gap = 8;
  const totalSlots = layout.positions.reduce((n, p) => n + p.length, 0);
  const cellW = Math.max(8, (width - left - right - gap * (layout.count - 1)) / totalSlots);
  const height = top + rowH * 2 + 2 + 36;
  let x = left;
  const sectionsX: { s: number; x: number; w: number; positions: string[] }[] = [];
  for (let s = 1; s <= layout.count; s++) {
    const positions = layout.positions[s - 1];
    const w = positions.length * cellW;
    sectionsX.push({ s, x, w, positions });
    x += w + gap;
  }
  const svgW = Math.max(width, x - gap + right);
  return (
    <svg width={svgW} height={height} viewBox={`0 0 ${svgW} ${height}`} role="img" aria-label={title ?? 'Region map: damage by section, side and position'} fontFamily="system-ui, -apple-system, Segoe UI, sans-serif">
      <defs>
        <pattern id={`h${pid}`} patternUnits="userSpaceOnUse" width="7" height="7" patternTransform="rotate(45)">
          <rect width="7" height="7" fill={colors.noData} />
          <line x1="0" y1="0" x2="0" y2="7" stroke={colors.hatch} strokeWidth="2.5" />
        </pattern>
      </defs>
      {title && (
        <text x={0} y={16} fontSize={13} fontWeight={600} fill={colors.ink}>
          {title}
        </text>
      )}
      {(['T', 'B'] as Side[]).map((side, r) => (
        <text key={side} x={left - 8} y={top + r * (rowH + 2) + rowH / 2 + 4} fontSize={11.5} textAnchor="end" fill={colors.ink2}>
          {sideLabel(side)}
        </text>
      ))}
      {sectionsX.map(({ s, x: sx, w, positions }) => (
        <g key={s}>
          <text x={sx + w / 2} y={top - 7} fontSize={11.5} fontWeight={600} textAnchor="middle" fill={colors.ink}>
            Section {s}
          </text>
          {(['T', 'B'] as Side[]).map((side, r) =>
            positions.map((pos, slot) => {
              const idx = regionIndex(s, side, slot);
              const v = values.values[idx];
              const has = !Number.isNaN(v);
              const fill = has ? colorForValue(v, scale) : `url(#h${pid})`;
              const cx0 = sx + slot * cellW;
              const cy0 = top + r * (rowH + 2);
              const isSel = selected && selected.section === s && selected.side === side && selected.position === pos;
              const isHover = hover === idx;
              return (
                <g
                  key={`${side}${slot}`}
                  style={{ cursor: onSelect ? 'pointer' : undefined }}
                  onMouseEnter={() => {
                    setHover(idx);
                    onHover?.(idx);
                  }}
                  onMouseLeave={() => {
                    setHover(null);
                    onHover?.(null);
                  }}
                  onClick={() => onSelect?.(s, side, pos)}
                >
                  <title>
                    {`Section ${s} · ${sideLabel(side)} · ${pos}: ${has ? formatPercent(v) : 'no image'}${values.counts[idx] ? ` (${values.counts[idx]})` : ''}`}
                  </title>
                  <rect x={cx0 + 1} y={cy0} width={cellW - 2} height={rowH} rx={3} fill={fill} />
                  {(isSel || isHover) && (
                    <rect x={cx0 + 1} y={cy0} width={cellW - 2} height={rowH} rx={3} fill="none" stroke={colors.ink} strokeWidth={isSel ? 2.5 : 1.5} />
                  )}
                  {showValues && has && cellW >= 30 && (
                    <text x={cx0 + cellW / 2} y={cy0 + rowH / 2 + 4} fontSize={11} fontWeight={600} textAnchor="middle" fill={inkOn(colorForValue(v, scale))} style={{ fontVariantNumeric: 'tabular-nums' }}>
                      {v.toFixed(v >= 10 ? 0 : 1)}
                    </text>
                  )}
                </g>
              );
            }),
          )}
          {positions.map((pos, slot) => (
            <text key={pos} x={sx + slot * cellW + cellW / 2} y={top + 2 * rowH + 2 + 15} fontSize={10.5} textAnchor="middle" fill={colors.muted}>
              {positionShort(pos, positions.filter((p) => p.startsWith('M')).length)}
            </text>
          ))}
        </g>
      ))}
      <text x={left} y={height - 4} fontSize={10.5} fill={colors.muted}>
        Proximal
      </text>
      <text x={x - gap} y={height - 4} fontSize={10.5} textAnchor="end" fill={colors.muted}>
        Distal
      </text>
      <line x1={left + 52} x2={x - gap - 40} y1={height - 8} y2={height - 8} stroke={colors.axis} strokeWidth={1} />
      <path d={`M ${x - gap - 44} ${height - 11} L ${x - gap - 40} ${height - 8} L ${x - gap - 44} ${height - 5}`} fill="none" stroke={colors.axis} />
    </svg>
  );
}

export function RegionMapPanel() {
  const [open, setOpen] = useState(true);
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(600);
  const layout = useLayout();
  const v = useStore(currentVessel);
  const selection = useStore((s) => s.selection);
  const dark = useDark();
  const scale = useStore(useShallow((s) => getScale(s, v ? { kind: 'vessel', key: v.vKey } : undefined)));
  const deps = useStore(useShallow((s) => [s.images, s.damage.rows, s.heat.aggregation, s.sections]));
  const values = useMemo(() => (v ? targetValues(useStore.getState(), { kind: 'vessel', key: v.vKey }) : null), [v, layout, ...deps]); // eslint-disable-line react-hooks/exhaustive-deps
  const hasRows = useStore((s) => s.damage.rows.length > 0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, [open]);
  if (!v || !values) return null;
  return (
    <section className="shrink-0 border-t border-line bg-surface" aria-label="Region map">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-4 py-2 text-left hover:bg-sunken/60"
      >
        <MapIcon className="h-4 w-4 text-accent" />
        <span className="text-[13px] font-semibold text-ink">Region map</span>
        <span className="text-[12px] text-ink-2">
          {v.name} unrolled: every section, side and position{hasRows ? ', coloured by damage' : ''}
        </span>
        <ChevronDown className={cx('ml-auto h-4 w-4 text-muted transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="flex items-end gap-4 px-4 pb-3">
          <div ref={ref} className="scroll-thin min-w-0 flex-1 overflow-x-auto">
            <RegionMap
              values={values}
              scale={scale}
              layout={layout}
              width={Math.max(320, width)}
              colors={chromeColors(dark)}
              selected={selection && selection.vKey === v.vKey ? selection : null}
              onSelect={(sec, side, pos) => selectLocation(v.vKey, sec, side, pos)}
              onHover={(idx) => assets.engine?.setExternalHover(idx)}
            />
          </div>
        </div>
      )}
    </section>
  );
}
