import { useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, Info, Upload, X, XCircle } from 'lucide-react';
import { filesFromDrop, pickFiles } from '../lib/files';

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(' ');
}

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'soft';
type Size = 'xs' | 'sm' | 'md' | 'lg';

const variants: Record<Variant, string> = {
  primary: 'bg-accent text-accent-ink hover:bg-accent-hover border border-transparent shadow-sm',
  secondary: 'bg-surface-2 text-ink border border-line hover:border-line-strong hover:bg-sunken',
  ghost: 'bg-transparent text-ink-2 border border-transparent hover:bg-sunken hover:text-ink',
  danger: 'bg-transparent text-critical-ink border border-line hover:bg-critical-soft hover:border-critical',
  soft: 'bg-accent-soft text-accent-soft-ink border border-transparent hover:brightness-95',
};
const sizes: Record<Size, string> = {
  xs: 'h-6 px-2 text-[12px] gap-1 rounded-md',
  sm: 'h-7 px-2.5 text-[12.5px] gap-1.5 rounded-md',
  md: 'h-8 px-3 text-[13px] gap-1.5 rounded-md',
  lg: 'h-10 px-4 text-[14px] gap-2 rounded-lg',
};

export function Button({
  variant = 'secondary',
  size = 'md',
  icon,
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size; icon?: ReactNode }) {
  return (
    <button
      type="button"
      {...rest}
      className={cx(
        'inline-flex shrink-0 items-center justify-center font-medium whitespace-nowrap transition-colors select-none disabled:opacity-45',
        variants[variant],
        sizes[size],
        className,
      )}
    >
      {icon}
      {children}
    </button>
  );
}

export function Tip({ label, children, side = 'bottom', className }: { label: ReactNode; children: ReactNode; side?: 'top' | 'bottom' | 'left' | 'right'; className?: string }) {
  const pos = {
    top: 'bottom-full left-1/2 -translate-x-1/2 mb-1.5',
    bottom: 'top-full left-1/2 -translate-x-1/2 mt-1.5',
    left: 'right-full top-1/2 -translate-y-1/2 mr-1.5',
    right: 'left-full top-1/2 -translate-y-1/2 ml-1.5',
  }[side];
  return (
    <span className={cx('group/tip relative inline-flex', className)}>
      {children}
      <span
        role="tooltip"
        className={cx(
          'pointer-events-none absolute z-50 hidden w-max max-w-[240px] rounded-md bg-[#1a1a19] px-2 py-1 text-[11.5px] leading-snug font-medium text-white shadow-lg group-hover/tip:block group-has-[:focus-visible]/tip:block dark:bg-[#f0efec] dark:text-[#0b0b0b]',
          pos,
        )}
      >
        {label}
      </span>
    </span>
  );
}

