import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Pause, Play, X } from 'lucide-react';
import { applyScene, stepVessel } from '../state/actions';
import { assets } from '../state/assets';
import { currentVessel } from '../state/derived';
import { set, useStore } from '../state/store';
import { cx } from './ui';

export function stopPresentation() {
  assets.engine?.setOptions({ autoRotate: false });
  set({ presenting: false });
  if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
}

export function PresentationChrome() {
  const p = useStore((s) => s.presentation);
  const vessel = useStore(currentVessel);
  const tr = useStore((s) => (vessel ? s.treatments.find((t) => t.id === s.vesselTreatment[vessel.vKey]) : null));
  const step = useStore((s) => s.step);
  const [scene, setScene] = useState(p.scenes.length ? 0 : -1);
  const [rotating, setRotating] = useState(false);
  const [idle, setIdle] = useState(false);
  const timer = useRef<number | undefined>(undefined);

  const goScene = useCallback(
    (i: number) => {
      const scenes = useStore.getState().presentation.scenes;
      if (!scenes.length) return;
      const n = (i + scenes.length) % scenes.length;
      setScene(n);
      applyScene(scenes[n]);
    },
    [],
  );

  useEffect(() => {
    if (p.scenes.length) goScene(0);
    else if (step !== 'compare') set({ step: 'explore' });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    assets.engine?.setOptions({ autoRotate: rotating });
  }, [rotating]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (useStore.getState().lightbox) return;
      const scenes = useStore.getState().presentation.scenes;
      if (e.key === 'Escape') stopPresentation();
      else if (e.key === 'ArrowRight' || e.key === 'PageDown') scenes.length ? goScene(scene + 1) : stepVessel(1);
      else if (e.key === 'ArrowLeft' || e.key === 'PageUp') scenes.length ? goScene(scene - 1) : stepVessel(-1);
      else if (e.key === ' ') setRotating((r) => !r);
      else if (/^[1-9]$/.test(e.key) && scenes.length >= Number(e.key)) goScene(Number(e.key) - 1);
      else return;
      e.preventDefault();
    };
    const onFs = () => {
      if (!document.fullscreenElement && useStore.getState().presenting) stopPresentation();
    };
    const onMove = () => {
      setIdle(false);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setIdle(true), 2600);
    };
    window.addEventListener('keydown', onKey);
    document.addEventListener('fullscreenchange', onFs);
    window.addEventListener('pointermove', onMove);
    onMove();
    return () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('fullscreenchange', onFs);
      window.removeEventListener('pointermove', onMove);
      window.clearTimeout(timer.current);
    };
  }, [scene, goScene]);

  const sceneTitle = scene >= 0 ? p.scenes[scene]?.title : step === 'compare' ? 'Treatment comparison' : vessel ? `${vessel.name}${tr ? ` · ${tr.name}` : ''}` : '';

  return (
    <div className={cx('pointer-events-none fixed inset-0 z-40', idle && 'cursor-none')}>
      <div className="flex items-start justify-between gap-4 bg-gradient-to-b from-bg/90 via-bg/50 to-transparent px-8 pt-6 pb-10">
        <div className="flex items-center gap-4">
          {p.logo && <img src={p.logo} alt="" className="max-h-12 max-w-40 object-contain" />}
          <div>
            <div className="text-[26px] leading-tight font-semibold text-ink">{p.title || useStore.getState().study.name || 'Vessel damage'}</div>
            {p.subtitle && <div className="text-[15px] text-ink-2">{p.subtitle}</div>}
          </div>
        </div>
        <div className="text-right">
          <div className="text-[17px] font-semibold text-ink">{sceneTitle}</div>
          {scene >= 0 && (
            <div className="tabular text-[12.5px] text-ink-2">
              Scene {scene + 1} of {p.scenes.length}
            </div>
          )}
        </div>
      </div>
      <div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-4 px-8 pb-5">
        <div className="text-[12px] text-ink-2">
          {p.footer}
          {p.footer && ' · '}
          {new Date().toLocaleDateString()}
        </div>
        <div className={cx('pointer-events-auto flex items-center gap-1 rounded-full border border-line bg-surface/90 p-1 shadow-pop backdrop-blur transition-opacity', idle && 'opacity-0')}>
          <button
            type="button"
            aria-label="Previous"
            className="flex h-9 w-9 items-center justify-center rounded-full text-ink hover:bg-sunken"
            onClick={() => (p.scenes.length ? goScene(scene - 1) : stepVessel(-1))}
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <button
            type="button"
            aria-label={rotating ? 'Stop rotating' : 'Rotate'}
            className="flex h-9 w-9 items-center justify-center rounded-full text-ink hover:bg-sunken"
            onClick={() => setRotating((r) => !r)}
          >
            {rotating ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
          </button>
          <button
            type="button"
            aria-label="Next"
            className="flex h-9 w-9 items-center justify-center rounded-full text-ink hover:bg-sunken"
            onClick={() => (p.scenes.length ? goScene(scene + 1) : stepVessel(1))}
          >
            <ChevronRight className="h-5 w-5" />
          </button>
          <span className="mx-1 h-5 w-px bg-line" />
          <button type="button" className="flex h-9 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium text-ink hover:bg-sunken" onClick={stopPresentation}>
            <X className="h-4 w-4" /> Exit
          </button>
        </div>
        <div className={cx('hidden text-right text-[11.5px] text-muted transition-opacity md:block', idle && 'opacity-0')}>
          ← → {p.scenes.length ? 'scenes' : 'vessels'} · Space rotate · click a location for images · Esc exit
        </div>
      </div>
    </div>
  );
}
