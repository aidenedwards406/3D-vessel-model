import { useEffect, useRef, useState } from 'react';
import { Book, BookOpen } from 'lucide-react';
import { setOpening, toggleOpening } from '../state/actions';
import { useStore } from '../state/store';
import { cx, Tip } from './ui';

/** Positions the slider snaps to when let go nearby: closed, half open (90°), fully open (180°). */
const SNAPS = [0, 0.5, 1];

function useIdle(ms: number, enabled: boolean) {
  const [idle, setIdle] = useState(false);
  useEffect(() => {
    if (!enabled) {
      setIdle(false);
      return;
    }
    let timer: number | undefined;
    const wake = () => {
      setIdle(false);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setIdle(true), ms);
    };
    window.addEventListener('pointermove', wake);
    window.addEventListener('keydown', wake);
    wake();
    return () => {
      window.removeEventListener('pointermove', wake);
      window.removeEventListener('keydown', wake);
      window.clearTimeout(timer);
    };
  }, [ms, enabled]);
  return idle;
}

function describe(deg: number) {
  return deg === 0 ? 'Closed' : deg === 180 ? 'Fully open, 180°' : `Open ${deg}°`;
}

/**
 * Vertical slider on the right of the 3D view that opens the vessel lengthways like a book:
 * drag up to lift the top half away from the bottom half, down to close it again.
 * Also: click the ends, ↑/↓ or Home/End when focused, and O anywhere to open or close.
 */
