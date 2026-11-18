import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import {
  Box,
  Camera,
  ChevronLeft,
  ChevronRight,
  Crosshair,
  Eye,
  Layers,
  ImageDown,
  MapPin,
  Minus,
  MousePointerClick,
  Plus,
  Presentation,
  RotateCcw,
} from 'lucide-react';
import { buildColormapLUT, formatPercent, paletteStops, sectionColor, seriesColor } from '../lib/colormaps';
import { positionLabel, sideLabel } from '../lib/naming';
import { medialCount, regionFor } from '../lib/regions';
import { addScene, clearSelection, placeImage, selectLocation, stepVessel } from '../state/actions';
import { assets } from '../state/assets';
import { currentVessel, getDerived, getLayout, targetValues, useLayout, useVessels } from '../state/derived';
import { set, toast, useStore } from '../state/store';
import { computeViews, type ViewSet } from '../state/views';
import { VesselEngine, type CameraPreset, type PickInfo, type ViewMode } from '../three/engine';
import { orientationQuaternion } from '../state/actions';
import { DiffLegend, HeatLegend, SectionLegend } from './Legend';
import { OpenSlider } from './OpenSlider';
import { Button, cx, IconButton, Progress, Segmented } from './ui';

function useElementSize(ref: React.RefObject<HTMLElement | null>) {
  const [size, setSize] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, [ref]);
  return size;
}

function rectsFor(n: number, columns: number, w: number, h: number) {
  const cols = Math.min(Math.max(1, n), Math.max(1, columns));
  const rows = Math.ceil(Math.max(1, n) / cols);
  return Array.from({ length: Math.max(1, n) }, (_v, i) => ({
    x: Math.round((i % cols) * (w / cols)),
    y: Math.round(Math.floor(i / cols) * (h / rows)),
    w: Math.round(w / cols),
    h: Math.round(h / rows),
  }));
}

interface HoverState {
  info: PickInfo;
  x: number;
  y: number;
}

