import { useEffect, useMemo, useRef, useState } from 'react';
import { useDark } from './useTheme';
import { useShallow } from 'zustand/react/shallow';
import { ChevronDown, ChevronLeft, ChevronRight, ImageOff, Layers, X } from 'lucide-react';
import { colorForValue, formatPercent, inkOn, seriesColor } from '../lib/colormaps';
import { thumbUrl } from '../lib/images';
import { positionLabel, sideLabel, type Side } from '../lib/naming';
import { medialCount } from '../lib/regions';
import { regionFor } from '../lib/regions';
import { locKey, type LocationData, type Observation } from '../lib/study';
import { clearSelection, selectLocation } from '../state/actions';
import { assets } from '../state/assets';
import { getScale, targetValues, useDerived, useLayout, useVessels } from '../state/derived';
import { set, useStore } from '../state/store';
import { Badge, IconButton, Segmented, cx } from './ui';

export function Thumb({ imageId, name, className, lazy = false }: { imageId: string; name: string; className?: string; lazy?: boolean }) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let alive = true;
    const load = () =>
      thumbUrl(imageId, name).then((u) => {
        if (!alive) return;
        if (u) setUrl(u);
        else setFailed(true);
      });
    if (!lazy || !ref.current) {
      void load();
      return () => {
        alive = false;
      };
    }
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        io.disconnect();
        void load();
      }
    });
    io.observe(ref.current);
    return () => {
      alive = false;
      io.disconnect();
    };
  }, [imageId, name, lazy]);
  return (
    <div ref={ref} className={cx('relative overflow-hidden bg-sunken', className)}>
      {url ? (
        <img src={url} alt={name} className="h-full w-full object-cover" draggable={false} />
      ) : failed || !assets.images.has(imageId) ? (
        <div className="flex h-full w-full flex-col items-center justify-center gap-1 text-muted">
          <ImageOff className="h-4 w-4" />
          <span className="text-[10px]">Not available</span>
        </div>
      ) : (
        <div className="h-full w-full animate-pulse bg-line/60" />
      )}
    </div>
  );
}

function DamageChip({ value }: { value: number | null }) {
  const scale = useStore(useShallow((s) => getScale(s)));
  if (value === null) return <span className="rounded bg-sunken px-1.5 py-0.5 text-[11px] text-ink-2">No value</span>;
  const bg = colorForValue(value, scale);
  return (
    <span className="tabular rounded px-1.5 py-0.5 text-[11px] font-semibold" style={{ background: bg, color: inkOn(bg) }}>
      {formatPercent(value)}
    </span>
  );
}

function openLightbox(obs: Observation[], start: Observation) {
  const ids = obs.filter((o) => o.imageId).map((o) => o.imageId!);
  const index = Math.max(0, ids.indexOf(start.imageId!));
  set({ lightbox: { imageIds: ids, index } });
}