export function IconButton({
  label,
  side = 'bottom',
  active,
  className,
  children,
  size = 'md',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; side?: 'top' | 'bottom' | 'left' | 'right'; active?: boolean; size?: 'sm' | 'md' }) {
  return (
    <Tip label={label} side={side}>
      <button
        type="button"
        aria-label={label}
        aria-pressed={active}
        {...rest}
        className={cx(
          'inline-flex items-center justify-center rounded-md border transition-colors disabled:opacity-40',
          size === 'sm' ? 'h-7 w-7' : 'h-8 w-8',
          active
            ? 'border-transparent bg-accent-soft text-accent-soft-ink'
            : 'border-transparent text-ink-2 hover:bg-sunken hover:text-ink',
          className,
        )}
      >
        {children}
      </button>
    </Tip>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  size = 'md',
  className,
  label,
}: {
  value: T;
  options: { value: T; label: ReactNode; title?: string; disabled?: boolean }[];
  onChange: (v: T) => void;
  size?: 'sm' | 'md';
  className?: string;
  label?: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className={cx('inline-flex rounded-lg border border-line bg-sunken p-0.5', className)}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          title={o.title}
          disabled={o.disabled}
          onClick={() => onChange(o.value)}
          className={cx(
            'inline-flex flex-1 items-center justify-center gap-1.5 rounded-md font-medium whitespace-nowrap transition-colors disabled:opacity-40',
            size === 'sm' ? 'h-6 px-2 text-[12px]' : 'h-7 px-2.5 text-[12.5px]',
            value === o.value ? 'bg-surface-2 text-ink shadow-sm' : 'text-ink-2 hover:text-ink',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Switch({
  checked,
  onChange,
  label,
  description,
  disabled,
  inline,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
  /** Switch before a short label, for rows of options. */
  inline?: boolean;
}) {
  const id = useId();
  if (inline) {
    return (
      <span className={cx('inline-flex items-center gap-2 py-1', disabled && 'opacity-50')}>
        <button
          id={id}
          type="button"
          role="switch"
          aria-checked={checked}
          disabled={disabled}
          onClick={() => onChange(!checked)}
          className={cx('relative inline-flex h-[18px] w-8 shrink-0 items-center rounded-full transition-colors', checked ? 'bg-accent' : 'bg-line-strong')}
        >
          <span className={cx('inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform', checked ? 'translate-x-[15px]' : 'translate-x-[2px]')} />
        </button>
        <label htmlFor={id} className="cursor-pointer text-[13px] text-ink">
          {label}
        </label>
      </span>
    );
  }
  return (
    <div className={cx('flex items-start justify-between gap-3 py-1', disabled && 'opacity-50')}>
      <label htmlFor={id} className="min-w-0 cursor-pointer">
        <span className="block text-[13px] text-ink">{label}</span>
        {description && <span className="block text-[12px] leading-snug text-muted">{description}</span>}
      </label>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cx(
          'relative mt-0.5 inline-flex h-[18px] w-8 shrink-0 items-center rounded-full transition-colors',
          checked ? 'bg-accent' : 'bg-line-strong',
        )}
      >
        <span
          className={cx(
            'inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform',
            checked ? 'translate-x-[15px]' : 'translate-x-[2px]',
          )}
        />
      </button>
    </div>
  );
}

export function Slider({
  value,
  min,
  max,
  step = 1,
  onChange,
  label,
  format,
  id,
}: {
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  label?: ReactNode;
  format?: (v: number) => string;
  id?: string;
}) {
  const autoId = useId();
  const fid = id ?? autoId;
  const fill = ((value - min) / (max - min || 1)) * 100;
  return (
    <div>
      {label && (
        <div className="mb-0.5 flex items-center justify-between">
          <label htmlFor={fid} className="text-[12px] font-medium text-ink-2">
            {label}
          </label>
          <span className="tabular text-[12px] text-ink">{format ? format(value) : value}</span>
        </div>
      )}
      <input
        id={fid}
        type="range"
        className="range"
        min={min}
        max={max}
        step={step}
        value={value}
        style={{ ['--fill' as string]: `${fill}%` }}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
  );
}

export function Field({ label, hint, children, htmlFor }: { label: ReactNode; hint?: ReactNode; children: ReactNode; htmlFor?: string }) {
  return (
    <div>
      <label className="label" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {hint && <p className="mt-1 text-[11.5px] leading-snug text-muted">{hint}</p>}
    </div>
  );
}

export function Callout({
  kind = 'info',
  title,
  children,
  action,
  className,
}: {
  kind?: 'info' | 'success' | 'warning' | 'error';
  title?: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  const styles = {
    info: 'bg-accent-soft border-transparent text-ink',
    success: 'bg-good-soft border-transparent text-ink',
    warning: 'bg-warning-soft border-transparent text-ink',
    error: 'bg-critical-soft border-transparent text-ink',
  }[kind];
  const Icon = { info: Info, success: CheckCircle2, warning: AlertTriangle, error: XCircle }[kind];
  const iconColor = {
    info: 'text-accent-soft-ink',
    success: 'text-good-ink',
    warning: 'text-warning-ink',
    error: 'text-critical-ink',
  }[kind];
  return (
    <div className={cx('flex gap-2.5 rounded-lg border px-3 py-2.5 text-[12.5px] leading-snug', styles, className)}>
      <Icon className={cx('mt-px h-4 w-4 shrink-0', iconColor)} aria-hidden />
      <div className="min-w-0 flex-1">
        {title && <div className="font-semibold">{title}</div>}
        {children && <div className={cx(title ? 'mt-0.5' : null, 'text-ink-2')}>{children}</div>}
        {action && <div className="mt-2">{action}</div>}
      </div>
    </div>
  );
}

export function Badge({ children, tone = 'neutral', className }: { children: ReactNode; tone?: 'neutral' | 'accent' | 'good' | 'warning' | 'critical'; className?: string }) {
  const t = {
    neutral: 'bg-sunken text-ink-2',
    accent: 'bg-accent-soft text-accent-soft-ink',
    good: 'bg-good-soft text-good-ink',
    warning: 'bg-warning-soft text-warning-ink',
    critical: 'bg-critical-soft text-critical-ink',
  }[tone];
  return <span className={cx('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium', t, className)}>{children}</span>;
}

export function Progress({ value, className }: { value: number | null; className?: string }) {
  return (
    <div className={cx('h-1.5 w-full overflow-hidden rounded-full bg-line', className)} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={value === null ? undefined : Math.round(value * 100)}>
      {value === null ? (
        <div className="h-full w-1/3 animate-[indeterminate_1.2s_ease-in-out_infinite] rounded-full bg-accent" />
      ) : (
        <div className="h-full rounded-full bg-accent transition-[width] duration-300" style={{ width: `${Math.max(2, value * 100)}%` }} />
      )}
    </div>
  );
}

export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  width = 560,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
      className="m-auto max-h-[min(88vh,900px)] w-[calc(100vw-24px)] overflow-hidden rounded-xl border border-line bg-surface p-0 shadow-pop"
      style={{ maxWidth: width }}
    >
      {open && (
        <div className="flex max-h-[min(88vh,900px)] flex-col">
          <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
            <div>
              <h2 className="text-[16px] font-semibold text-ink">{title}</h2>
              {description && <p className="mt-0.5 text-[12.5px] text-muted">{description}</p>}
            </div>
            <IconButton label="Close" onClick={onClose} side="left">
              <X className="h-4 w-4" />
            </IconButton>
          </div>
          <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
          {footer && <div className="flex items-center justify-end gap-2 border-t border-line bg-sunken/50 px-5 py-3">{footer}</div>}
        </div>
      )}
    </dialog>
  );
}

export function Dropzone({
  onFiles,
  accept,
  multiple = true,
  directory = false,
  title,
  hint,
  icon,
  compact,
  children,
}: {
  onFiles: (files: File[]) => void;
  accept?: string;
  multiple?: boolean;
  directory?: boolean;
  title: ReactNode;
  hint?: ReactNode;
  icon?: ReactNode;
  compact?: boolean;
  children?: ReactNode;
}) {
  const [over, setOver] = useState(false);
  return (
    <div
      role="button"
      tabIndex={0}
      data-dropzone=""
      onClick={async () => {
        const files = await pickFiles({ accept, multiple });
        if (files.length) onFiles(files);
      }}
      onKeyDown={async (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          const files = await pickFiles({ accept, multiple });
          if (files.length) onFiles(files);
        }
      }}
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={async (e) => {
        e.preventDefault();
        setOver(false);
        const files = await filesFromDrop(e.dataTransfer);
        if (files.length) onFiles(files);
      }}
      className={cx(
        'group flex cursor-pointer flex-col items-center justify-center rounded-xl border-[1.5px] border-dashed text-center transition-colors',
        compact ? 'gap-1 px-3 py-3' : 'gap-1.5 px-4 py-6',
        over ? 'border-accent bg-accent-soft' : 'border-line-strong bg-surface-2 hover:border-accent hover:bg-accent-soft/40',
      )}
    >
      <span className={cx('flex items-center justify-center rounded-full bg-accent-soft text-accent-soft-ink', compact ? 'h-7 w-7' : 'h-9 w-9')}>
        {icon ?? <Upload className="h-4 w-4" />}
      </span>
      <span className="text-[13px] font-medium text-ink">{title}</span>
      {hint && <span className="text-[11.5px] leading-snug text-muted">{hint}</span>}
      {directory && (
        <button
          type="button"
          className="mt-1 text-[12px] font-medium text-accent hover:underline"
          onClick={async (e) => {
            e.stopPropagation();
            const files = await pickFiles({ directory: true, multiple: true });
            if (files.length) onFiles(files);
          }}
        >
          or choose a whole folder
        </button>
      )}
      {children}
    </div>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="kbd">{children}</kbd>;
}

export function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="rounded-lg border border-line bg-surface-2 px-3 py-2">
      <div className="text-[11.5px] text-muted">{label}</div>
      <div className="mt-0.5 text-[17px] leading-tight font-semibold text-ink">{value}</div>
      {sub && <div className="mt-0.5 text-[11px] text-muted">{sub}</div>}
    </div>
  );
}

export function Swatch({ color, className }: { color: string; className?: string }) {
  return <span aria-hidden className={cx('inline-block h-2.5 w-2.5 shrink-0 rounded-[3px]', className)} style={{ background: color }} />;
}