export function Viewer({ dark }: { dark: boolean }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasHost = useRef<HTMLDivElement>(null);
  const engineRef = useRef<VesselEngine | null>(null);
  const viewSetRef = useRef<ViewSet | null>(null);
  const labelRefs = useRef(new Map<string, HTMLDivElement>());
  const anchorsRef = useRef<ReturnType<VesselEngine['labelAnchors']>>([]);
  const [anchors, setAnchors] = useState<{ id: string; text: string; kind: 'section' | 'end' }[]>([]);
  const [hover, setHover] = useState<HoverState | null>(null);
  const size = useElementSize(containerRef);
  // Height of the toolbar row(s) at the top, which wrap on narrow screens; the open/close slider sits below.
  const [toolbarEl, setToolbarEl] = useState<HTMLDivElement | null>(null);
  const [toolbarH, setToolbarH] = useState(38);
  useLayoutEffect(() => {
    if (!toolbarEl) return;
    const ro = new ResizeObserver(() => setToolbarH(toolbarEl.offsetHeight));
    ro.observe(toolbarEl);
    setToolbarH(toolbarEl.offsetHeight);
    return () => ro.disconnect();
  }, [toolbarEl]);

  const model = useStore((s) => s.model);
  const layout = useLayout();
  const viewMode = useStore((s) => s.viewMode);
  const heat = useStore((s) => s.heat);
  const step = useStore((s) => s.step);
  const selection = useStore((s) => s.selection);
  const hasSelection = selection !== null;
  const placing = useStore((s) => s.placing);
  const presenting = useStore((s) => s.presenting);
  const highlightSection = useStore((s) => s.highlightSection);
  const hasRows = useStore((s) => s.damage.rows.length > 0);
  const deps = useStore(
    useShallow((s) => [s.images, s.damage.rows, s.vesselTreatment, s.treatments, s.heat, s.sections, s.step, s.compare, s.vessel, s.viewMode]),
  );
  const viewSet = useMemo(() => computeViews(useStore.getState(), dark), [dark, layout, ...deps]); // eslint-disable-line react-hooks/exhaustive-deps
  viewSetRef.current = viewSet;
  const effectiveMode: ViewMode = viewMode === 'original' && !model.hasTexture ? 'plain' : viewMode;

  // ── Engine lifecycle ──────────────────────────────────────────────────
  useEffect(() => {
    const host = canvasHost.current!;
    let engine: VesselEngine;
    try {
      engine = new VesselEngine(host);
    } catch (e) {
      toast(`3D graphics (WebGL) are not available in this browser: ${String(e)}`, 'error', 12000);
      return;
    }
    engineRef.current = engine;
    assets.engine = engine;
    engine.onHover = (info) => {
      if (!info) {
        setHover(null);
        return;
      }
      const r = containerRef.current!.getBoundingClientRect();
      setHover({ info, x: info.clientX - r.left, y: info.clientY - r.top });
    };
    engine.onFrame = () => {
      const eng = engineRef.current;
      if (!eng) return;
      for (const a of anchorsRef.current) {
        const el = labelRefs.current.get(a.id);
        if (!el) continue;
        const p = eng.project(eng.anchorPosition(a), 0);
        el.style.transform = `translate(${p.x}px, ${p.y}px) translate(-50%, -50%)`;
        el.style.visibility = p.behind ? 'hidden' : 'visible';
      }
    };
    return () => {
      engine.dispose();
      engineRef.current = null;
      assets.engine = null;
    };
  }, []);

  const layoutRef = useRef(layout);
  layoutRef.current = layout;

  const handleClick = useCallback((info: PickInfo) => {
    const s = useStore.getState();
    const vs = viewSetRef.current;
    let region = info.region;
    if (info.markerKey) {
      const [, sec, side, pos] = info.markerKey.split('|');
      region = regionFor(Number(sec), side as 'T' | 'B', pos, layoutRef.current) ?? region;
    }
    if (!region) {
      if (s.selection) clearSelection();
      return;
    }
    if (s.placing) {
      const placing = s.placing;
      placeImage(placing.imageId, { bioreactor: placing.vessel, section: region.section, side: region.side, position: region.position });
      const img = s.images.find((i) => i.id === placing.imageId);
      toast(
        `Placed ${img?.fileName ?? 'image'} at ${placing.vessel}, section ${region.section}, ${sideLabel(region.side).toLowerCase()}, ${positionLabel(region.position).toLowerCase()}.`,
        'success',
      );
      set({ placing: null });
      return;
    }
    const target = vs?.views[info.viewIndex]?.target ?? null;
    if (target?.kind === 'vessel') selectLocation(target.key, region.section, region.side, region.position);
    else if (target?.kind === 'group') selectLocation(null, region.section, region.side, region.position, target.id);
    else if (target?.kind === 'diff') {
      const a = vs?.views[0]?.target;
      if (a?.kind === 'group') selectLocation(null, region.section, region.side, region.position, a.id);
      else if (a?.kind === 'vessel') selectLocation(a.key, region.section, region.side, region.position);
    } else selectLocation(null, region.section, region.side, region.position);
  }, []);

  useEffect(() => {
    if (engineRef.current) engineRef.current.onClick = handleClick;
  }, [handleClick]);

  // ── Push state into the engine ────────────────────────────────────────
  const refreshAnchors = useCallback(() => {
    const eng = engineRef.current;
    if (!eng) return;
    anchorsRef.current = eng.labelAnchors();
    setAnchors(anchorsRef.current.map(({ id, text, kind }) => ({ id, text, kind })));
    eng.requestRender();
  }, []);

  useEffect(() => {
    const eng = engineRef.current;
    if (!eng) return;
    // Show a new or reopened model as open or closed as the slider says.
    const opening = useStore.getState().opening;
    eng.setOpening(opening.amount, opening.side);
    if (assets.model.result) {
      eng.setOrientation(orientationQuaternion(model.upAxis, model.rotation));
      eng.setLayout(layoutRef.current);
      eng.setModel(assets.model.result, assets.model.original);
    } else eng.clearModel();
    refreshAnchors();
  }, [model.revision]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    engineRef.current?.setOrientation(orientationQuaternion(model.upAxis, model.rotation));
    refreshAnchors();
  }, [model.upAxis, model.rotation, refreshAnchors]);

  useEffect(() => {
    const eng = engineRef.current;
    if (!eng) return;
    eng.setLayout(layout);
    eng.setSectionColors(Array.from({ length: layout.count }, (_v, i) => sectionColor(i, layout.count)));
    refreshAnchors();
  }, [layout, refreshAnchors]);

  useEffect(() => {
    engineRef.current?.setMode(effectiveMode);
  }, [effectiveMode, model.revision]);

  useEffect(() => {
    engineRef.current?.setColormap(buildColormapLUT(paletteStops(heat.palette), heat.steps), heat.steps > 0);
  }, [heat.palette, heat.steps]);

  useEffect(() => {
    engineRef.current?.setOptions({
      outlines: heat.outlines,
      smooth: heat.smooth,
      showMarkers: heat.showMarkers,
      showCenterline: step === 'sections' && !presenting,
      xray: false,
      plainColor: dark ? '#a39b92' : '#d6cdc4',
      lineColor: dark ? '#0d0d0d' : '#1a1a19',
      autoRotate: false,
    });
  }, [heat.outlines, heat.smooth, heat.showMarkers, step, dark, presenting]);

  useEffect(() => {
    engineRef.current?.setViews(viewSet.views, viewSet.columns);
  }, [viewSet]);

  useEffect(() => {
    const eng = engineRef.current;
    if (!eng) return;
    if (!selection) {
      eng.setSelected(null, null);
      return;
    }
    const r = regionFor(selection.section, selection.side, selection.position, layout);
    eng.setSelected(r?.index ?? null, selection.vKey ? `${selection.vKey}|${selection.section}|${selection.side}|${selection.position}` : null);
  }, [selection, layout]);

  useEffect(() => {
    engineRef.current?.setHighlightSection(highlightSection);
  }, [highlightSection]);

  useEffect(() => {
    engineRef.current?.setOptions({ picking: true });
  }, [placing]);

  // Keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      if (document.querySelector('dialog[open]')) return;
      const s = useStore.getState();
      if (s.presenting) return;
      if (e.key === 'Escape') {
        if (s.placing) set({ placing: null });
        else if (s.selection) clearSelection();
      } else if ((e.key === 'ArrowRight' || e.key === 'ArrowLeft') && s.step !== 'compare' && s.step !== 'stats') {
        stepVessel(e.key === 'ArrowRight' ? 1 : -1);
      } else if (e.key === 'r' || e.key === 'R') engineRef.current?.setCameraPreset('iso');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const rects = rectsFor(viewSet.views.length, viewSet.columns, size.w, size.h);
  const showLabels = !viewSet.compare && model.status === 'ready' && (effectiveMode === 'sections' || effectiveMode === 'heat');
  const legendView = viewSet.views.find((v) => v.isDiff);

  return (
    <div ref={containerRef} className="viewer-bg relative h-full w-full overflow-hidden" data-testid="viewer">
      <div ref={canvasHost} className="absolute inset-0" />

      {/* Section / end labels */}
      <div className="pointer-events-none absolute inset-0" aria-hidden={!showLabels}>
        {showLabels &&
          anchors.map((a) => (
            <div
              key={a.id}
              ref={(el) => {
                if (el) labelRefs.current.set(a.id, el);
                else labelRefs.current.delete(a.id);
              }}
              className={cx(
                'absolute top-0 left-0 rounded-full px-1.5 text-[11px] leading-[18px] font-semibold whitespace-nowrap shadow-sm select-none',
                a.kind === 'section'
                  ? 'min-w-[20px] border border-white/70 bg-[#0d366b]/85 text-center text-white'
                  : 'border border-line bg-surface/90 text-ink-2',
              )}
            >
              {a.kind === 'section' ? a.text : a.text}
            </div>
          ))}
      </div>

      {/* Compare view labels and dividers */}
      {viewSet.compare &&
        viewSet.views.map((v, i) => {
          const r = rects[i];
          if (!r) return null;
          const compact = viewSet.views.length > 4;
          if (compact) {
            return (
              <div key={v.key} className="pointer-events-none absolute" style={{ left: r.x, top: r.y, width: r.w, height: r.h }}>
                <div className="absolute inset-0 border-r border-b border-line/70" />
                <div
                  className="absolute left-1.5 flex max-w-[calc(100%-12px)] items-center gap-1 rounded bg-surface/80 px-1.5 py-0.5 text-[11px] backdrop-blur"
                  style={{ top: r.y === 0 ? (presenting ? 96 : 54) : 6 }}
                >
                  {v.color && <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: v.color }} />}
                  <span className="truncate font-semibold text-ink">{v.label}</span>
                  {v.mean !== null && <span className="tabular text-ink-2">{formatPercent(v.mean)}</span>}
                </div>
              </div>
            );
          }
          return (
            <div key={v.key} className="pointer-events-none absolute" style={{ left: r.x, top: r.y, width: r.w, height: r.h }}>
              <div className="absolute inset-0 border-r border-b border-line/70" />
              <div
                className="absolute left-2 max-w-[calc(100%-16px)] rounded-md bg-surface/85 px-2 py-1 shadow-sm backdrop-blur"
                style={{ top: r.y === 0 ? (presenting ? 96 : 56) : 8 }}
              >
                <div className="flex items-center gap-1.5 text-[12px] font-semibold text-ink">
                  {v.color && <span className="h-2.5 w-2.5 rounded-full" style={{ background: v.color }} />}
                  <span className="truncate">{v.label}</span>
                </div>
                <div className="truncate text-[11px] text-ink-2">
                  {v.sublabel}
                  {v.mean !== null && !v.isDiff && <> · mean {formatPercent(v.mean)}</>}
                </div>
              </div>
            </div>
          );
        })}

      {model.status === 'ready' && !presenting && (
        <div ref={setToolbarEl} className="pointer-events-none absolute inset-x-3 top-3 z-10 flex flex-wrap items-start justify-between gap-2">
          <div className="pointer-events-auto min-w-0">
            <TopLeftControls compare={viewSet.compare} />
          </div>
          <div className="pointer-events-auto ml-auto">
            <ViewToolbar engine={engineRef} mode={viewMode} hasTexture={model.hasTexture} hasRows={hasRows} />
          </div>
        </div>
      )}

      {/* Legend */}
      {model.status === 'ready' && (
        <div
          className={cx(
            'pointer-events-none absolute z-10 flex flex-col gap-2',
            viewSet.compare && viewSet.views.length > 4 ? 'right-3' : 'left-3',
            presenting ? 'bottom-16' : 'bottom-3',
          )}
        >
          {effectiveMode === 'heat' && <HeatLegend scale={viewSet.scale} />}
          {effectiveMode === 'heat' && legendView && <DiffLegend max={legendView.diffMax} />}
          {effectiveMode === 'sections' && !viewSet.compare && <SectionLegend count={layout.count} />}
        </div>
      )}

      {/* Open / close the vessel lengthways. Sits on the right edge, left of the image panel when that covers the view,
          below the toolbar (or the presentation title) and above a legend in the bottom-right corner. */}
      {model.status === 'ready' && step !== 'stats' && (
        <div
          style={{
            top: presenting ? 96 : Math.max(60, toolbarH + 22),
            bottom: viewSet.compare && viewSet.views.length > 4 ? (presenting ? 150 : 100) : presenting ? 64 : 24,
          }}
          className={cx(
            'pointer-events-none absolute z-[5] flex items-center',
            !hasSelection
              ? 'right-3'
              : presenting
                ? 'right-[392px] max-lg:right-[calc(min(400px,94vw)+12px)]'
                : 'right-3 max-lg:right-[calc(min(400px,94vw)+12px)]',
          )}
        >
          <OpenSlider disabledReason={effectiveMode === 'original' ? 'Switch to Plain, Sections or Heat map to open the vessel' : null} />
        </div>
      )}

      {hover && !placing && <HoverTooltip hover={hover} viewSet={viewSet} width={size.w} />}

      {placing && <PlacingBanner />}
      <ModelProgress />
    </div>
  );
}

