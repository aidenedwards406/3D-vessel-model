import { DIVERGING_STOPS, niceTicks, quantize, sampleHex, sectionColor } from '../lib/colormaps';
import type { Scale } from '../state/derived';
import { cx } from './ui';

function gradientCss(stops: string[], steps: number): string {
  if (steps >= 2) {
    const parts: string[] = [];
    for (let i = 0; i < steps; i++) {
      const c = sampleHex(stops, quantize((i + 0.5) / steps, steps));
      parts.push(`${c} ${(i / steps) * 100}%`, `${c} ${((i + 1) / steps) * 100}%`);
    }
    return `linear-gradient(to right, ${parts.join(', ')})`;
  }
  return `linear-gradient(to right, ${stops.join(', ')})`;
}

export function HeatLegend({
  scale,
  title = 'Damage (%)',
  className,
  showNoData = true,
  width = 200,
}: {
  scale: Scale;
  title?: string;
  className?: string;
  showNoData?: boolean;
  width?: number;
}) {
  const ticks = niceTicks(scale.min, scale.max, 5).filter((t) => t >= scale.min - 1e-9 && t <= scale.max + 1e-9);
  const span = scale.max - scale.min || 1;
  return (
    <div className={cx('rounded-lg border border-line bg-surface/92 px-3 py-2 shadow-card backdrop-blur', className)}>
      <div className="mb-1.5 text-[11.5px] font-semibold text-ink">{title}</div>
      <div className="flex items-end gap-3">
        <div style={{ width }}>
          <div className="h-2.5 rounded-sm" style={{ background: gradientCss(scale.stops, scale.steps) }} />
          <div className="relative mt-1 h-3.5">
            {ticks.map((t) => (
              <span
                key={t}
                className="tabular absolute -translate-x-1/2 text-[10.5px] text-ink-2"
                style={{ left: `${((t - scale.min) / span) * 100}%` }}
              >
                {+t.toFixed(2)}
              </span>
            ))}
          </div>
        </div>
        {showNoData && (
          <div className="flex items-center gap-1.5 pb-[18px]">
            <span className="hatch inline-block h-2.5 w-4 rounded-sm" aria-hidden />
            <span className="text-[11px] text-ink-2">No image</span>
          </div>
        )}
      </div>
    </div>
  );
}

export function DiffLegend({ max, className }: { max: number; className?: string }) {
  return (
    <HeatLegend
      className={className}
      title="Difference in damage (percentage points)"
      scale={{ min: -max, max, stops: DIVERGING_STOPS, steps: 0 }}
      showNoData
    />
  );
}

export function SectionLegend({ count, className }: { count: number; className?: string }) {
  return (
    <div className={cx('rounded-lg border border-line bg-surface/92 px-3 py-2 shadow-card backdrop-blur', className)}>
      <div className="mb-1.5 text-[11.5px] font-semibold text-ink">Sections</div>
      <div className="flex items-center gap-0.5">
        {Array.from({ length: count }, (_v, i) => (
          <div key={i} className="flex flex-col items-center">
            <span className="h-2.5 w-7 rounded-sm" style={{ background: sectionColor(i, count) }} />
            <span className="tabular mt-0.5 text-[10.5px] text-ink-2">{i + 1}</span>
          </div>
        ))}
      </div>
      <div className="mt-1 flex items-center justify-between gap-4 text-[10.5px] text-muted">
        <span>Proximal</span>
        <span>Distal</span>
      </div>
      <div className="mt-1.5 flex items-center gap-3 text-[11px] text-ink-2">
        <span className="flex items-center gap-1">
          <span className="h-2.5 w-3 rounded-sm" style={{ background: sectionColor(1, 3) }} /> Top
        </span>
        <span className="flex items-center gap-1">
          <span className="h-2.5 w-3 rounded-sm opacity-60" style={{ background: '#c7cdd6' }} /> Bottom (lighter)
        </span>
      </div>
    </div>
  );
}
