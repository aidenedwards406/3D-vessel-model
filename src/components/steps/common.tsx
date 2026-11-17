import type { ReactNode } from 'react';
import { ArrowRight, Minus, Plus } from 'lucide-react';
import { goToStep } from '../../state/actions';
import type { StepId } from '../../state/store';
import { Button, cx } from '../ui';

export function NextButton({ to, children }: { to: StepId; children: ReactNode }) {
  return (
    <Button variant="primary" className="mt-4 w-full" onClick={() => goToStep(to)}>
      {children}
      <ArrowRight className="h-4 w-4" />
    </Button>
  );
}

export function Stepper({
  value,
  min,
  max,
  onChange,
  label,
}: {
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
  label: string;
}) {
  return (
    <div className="inline-flex items-center rounded-md border border-line bg-surface-2">
      <button
        type="button"
        aria-label={`Fewer ${label}`}
        disabled={value <= min}
        onClick={() => onChange(Math.max(min, value - 1))}
        className="flex h-8 w-8 items-center justify-center text-ink-2 hover:bg-sunken disabled:opacity-40"
      >
        <Minus className="h-3.5 w-3.5" />
      </button>
      <input
        aria-label={label}
        className="tabular h-8 w-10 border-x border-line bg-transparent text-center text-[13px] font-semibold text-ink outline-none"
        value={value}
        inputMode="numeric"
        onChange={(e) => {
          const n = parseInt(e.target.value, 10);
          if (Number.isFinite(n)) onChange(Math.max(min, Math.min(max, n)));
        }}
      />
      <button
        type="button"
        aria-label={`More ${label}`}
        disabled={value >= max}
        onClick={() => onChange(Math.min(max, value + 1))}
        className="flex h-8 w-8 items-center justify-center text-ink-2 hover:bg-sunken disabled:opacity-40"
      >
        <Plus className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

export function KeyValue({ items }: { items: [ReactNode, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[12.5px]">
      {items.map(([k, v], i) => (
        <div key={i} className="contents">
          <dt className="text-muted">{k}</dt>
          <dd className="tabular truncate text-right text-ink">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx('rounded-lg border border-line bg-surface-2 p-3', className)}>{children}</div>;
}

export function Help({ children }: { children: ReactNode }) {
  return <p className="text-[12.5px] leading-relaxed text-ink-2">{children}</p>;
}