function TopLeftControls({ compare }: { compare: boolean }) {
  const vessels = useVessels();
  const s = useStore(useShallow((st) => ({ vessel: st.vessel, treatments: st.treatments, vt: st.vesselTreatment })));
  const current = useStore(currentVessel);
  if (compare || vessels.length === 0) return null;
  const tr = current ? s.treatments.find((t) => t.id === s.vt[current.vKey]) : null;
  const groups = new Map<string, typeof vessels>();
  for (const v of vessels) {
    const k = v.treatmentId ?? '';
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(v);
  }
  return (
    <div className="flex max-w-full items-center gap-1 rounded-lg border border-line bg-surface/92 p-1 shadow-card backdrop-blur">
      <IconButton label="Previous vessel (←)" size="sm" onClick={() => stepVessel(-1)}>
        <ChevronLeft className="h-4 w-4" />
      </IconButton>
      <div className="flex min-w-0 items-center gap-2 px-1">
        {tr && <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: seriesColor(tr.slot) }} aria-hidden />}
        <label className="sr-only" htmlFor="vessel-picker">
          Vessel
        </label>
        <select
          id="vessel-picker"
          className="h-7 max-w-[180px] min-w-0 cursor-pointer truncate rounded-md bg-transparent pr-1 text-[13px] font-semibold text-ink outline-none hover:bg-sunken"
          value={current?.vKey ?? ''}
          onChange={(e) => set({ vessel: e.target.value, selection: null })}
        >
          {[...groups.entries()].map(([tid, list]) => (
            <optgroup key={tid} label={s.treatments.find((t) => t.id === tid)?.name ?? 'No treatment assigned'}>
              {list.map((v) => (
                <option key={v.vKey} value={v.vKey}>
                  {v.name}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        <span className="hidden truncate text-[12px] text-ink-2 sm:inline">{tr?.name ?? 'No treatment'}</span>
      </div>
      <IconButton label="Next vessel (→)" size="sm" onClick={() => stepVessel(1)}>
        <ChevronRight className="h-4 w-4" />
      </IconButton>
    </div>
  );
}

function ViewToolbar({
  engine,
  mode,
  hasTexture,
  hasRows,
}: {
  engine: React.RefObject<VesselEngine | null>;
  mode: ViewMode;
  hasTexture: boolean;
  hasRows: boolean;
}) {
  const showMarkers = useStore((s) => s.heat.showMarkers);
  const step = useStore((s) => s.step);
  const [camOpen, setCamOpen] = useState(false);
  const presets: [CameraPreset, string][] = [
    ['top', 'Top'],
    ['bottom', 'Bottom'],
    ['front', 'Front'],
    ['back', 'Back'],
    ['left', 'Left end'],
    ['right', 'Right end'],
    ['iso', 'Angled'],
  ];
  const modes: { value: ViewMode; label: React.ReactNode; title: string; disabled?: boolean }[] = [
    { value: 'plain', label: <Box className="h-3.5 w-3.5" />, title: 'Plain model' },
    { value: 'sections', label: <Layers className="h-3.5 w-3.5" />, title: 'Sections' },
    { value: 'heat', label: <span className="h-3 w-3 rounded-sm bg-gradient-to-r from-[#fed976] via-[#fc4e2a] to-[#800026]" />, title: hasRows ? 'Damage heat map' : 'Damage heat map (add damage data first)' },
  ];
  if (hasTexture) modes.push({ value: 'original', label: <Camera className="h-3.5 w-3.5" />, title: 'Original scan colours' });
  return (
    <div className="flex items-center gap-1 rounded-lg border border-line bg-surface/92 p-1 shadow-card backdrop-blur">
      <Segmented
        size="sm"
        label="Colour the model by"
        value={mode}
        onChange={(v) => set({ viewMode: v })}
        options={modes.map((m) => ({
          value: m.value,
          title: m.title,
          label: (
            <span className="flex items-center gap-1.5">
              {m.label}
              <span className="hidden lg:inline">{m.value === 'plain' ? 'Plain' : m.value === 'sections' ? 'Sections' : m.value === 'heat' ? 'Heat map' : 'Scan'}</span>
            </span>
          ),
        }))}
      />
      <span className="mx-0.5 h-5 w-px bg-line" aria-hidden />
      <div className="relative">
        <IconButton label="Camera views" size="sm" onClick={() => setCamOpen((o) => !o)} active={camOpen}>
          <Eye className="h-4 w-4" />
        </IconButton>
        {camOpen && (
          <div
            className="absolute top-full right-0 z-20 mt-1.5 w-40 rounded-lg border border-line bg-surface p-1 shadow-pop"
            onMouseLeave={() => setCamOpen(false)}
          >
            {presets.map(([p, label]) => (
              <button
                key={p}
                type="button"
                className="flex w-full items-center rounded-md px-2 py-1.5 text-left text-[12.5px] text-ink hover:bg-sunken"
                onClick={() => {
                  engine.current?.setCameraPreset(p);
                  setCamOpen(false);
                }}
              >
                {label}
              </button>
            ))}
          </div>
        )}
      </div>
      <IconButton label="Zoom in" size="sm" onClick={() => engine.current?.zoomBy(0.8)}>
        <Plus className="h-4 w-4" />
      </IconButton>
      <IconButton label="Zoom out" size="sm" onClick={() => engine.current?.zoomBy(1.25)}>
        <Minus className="h-4 w-4" />
      </IconButton>
      <IconButton label="Reset view (R)" size="sm" onClick={() => engine.current?.setCameraPreset('iso')}>
        <RotateCcw className="h-4 w-4" />
      </IconButton>
      <IconButton
        label={showMarkers ? 'Hide image markers' : 'Show image markers'}
        size="sm"
        active={showMarkers}
        onClick={() => set((s) => ({ heat: { ...s.heat, showMarkers: !s.heat.showMarkers } }))}
      >
        <MapPin className="h-4 w-4" />
      </IconButton>
      {(step === 'explore' || step === 'compare') && (
        <IconButton
          label="Add this view to the presentation"
          size="sm"
          onClick={() => {
            const cam = engine.current?.getCameraState();
            if (cam) addScene(cam);
          }}
        >
          <Presentation className="h-4 w-4" />
        </IconButton>
      )}
      <IconButton label="Export image…" size="sm" onClick={() => set({ dialog: 'export' })}>
        <ImageDown className="h-4 w-4" />
      </IconButton>
    </div>
  );
}

function HoverTooltip({ hover, viewSet, width }: { hover: HoverState; viewSet: ViewSet; width: number }) {
  const s = useStore.getState();
  const view = viewSet.views[hover.info.viewIndex];
  const region = hover.info.region;
  let regionInfo = region;
  if (hover.info.markerKey) {
    // On a marker, describe the marker's location: that's what a click opens.
    const [, sec, side, pos] = hover.info.markerKey.split('|');
    regionInfo = regionFor(Number(sec), side as 'T' | 'B', pos, getLayout(s)) ?? region ?? { section: Number(sec), side: side as 'T' | 'B', position: pos, slot: 0, index: -1 };
  }
  if (!regionInfo) return null;
  const medial = medialCount(getLayout(s).positions[regionInfo.section - 1] ?? []);
  let valueText = '';
  let detail = '';
  let hasData = false;
  let canOpen = false;
  if (view?.target?.kind === 'vessel') {
    const v = getDerived(s).vesselMap.get(view.target.key);
    const loc = v?.locations.get(`${view.target.key}|${regionInfo.section}|${regionInfo.side}|${regionInfo.position}`);
    if (loc) {
      hasData = loc.value !== null;
      valueText = loc.value !== null ? formatPercent(loc.value) : 'No damage value';
      const imgs = loc.observations.filter((o) => o.imageId).length;
      detail = `${imgs} image${imgs === 1 ? '' : 's'}${loc.n > 1 ? ` · ${s.heat.aggregation} of ${loc.n} values` : ''}`;
      canOpen = true;
    }
  } else if (view?.target && region) {
    const rv = targetValues(s, view.target);
    const x = rv.values[region.index];
    if (!Number.isNaN(x)) {
      hasData = true;
      valueText = view.isDiff ? `${x >= 0 ? '+' : ''}${x.toFixed(1)} points` : formatPercent(x);
      detail = view.isDiff ? 'difference between the two views' : `mean of ${rv.counts[region.index]} vessel${rv.counts[region.index] === 1 ? '' : 's'}`;
      canOpen = true;
    }
  }
  const left = Math.min(hover.x + 14, Math.max(0, width - 230));
  return (
    <div
      className="pointer-events-none absolute z-20 w-max max-w-[220px] rounded-lg border border-line bg-surface px-3 py-2 shadow-pop"
      style={{ left, top: hover.y + 14 }}
      role="status"
    >
      {view?.label && (
        <div className="flex items-center gap-1.5 text-[11.5px] text-ink-2">
          {view.color && <span className="h-2 w-2 rounded-full" style={{ background: view.color }} />}
          {view.label}
        </div>
      )}
      <div className="text-[12.5px] font-semibold text-ink">
        Section {regionInfo.section} · {sideLabel(regionInfo.side)} · {positionLabel(regionInfo.position, medial)}
      </div>
      {hasData ? (
        <div className="mt-0.5 flex items-baseline gap-1.5">
          <span className="text-[15px] font-semibold text-ink">{valueText}</span>
          <span className="text-[11px] text-muted">{detail}</span>
        </div>
      ) : (
        <div className="mt-1 flex items-center gap-1.5 text-[12px] text-ink-2">
          <span className="hatch inline-block h-2.5 w-3.5 rounded-sm" /> {valueText || 'No image at this location'}
          {detail && <span className="text-muted">· {detail}</span>}
        </div>
      )}
      {canOpen && (
        <div className="mt-1 flex items-center gap-1 text-[11px] text-accent">
          <MousePointerClick className="h-3 w-3" /> Click to view images
        </div>
      )}
    </div>
  );
}

function PlacingBanner() {
  const placing = useStore((s) => s.placing);
  const img = useStore((s) => s.images.find((i) => i.id === s.placing?.imageId));
  if (!placing) return null;
  return (
    <div className="absolute top-16 left-1/2 z-20 flex -translate-x-1/2 items-center gap-3 rounded-full border border-accent bg-surface px-4 py-2 shadow-pop">
      <Crosshair className="h-4 w-4 text-accent" />
      <span className="text-[13px] text-ink">
        Click where <b className="font-semibold">{img?.fileName}</b> was taken on <b className="font-semibold">{placing.vessel}</b>
      </span>
      <Button size="sm" variant="ghost" onClick={() => set({ placing: null })}>
        Cancel
      </Button>
    </div>
  );
}

function ModelProgress() {
  const model = useStore((s) => s.model);
  if (model.status !== 'loading' && model.status !== 'processing') return null;
  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-bg/40 backdrop-blur-[2px]">
      <div className="w-[min(360px,90%)] rounded-xl border border-line bg-surface p-5 shadow-pop">
        <div className="mb-1 text-[14px] font-semibold text-ink">{model.status === 'loading' ? 'Opening the model' : 'Analysing the vessel'}</div>
        <div className="mb-3 truncate text-[12.5px] text-ink-2">{model.progress?.stage ?? model.name}</div>
        <Progress value={model.progress?.fraction ?? null} />
        <p className="mt-3 text-[11.5px] text-muted">
          Finding the centerline so the vessel can be divided into sections. This runs on your computer.
        </p>
      </div>
    </div>
  );
}