export function OpenSlider({ disabledReason }: { disabledReason: string | null }) {
  const amount = useStore((s) => s.opening.amount);
  const presenting = useStore((s) => s.presenting);
  const disabled = disabledReason !== null;
  const railRef = useRef<HTMLDivElement>(null);
  const pressed = useRef(false);
  const [dragging, setDragging] = useState(false);
  const idle = useIdle(2600, presenting && !dragging);
  const deg = Math.round(amount * 180);

  // The thumb eases to a new position at the same pace as the vessel (see VesselEngine.startOpenTween).
  const prev = useRef(amount);
  const duration = dragging ? 0 : Math.round(260 + 640 * Math.abs(amount - prev.current));
  useEffect(() => {
    prev.current = amount;
  }, [amount]);

  const disabledRef = useRef(disabled);
  disabledRef.current = disabled;
  // O opens or closes the vessel from anywhere (the image viewer keeps O for its outline).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'o' && e.key !== 'O') return;
      if (e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      if (document.querySelector('dialog[open]') || useStore.getState().lightbox || disabledRef.current) return;
      e.preventDefault();
      toggleOpening();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const valueAt = (clientY: number) => {
    const r = railRef.current!.getBoundingClientRect();
    return Math.max(0, Math.min(1, (r.bottom - clientY) / Math.max(1, r.height)));
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (disabled || e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    e.currentTarget.focus({ preventScroll: true });
    pressed.current = true;
    const v = valueAt(e.clientY);
    // A click away from the thumb eases there; dragging then takes over.
    setOpening(v, { motion: Math.abs(v - useStore.getState().opening.amount) > 0.04 ? 'animate' : 'drag' });
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!pressed.current) return;
    if (!dragging) setDragging(true);
    setOpening(valueAt(e.clientY), { motion: 'drag' });
  };
  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!pressed.current) return;
    pressed.current = false;
    setDragging(false);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    const v = useStore.getState().opening.amount;
    const snap = SNAPS.find((x) => Math.abs(v - x) < 0.03);
    if (snap !== undefined && snap !== v) setOpening(snap, { motion: 'animate' });
  };
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    const cur = useStore.getState().opening.amount;
    const stepSize = e.shiftKey ? 0.25 : 1 / 18; // 10° (45° with Shift)
    let next: number | null = null;
    if (e.key === 'ArrowUp') next = cur + stepSize;
    else if (e.key === 'ArrowDown') next = cur - stepSize;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = 1;
    if (next === null) return; // ← → stay with switching vessels / scenes
    e.preventDefault();
    e.stopPropagation();
    setOpening(Math.round(Math.max(0, Math.min(1, next)) * 180) / 180, { motion: 'animate' });
  };

  const ease = `${duration}ms cubic-bezier(0.65, 0, 0.35, 1)`;
  return (
    <div
      className={cx(
        'pointer-events-auto flex max-h-full w-11 flex-col items-center rounded-xl border border-line bg-surface/92 py-1 shadow-card backdrop-blur transition-opacity duration-300',
        idle ? 'opacity-0' : disabled && 'opacity-60',
      )}
      data-testid="open-slider"
    >
      <Tip label={disabled ? disabledReason : 'Open the vessel fully (O)'} side="left">
        <button
          type="button"
          disabled={disabled}
          aria-label="Open the vessel fully"
          onClick={() => setOpening(1, { motion: 'animate' })}
          className={cx(
            'flex w-10 flex-col items-center gap-0.5 rounded-lg py-1 transition-colors disabled:cursor-not-allowed',
            deg === 180 ? 'text-accent' : 'text-ink-2 hover:bg-sunken hover:text-ink',
          )}
        >
          <BookOpen className="h-4 w-4" aria-hidden />
          <span className="text-[10px] leading-none font-semibold">Open</span>
        </button>
      </Tip>

      <div
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-label="Open the vessel lengthways: drag up to separate the top and bottom halves"
        aria-orientation="vertical"
        aria-valuemin={0}
        aria-valuemax={180}
        aria-valuenow={deg}
        aria-valuetext={describe(deg)}
        aria-disabled={disabled || undefined}
        title={disabled ? disabledReason : undefined}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onKeyDown={onKeyDown}
        className={cx(
          'group relative my-1 flex h-[220px] min-h-[64px] w-10 shrink touch-none justify-center rounded-lg py-[11px] outline-none select-none',
          disabled ? 'cursor-not-allowed' : dragging ? 'cursor-grabbing' : 'cursor-pointer',
        )}
      >
        <div ref={railRef} className="relative h-full w-1 rounded-full bg-line-strong">
          {/* Halfway mark (90°) */}
          <span className="absolute top-1/2 left-1/2 h-px w-3 -translate-x-1/2 bg-line-strong" aria-hidden />
          <div
            className="absolute inset-x-0 bottom-0 rounded-full bg-accent"
            style={{ height: `${amount * 100}%`, transition: dragging ? 'none' : `height ${ease}` }}
          />
          <div
            className={cx(
              'absolute left-1/2 h-[18px] w-[18px] -translate-x-1/2 translate-y-1/2 rounded-full border-2 border-accent bg-surface-2 shadow-[0_1px_3px_rgba(0,0,0,0.3)]',
              'group-focus-visible:ring-2 group-focus-visible:ring-[var(--ring)]',
              dragging && 'scale-110',
            )}
            style={{ bottom: `${amount * 100}%`, transition: dragging ? 'none' : `bottom ${ease}` }}
          >
            <span
              className={cx(
                'tabular pointer-events-none absolute top-1/2 right-full mr-2.5 -translate-y-1/2 rounded-md bg-[#1a1a19] px-1.5 py-0.5 text-[11px] font-semibold whitespace-nowrap text-white opacity-0 shadow-lg transition-opacity dark:bg-[#f0efec] dark:text-[#0b0b0b]',
                !disabled && 'group-hover:opacity-100 group-focus-visible:opacity-100',
                dragging && 'opacity-100',
              )}
              aria-hidden
            >
              {deg === 0 ? 'Closed' : `${deg}°`}
            </span>
          </div>
        </div>
      </div>

      <Tip label={disabled ? disabledReason : 'Close the vessel (O)'} side="left">
        <button
          type="button"
          disabled={disabled}
          aria-label="Close the vessel"
          onClick={() => setOpening(0, { motion: 'animate' })}
          className={cx(
            'flex w-10 flex-col items-center gap-0.5 rounded-lg py-1 transition-colors disabled:cursor-not-allowed',
            deg === 0 ? 'text-accent' : 'text-ink-2 hover:bg-sunken hover:text-ink',
          )}
        >
          <Book className="h-4 w-4" aria-hidden />
          <span className="text-[10px] leading-none font-semibold">Closed</span>
        </button>
      </Tip>
    </div>
  );
}
