import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Info, Layers, Maximize2, Minus, Plus, X } from 'lucide-react';
import { formatPercent } from '../lib/colormaps';
import { displayUrl, overlayUrl } from '../lib/images';
import { positionLabel, sideLabel } from '../lib/naming';
import { getDerived } from '../state/derived';
import { set, useStore } from '../state/store';
import { IconButton, Segmented, Slider, cx } from './ui';

export function Lightbox() {
  const lb = useStore((s) => s.lightbox);
  const images = useStore((s) => s.images);
  const [url, setUrl] = useState<string | null>(null);
  const [overlay, setOverlay] = useState<string | null>(null);
  const [showOverlay, setShowOverlay] = useState(true);
  const [overlayMode, setOverlayMode] = useState<'image' | 'mask'>('image');
  const [opacity, setOpacity] = useState(0.85);
  const [info, setInfo] = useState(true);
  const [view, setView] = useState({ k: 1, x: 0, y: 0 });
  const [natural, setNatural] = useState({ w: 0, h: 0 });
  const box = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; vx: number; vy: number } | null>(null);

  const id = lb ? lb.imageIds[lb.index] : null;
  const img = images.find((i) => i.id === id);
  const obs = id ? getDerived(useStore.getState()).observations.find((o) => o.imageId === id) : undefined;

  const close = useCallback(() => set({ lightbox: null }), []);
  const step = useCallback(
    (d: number) => {
      const cur = useStore.getState().lightbox;
      if (!cur) return;
      const n = cur.imageIds.length;
      set({ lightbox: { ...cur, index: (cur.index + d + n) % n } });
    },
    [],
  );

  const fit = useCallback(() => {
    const el = box.current;
    if (!el || !natural.w) return;
    const k = Math.min(el.clientWidth / natural.w, el.clientHeight / natural.h) * 0.96;
    setView({ k, x: (el.clientWidth - natural.w * k) / 2, y: (el.clientHeight - natural.h * k) / 2 });
  }, [natural]);

  useEffect(() => {
    if (!id || !img) return;
    let alive = true;
    setUrl(null);
    setOverlay(null);
    void displayUrl(id, img.fileName).then((u) => alive && setUrl(u));
    if (obs?.overlayId) {
      const ov = images.find((i) => i.id === obs.overlayId);
      if (ov) void overlayUrl(ov.id, ov.fileName, overlayMode).then((u) => alive && setOverlay(u));
    }
    return () => {
      alive = false;
    };
  }, [id, img, obs?.overlayId, overlayMode, images]);

  useEffect(() => {
    fit();
  }, [natural, fit, info]);

  useEffect(() => {
    if (!lb) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
      else if (e.key === 'ArrowRight') step(1);
      else if (e.key === 'ArrowLeft') step(-1);
      else if (e.key === '+' || e.key === '=') setView((v) => ({ ...v, k: v.k * 1.25 }));
      else if (e.key === '-') setView((v) => ({ ...v, k: v.k / 1.25 }));
      else if (e.key === '0') fit();
      else if (e.key.toLowerCase() === 'o') setShowOverlay((s) => !s);
      else return;
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [lb, close, step, fit]);

  if (!lb || !img) return null;

  const zoomAt = (factor: number, cx0: number, cy0: number) =>
    setView((v) => {
      const k = Math.max(0.02, Math.min(40, v.k * factor));
      const f = k / v.k;
      return { k, x: cx0 - (cx0 - v.x) * f, y: cy0 - (cy0 - v.y) * f };
    });
  const center = () => {
    const el = box.current!;
    return [el.clientWidth / 2, el.clientHeight / 2] as const;
  };
  const tr = obs ? useStore.getState().treatments.find((t) => t.id === useStore.getState().vesselTreatment[obs.vKey]) : null;

  return (
    <div className="fixed inset-0 z-[75] flex flex-col bg-[#0d0d0d]/96 text-[#f0efec]" role="dialog" aria-modal="true" aria-label="Image viewer">
      <div className="flex items-center gap-2 px-3 py-2">
        <div className="min-w-0 flex-1">
          <div className="truncate font-mono text-[13px]">{img.fileName}</div>
          {obs && (
            <div className="text-[12px] text-[#c3c2b7]">
              {obs.vessel} · Section {obs.section} · {sideLabel(obs.side)} · {positionLabel(obs.position)}
              {obs.damage !== null && <> · {formatPercent(obs.damage)} damage</>}
            </div>
          )}
        </div>
        <span className="tabular text-[12px] text-[#c3c2b7]">
          {lb.index + 1} / {lb.imageIds.length}
        </span>
        {overlay && (
          <IconButton
            label={showOverlay ? 'Hide traced outline (O)' : 'Show traced outline (O)'}
            onClick={() => setShowOverlay((s) => !s)}
            className={cx('!text-[#f0efec] hover:!bg-white/10', showOverlay && '!bg-white/15')}
          >
            <Layers className="h-4 w-4" />
          </IconButton>
        )}
        <IconButton label="Zoom out (−)" onClick={() => zoomAt(1 / 1.25, ...center())} className="!text-[#f0efec] hover:!bg-white/10">
          <Minus className="h-4 w-4" />
        </IconButton>
        <IconButton label="Fit (0)" onClick={fit} className="!text-[#f0efec] hover:!bg-white/10">
          <Maximize2 className="h-4 w-4" />
        </IconButton>
        <IconButton label="Zoom in (+)" onClick={() => zoomAt(1.25, ...center())} className="!text-[#f0efec] hover:!bg-white/10">
          <Plus className="h-4 w-4" />
        </IconButton>
        <IconButton label="Details" onClick={() => setInfo((v) => !v)} className={cx('!text-[#f0efec] hover:!bg-white/10', info && '!bg-white/15')}>
          <Info className="h-4 w-4" />
        </IconButton>
        <IconButton label="Close (Esc)" onClick={close} side="left" className="!text-[#f0efec] hover:!bg-white/10">
          <X className="h-5 w-5" />
        </IconButton>
      </div>
      <div className="relative flex min-h-0 flex-1">
        <div
          ref={box}
          className="relative min-w-0 flex-1 cursor-grab overflow-hidden active:cursor-grabbing"
          onWheel={(e) => {
            const r = box.current!.getBoundingClientRect();
            zoomAt(e.deltaY < 0 ? 1.15 : 1 / 1.15, e.clientX - r.left, e.clientY - r.top);
          }}
          onPointerDown={(e) => {
            (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
            drag.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y };
          }}
          onPointerMove={(e) => {
            const d = drag.current;
            if (d) setView((v) => ({ ...v, x: d.vx + e.clientX - d.x, y: d.vy + e.clientY - d.y }));
          }}
          onPointerUp={() => (drag.current = null)}
          onDoubleClick={(e) => {
            const r = box.current!.getBoundingClientRect();
            zoomAt(2, e.clientX - r.left, e.clientY - r.top);
          }}
        >
          {url && (
            <div className="absolute top-0 left-0 origin-top-left" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})` }}>
              <img
                src={url}
                alt={img.fileName}
                draggable={false}
                onLoad={(e) => setNatural({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
                className="block max-w-none select-none"
                style={{ imageRendering: view.k > 2 ? 'pixelated' : 'auto' }}
              />
              {overlay && showOverlay && (
                <img src={overlay} alt="Traced damage outline" draggable={false} className="absolute inset-0 h-full w-full max-w-none select-none" style={{ opacity }} />
              )}
            </div>
          )}
          {!url && <div className="absolute inset-0 flex items-center justify-center text-[13px] text-[#c3c2b7]">Loading image…</div>}
          {lb.imageIds.length > 1 && (
            <>
              <button
                type="button"
                aria-label="Previous image (←)"
                onClick={() => step(-1)}
                className="absolute top-1/2 left-3 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-black/50 hover:bg-black/70"
              >
                <ChevronLeft className="h-6 w-6" />
              </button>
              <button
                type="button"
                aria-label="Next image (→)"
                onClick={() => step(1)}
                className="absolute top-1/2 right-3 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-black/50 hover:bg-black/70"
              >
                <ChevronRight className="h-6 w-6" />
              </button>
            </>
          )}
          <div className="tabular absolute bottom-3 left-3 rounded bg-black/50 px-2 py-0.5 text-[11.5px]">{Math.round(view.k * 100)}%</div>
        </div>
        {info && obs && (
          <div className="w-[260px] shrink-0 overflow-y-auto border-l border-white/10 px-4 py-3 text-[12.5px] max-md:hidden">
            <dl className="space-y-2">
              {[
                ['Vessel', obs.vessel],
                ['Treatment', tr?.name ?? 'Not assigned'],
                ['Section', String(obs.section)],
                ['Side', sideLabel(obs.side)],
                ['Position', `${obs.position} · ${positionLabel(obs.position)}`],
                ['Magnification', obs.magnification ?? '–'],
                ['Damage', obs.damage !== null ? formatPercent(obs.damage, 2) : 'No value in the sheet'],
                ['Placed', obs.manual ? 'By hand' : 'From the file name'],
                ['Size', natural.w ? `${natural.w} × ${natural.h} px` : '–'],
              ].map(([k, v]) => (
                <div key={k}>
                  <dt className="text-[11px] text-[#9a988f]">{k}</dt>
                  <dd className="text-[#f0efec]">{v}</dd>
                </div>
              ))}
            </dl>
            {overlay && (
              <div className="mt-4 space-y-2 border-t border-white/10 pt-3">
                <div className="text-[12px] font-semibold">Traced outline</div>
                <Segmented
                  size="sm"
                  value={overlayMode}
                  onChange={setOverlayMode}
                  options={[
                    { value: 'image', label: 'As drawn' },
                    { value: 'mask', label: 'Mask' },
                  ]}
                />
                <div className={cx(!showOverlay && 'opacity-50')}>
                  <Slider label="Opacity" min={0} max={1} step={0.05} value={opacity} onChange={setOpacity} format={(v) => `${Math.round(v * 100)}%`} />
                </div>
              </div>
            )}
            <p className="mt-4 text-[11px] leading-snug text-[#9a988f]">← → flip through this vessel's images in order along the vessel. Scroll to zoom, drag to pan.</p>
          </div>
        )}
      </div>
    </div>
  );
}