function ImageGrid({ loc }: { loc: LocationData }) {
  const vessel = useDerived().vesselMap.get(loc.vKey);
  const withImages = loc.observations.filter((o) => o.imageId);
  const without = loc.observations.filter((o) => !o.imageId);
  const sorted = useMemo(() => {
    if (!vessel) return [];
    const order = (o: Observation) => o.section * 1000 + (o.side === 'T' ? 0 : 500) + (o.position === 'P' ? 0 : o.position === 'D' ? 400 : parseInt(o.position.slice(1), 10) || 1);
    return [...vessel.observations].filter((o) => o.imageId).sort((a, b) => order(a) - order(b) || a.name.localeCompare(b.name));
  }, [vessel]);
  return (
    <div>
      {withImages.length > 0 && (
        <ul className={cx('grid gap-2', withImages.length === 1 ? 'grid-cols-1' : 'grid-cols-2')}>
          {withImages.map((o) => (
            <li key={o.id}>
              <button
                type="button"
                onClick={() => openLightbox(sorted, o)}
                className="group block w-full overflow-hidden rounded-lg border border-line bg-surface-2 text-left transition-shadow hover:shadow-card focus-visible:outline-2"
              >
                <Thumb imageId={o.imageId!} name={o.name} className={withImages.length === 1 ? 'aspect-[4/3]' : 'aspect-square'} />
                <div className="flex items-center justify-between gap-1 px-2 py-1.5">
                  <span className="truncate font-mono text-[10.5px] text-ink-2" title={o.name}>
                    {o.name}
                  </span>
                  <DamageChip value={o.damage} />
                </div>
                {o.overlayId && (
                  <div className="flex items-center gap-1 border-t border-line px-2 py-1 text-[10.5px] text-accent">
                    <Layers className="h-3 w-3" /> Traced outline available
                  </div>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
      {without.length > 0 && (
        <ul className="mt-2 space-y-1">
          {without.map((o) => (
            <li key={o.id} className="flex items-center justify-between gap-2 rounded-md border border-dashed border-line px-2 py-1.5">
              <span className="min-w-0">
                <span className="block truncate font-mono text-[11px] text-ink" title={o.name}>
                  {o.name}
                </span>
                <span className="text-[10.5px] text-muted">Damage value only; image not added</span>
              </span>
              <DamageChip value={o.damage} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function OtherVessels({ section, side, position, exclude, groupId }: { section: number; side: Side; position: string; exclude: string | null; groupId?: string | null }) {
  const [open, setOpen] = useState(!!groupId);
  const vessels = useVessels();
  const d = useDerived();
  const s = useStore(useShallow((st) => ({ treatments: st.treatments, vt: st.vesselTreatment })));
  const dark = useDark();
  const rows = vessels
    .filter((v) => v.vKey !== exclude && (!groupId || v.treatmentId === groupId))
    .map((v) => ({ v, loc: d.vesselMap.get(v.vKey)?.locations.get(locKey(v.vKey, section, side, position)) ?? null }));
  return (
    <div className="mt-4 rounded-lg border border-line">
      <button
        type="button"
        className="flex w-full items-center justify-between px-3 py-2 text-left"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        <span className="text-[12.5px] font-semibold text-ink">{groupId ? 'Vessels in this group' : 'Same location in other vessels'}</span>
        <ChevronDown className={cx('h-4 w-4 text-muted transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <ul className="max-h-[420px] divide-y divide-line overflow-y-auto border-t border-line">
          {rows.map(({ v, loc }) => {
            const tr = s.treatments.find((t) => t.id === s.vt[v.vKey]);
            const img = loc?.observations.find((o) => o.imageId);
            return (
              <li key={v.vKey}>
                <button
                  type="button"
                  className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left hover:bg-sunken"
                  onClick={() => selectLocation(v.vKey, section, side, position)}
                >
                  {img ? (
                    <Thumb imageId={img.imageId!} name={img.name} className="h-9 w-9 shrink-0 rounded" lazy />
                  ) : (
                    <span className="hatch h-9 w-9 shrink-0 rounded" aria-hidden />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12.5px] font-medium text-ink">{v.name}</span>
                    <span className="flex items-center gap-1 text-[11px] text-ink-2">
                      {tr && <span className="h-2 w-2 rounded-full" style={{ background: seriesColor(tr.slot, dark) }} />}
                      {tr?.name ?? 'No treatment'}
                    </span>
                  </span>
                  <DamageChip value={loc?.value ?? null} />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export function ImagePanel() {
  const sel = useStore((s) => s.selection);
  const presenting = useStore((s) => s.presenting);
  const layout = useLayout();
  const d = useDerived();
  const s = useStore(useShallow((st) => ({ treatments: st.treatments, vt: st.vesselTreatment, agg: st.heat.aggregation })));
  const panelRef = useRef<HTMLElement>(null);
  const dark = useDark();
  useEffect(() => {
    panelRef.current?.focus({ preventScroll: true });
  }, [sel?.vKey, sel?.groupId]);
  if (!sel) return null;
  const positions = layout.positions[sel.section - 1] ?? [];
  const medial = medialCount(positions);
  // Sequence of locations along the vessel on this side.
  const seq: { section: number; position: string }[] = [];
  for (let sec = 1; sec <= layout.count; sec++) for (const p of layout.positions[sec - 1]) seq.push({ section: sec, position: p });
  const at = seq.findIndex((x) => x.section === sel.section && x.position === sel.position);
  const go = (i: number) => {
    const t = seq[i];
    if (t) selectLocation(sel.vKey, t.section, sel.side, t.position, sel.groupId ?? null);
  };
  const vessel = sel.vKey ? d.vesselMap.get(sel.vKey) : null;
  const loc = vessel ? (vessel.locations.get(locKey(vessel.vKey, sel.section, sel.side, sel.position)) ?? null) : null;
  const tr = vessel ? s.treatments.find((t) => t.id === s.vt[vessel.vKey]) : sel.groupId ? s.treatments.find((t) => t.id === sel.groupId) : null;
  let headline: number | null = null;
  let headlineNote = '';
  if (loc) {
    headline = loc.value;
    headlineNote = loc.n > 1 ? `${s.agg} of ${loc.n} images` : loc.n === 1 ? 'one image' : '';
  } else if (sel.groupId) {
    const r = regionFor(sel.section, sel.side, sel.position, layout);
    if (r) {
      const rv = targetValues(useStore.getState(), { kind: 'group', id: sel.groupId });
      const v = rv.values[r.index];
      headline = Number.isNaN(v) ? null : v;
      headlineNote = `average of ${rv.counts[r.index]} vessel${rv.counts[r.index] === 1 ? '' : 's'}`;
    }
  }

  return (
    <aside
      ref={panelRef}
      tabIndex={-1}
      aria-label="Images at the selected location"
      className={cx(
        'animate-slide-in flex w-[380px] shrink-0 flex-col border-l border-line bg-surface outline-none',
        'max-lg:fixed max-lg:inset-y-0 max-lg:right-0 max-lg:z-40 max-lg:w-[min(400px,94vw)] max-lg:shadow-pop',
        presenting && 'fixed inset-y-0 right-0 z-50 shadow-pop',
      )}
    >
      <div className="flex items-start gap-2 border-b border-line px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="text-[15px] font-semibold text-ink">
            Section {sel.section} · {sideLabel(sel.side)} · {positionLabel(sel.position, medial)}
          </div>
          <div className="mt-0.5 flex items-center gap-1.5 text-[12.5px] text-ink-2">
            {tr && <span className="h-2.5 w-2.5 rounded-full" style={{ background: seriesColor(tr.slot, dark) }} />}
            <span className="truncate">
              {vessel ? `${vessel.name} · ${tr?.name ?? 'no treatment assigned'}` : tr ? `${tr.name} · average` : 'No vessel selected'}
            </span>
          </div>
        </div>
        <IconButton label="Close (Esc)" onClick={clearSelection} side="left">
          <X className="h-4 w-4" />
        </IconButton>
      </div>
      <div className="flex items-center gap-1.5 border-b border-line px-3 py-2">
        <IconButton label="Previous position along the vessel" size="sm" disabled={at <= 0} onClick={() => go(at - 1)}>
          <ChevronLeft className="h-4 w-4" />
        </IconButton>
        <div className="flex flex-1 justify-center">
          <Segmented
            size="sm"
            value={sel.side}
            onChange={(side) => selectLocation(sel.vKey, sel.section, side, sel.position, sel.groupId ?? null)}
            options={[
              { value: 'T', label: 'Top' },
              { value: 'B', label: 'Bottom' },
            ]}
          />
        </div>
        <IconButton label="Next position along the vessel" size="sm" disabled={at < 0 || at >= seq.length - 1} onClick={() => go(at + 1)}>
          <ChevronRight className="h-4 w-4" />
        </IconButton>
      </div>
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-4 py-3">
        <div className="mb-3 flex items-end justify-between gap-2">
          <div>
            <div className="text-[11.5px] text-muted">Damage</div>
            <div className="text-[26px] leading-tight font-semibold text-ink">{headline !== null ? formatPercent(headline) : '–'}</div>
            {headlineNote && <div className="text-[11.5px] text-ink-2">{headlineNote}</div>}
          </div>
          <div className="flex flex-wrap justify-end gap-1">
            {positions.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => selectLocation(sel.vKey, sel.section, sel.side, p, sel.groupId ?? null)}
                className={cx(
                  'rounded px-1.5 py-0.5 font-mono text-[11px]',
                  p === sel.position ? 'bg-accent text-accent-ink' : 'bg-sunken text-ink-2 hover:text-ink',
                )}
              >
                {p}
              </button>
            ))}
          </div>
        </div>
        {vessel && loc && <ImageGrid loc={loc} />}
        {vessel && !loc && (
          <div className="flex items-center gap-2.5 rounded-lg border border-dashed border-line px-3 py-3 text-[12.5px] text-ink-2">
            <span className="hatch h-6 w-8 shrink-0 rounded" aria-hidden />
            No image or damage value at this location for {vessel.name}. It is shown in hatched gray, never as 0%.
          </div>
        )}
        {sel.groupId && !vessel && <Badge tone="accent">Treatment average</Badge>}
        <OtherVessels section={sel.section} side={sel.side} position={sel.position} exclude={sel.vKey} groupId={sel.groupId ?? null} />
      </div>
    </aside>
  );
}
