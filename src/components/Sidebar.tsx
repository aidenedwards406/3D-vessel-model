import { useMemo } from 'react';
import { AlertTriangle, Check, ChevronDown, Download, Lock, Presentation, Save } from 'lucide-react';
import { goToStep } from '../state/actions';
import { set, useStore } from '../state/store';
import { startPresentation } from './TopBar';
import { CompareStep, ExploreStep, StatsStep } from './steps/AnalyzeSteps';
import { DamageStep } from './steps/DamageStep';
import { ImagesStep } from './steps/ImagesStep';
import { stepMeta, type StepMeta } from './steps/meta';
import { ModelStep } from './steps/ModelStep';
import { SectionsStep } from './steps/SectionsStep';
import { TreatmentsStep } from './steps/TreatmentsStep';
import { cx } from './ui';

const PANELS = {
  model: ModelStep,
  sections: SectionsStep,
  images: ImagesStep,
  damage: DamageStep,
  treatments: TreatmentsStep,
  explore: ExploreStep,
  compare: CompareStep,
  stats: StatsStep,
} as const;

function StatusBadge({ meta, active }: { meta: StepMeta; active: boolean }) {
  if (meta.status === 'done')
    return (
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-good text-white" aria-label="Done">
        <Check className="h-3.5 w-3.5" strokeWidth={3} />
      </span>
    );
  if (meta.status === 'attention')
    return (
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-warning text-[#0b0b0b]" aria-label="Needs attention">
        <AlertTriangle className="h-3.5 w-3.5" strokeWidth={2.5} />
      </span>
    );
  return (
    <span
      className={cx(
        'tabular flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-[12px] font-semibold',
        active ? 'border-accent bg-accent text-accent-ink' : 'border-line-strong text-ink-2',
      )}
    >
      {meta.n}
    </span>
  );
}

function StepItem({ meta, active }: { meta: StepMeta; active: boolean }) {
  const Panel = PANELS[meta.id];
  const locked = meta.status === 'locked';
  return (
    <li className={cx('border-b border-line/70', active && 'bg-surface-2')}>
      <button
        type="button"
        onClick={() => (active ? undefined : goToStep(meta.id))}
        aria-expanded={active}
        aria-current={active ? 'step' : undefined}
        disabled={locked}
        className={cx(
          'flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors disabled:cursor-not-allowed',
          !active && 'hover:bg-sunken',
          locked && 'opacity-55',
        )}
      >
        <StatusBadge meta={meta} active={active} />
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline gap-2">
            <span className={cx('text-[13.5px] font-semibold', active ? 'text-ink' : 'text-ink')}>{meta.title}</span>
            <span className="text-[10.5px] font-medium whitespace-nowrap text-muted">{meta.phase}</span>
          </span>
          <span className="block truncate text-[12px] text-ink-2">{locked ? 'Load a model first' : meta.summary}</span>
        </span>
        <ChevronDown className={cx('h-4 w-4 shrink-0 text-muted transition-transform', active && 'rotate-180')} />
      </button>
      {active && (
        <div className="animate-fade-in px-4 pt-1 pb-4">
          <Panel />
        </div>
      )}
    </li>
  );
}

export function Sidebar() {
  const state = useStore();
  const steps = useMemo(() => stepMeta(state), [state]);
  const ready = state.model.status === 'ready';
  return (
    <>
      {state.sidebarOpen && (
        <div className="fixed inset-x-0 top-12 bottom-0 z-30 bg-black/30 md:hidden" onClick={() => set({ sidebarOpen: false })} aria-hidden />
      )}
      <aside
        aria-label="Study steps"
        className={cx(
          'flex w-[352px] shrink-0 flex-col border-r border-line bg-surface',
          'max-md:fixed max-md:top-12 max-md:bottom-0 max-md:left-0 max-md:z-40 max-md:w-[min(360px,92vw)] max-md:shadow-pop',
          !state.sidebarOpen && 'max-md:hidden',
        )}
      >
        <div className="scroll-thin flex-1 overflow-y-auto">
          {(['setup', 'analyze'] as const).map((group) => (
            <section key={group}>
              <h2 className="px-4 pt-4 pb-1.5 text-[11px] font-semibold tracking-wider text-muted uppercase">
                {group === 'setup' ? 'Set up the study' : 'Analyse'}
              </h2>
              <ol>
                {steps
                  .filter((m) => m.group === group)
                  .map((m) => (
                    <StepItem key={m.id} meta={m} active={state.step === m.id} />
                  ))}
              </ol>
            </section>
          ))}
          <section className="px-4 pt-4 pb-5">
            <h2 className="pb-2 text-[11px] font-semibold tracking-wider text-muted uppercase">Share</h2>
            <div className="grid grid-cols-3 gap-2">
              {[
                { icon: Save, label: 'Save', phase: 'Phase 7', run: () => set({ dialog: 'save' }), disabled: false },
                { icon: Presentation, label: 'Present', phase: 'Phase 8', run: startPresentation, disabled: !ready },
                { icon: Download, label: 'Export', phase: 'Phase 9', run: () => set({ dialog: 'export' }), disabled: !ready },
              ].map((a) => (
                <button
                  key={a.label}
                  type="button"
                  disabled={a.disabled}
                  onClick={a.run}
                  className="flex flex-col items-center gap-1 rounded-lg border border-line bg-surface-2 px-2 py-2.5 text-ink transition-colors hover:border-accent hover:bg-accent-soft/50 disabled:opacity-45 disabled:hover:border-line disabled:hover:bg-surface-2"
                >
                  <a.icon className="h-4 w-4 text-accent" />
                  <span className="text-[12.5px] font-medium">{a.label}</span>
                  <span className="text-[10px] text-muted">{a.phase}</span>
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => set({ dialog: 'privacy' })}
              className="mt-3 flex w-full items-start gap-2 rounded-lg bg-good-soft px-3 py-2 text-left text-[11.5px] leading-snug text-ink-2"
            >
              <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-good-ink" />
              <span>
                Files are opened in this browser and never uploaded. No AI is used. <span className="font-medium text-good-ink">How it works</span>
              </span>
            </button>
          </section>
        </div>
      </aside>
    </>
  );
}
