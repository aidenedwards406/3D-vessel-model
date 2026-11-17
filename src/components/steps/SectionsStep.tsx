import { ArrowLeftRight, Minus, Plus, RotateCcw, Undo2 } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { equalBoundaries, positionList, sectionPositionsFor, type SectionPositions } from '../../lib/regions';
import { setCenterlineMode } from '../../state/actions';
import { getPositionMismatches, useDerived, useLayout } from '../../state/derived';
import { set, update, useStore } from '../../state/store';
import { Button, Callout, Field, IconButton, Segmented, Slider, Switch, cx } from '../ui';
import { Help, NextButton, Stepper } from './common';

const PRESETS: { label: string; sp: SectionPositions | null }[] = [
  { label: 'Match file names', sp: null },
  { label: 'P · M · D', sp: { p: true, medial: 1, d: true } },
  { label: 'P · M1 · M2 · D', sp: { p: true, medial: 2, d: true } },
  { label: 'P · D', sp: { p: true, medial: 0, d: true } },
];

function setSectionPositions(index: number | 'all', sp: SectionPositions | null) {
  update((s) => {
    const arr = [...(s.sections.sectionPositions ?? [])];
    while (arr.length < s.sections.count) arr.push(null);
    if (index === 'all') for (let i = 0; i < s.sections.count; i++) arr[i] = sp ? { ...sp } : null;
    else arr[index] = sp;
    return { sections: { ...s.sections, sectionPositions: arr } };
  });
}

function ToggleChip({ on, label, title, disabled, onClick }: { on: boolean; label: string; title: string; disabled?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={cx(
        'h-7 w-8 rounded-md border font-mono text-[12px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40',
        on ? 'border-accent bg-accent text-accent-ink' : 'border-line bg-surface-2 text-muted line-through hover:text-ink',
      )}
    >
      {label}
    </button>
  );
}

/** Per-section choice of positions: P on/off, number of medial positions, D on/off. */
function SectionPositionsEditor() {
  const sections = useStore((s) => s.sections);
  const d = useDerived();
  const mismatches = useStore(useShallow(getPositionMismatches));
  const count = Math.max(1, Math.min(24, Math.round(sections.count)));
  const rows = Array.from({ length: count }, (_v, i) => sectionPositionsFor(sections, i, d.medialBySection));
  const anyCustom = rows.some((r) => r.custom);

  const fixMismatches = () => {
    const needed = new Map<number, string[]>();
    for (const m of mismatches) needed.set(m.section, [...(needed.get(m.section) ?? []), m.position]);
    for (const [section, positions] of needed) {
      const { sp } = sectionPositionsFor(useStore.getState().sections, section - 1, d.medialBySection);
      const next = { ...sp };
      for (const p of positions) {
        if (p === 'P') next.p = true;
        else if (p === 'D') next.d = true;
        else next.medial = Math.max(next.medial, parseInt(p.slice(1), 10) || 1);
      }
      setSectionPositions(section - 1, next);
    }
  };

  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="label mb-0">Positions in each section</span>
        <select
          className="field h-7 w-auto text-[12px]"
          aria-label="Set every section"
          value=""
          onChange={(e) => {
            const preset = PRESETS[Number(e.target.value)];
            if (preset) setSectionPositions('all', preset.sp);
          }}
        >
          <option value="" disabled>
            Set all sections…
          </option>
          {PRESETS.map((p, i) => (
            <option key={p.label} value={i}>
              {p.label}
            </option>
          ))}
        </select>
      </div>
      <p className="mb-2 text-[11.5px] leading-snug text-muted">
        Turn proximal (P) and distal (D) on or off and choose how many medial positions (M) each section was imaged at. Sections marked “auto” follow your
        file names.
      </p>
      <ul className="space-y-1.5">
        {rows.map(({ sp, custom }, i) => {
          const list = positionList(sp);
          const only = list.length === 1;
          return (
            <li key={i} className="rounded-lg border border-line bg-surface-2 px-2 py-1.5">
              <div className="flex items-center gap-1.5">
                <span className="tabular w-[62px] shrink-0 text-[12.5px] font-semibold text-ink">Section {i + 1}</span>
                <ToggleChip
                  on={sp.p}
                  label="P"
                  title={sp.p ? 'Proximal position included. Click to remove.' : 'No proximal position. Click to add.'}
                  disabled={sp.p && only}
                  onClick={() => setSectionPositions(i, { ...sp, p: !sp.p })}
                />
                <div className="flex h-7 items-center rounded-md border border-line bg-surface">
                  <button
                    type="button"
                    aria-label={`Fewer medial positions in section ${i + 1}`}
                    disabled={sp.medial === 0 || (only && sp.medial === 1)}
                    onClick={() => setSectionPositions(i, { ...sp, medial: sp.medial - 1 })}
                    className="flex h-full w-6 items-center justify-center text-ink-2 hover:bg-sunken disabled:opacity-35"
                  >
                    <Minus className="h-3 w-3" />
                  </button>
                  <span className="tabular min-w-[44px] text-center font-mono text-[12px] font-semibold text-ink" title="Medial positions">
                    {sp.medial === 0 ? 'no M' : sp.medial === 1 ? 'M' : `M×${sp.medial}`}
                  </span>
                  <button
                    type="button"
                    aria-label={`More medial positions in section ${i + 1}`}
                    disabled={sp.medial >= 12}
                    onClick={() => setSectionPositions(i, { ...sp, medial: sp.medial + 1 })}
                    className="flex h-full w-6 items-center justify-center text-ink-2 hover:bg-sunken disabled:opacity-35"
                  >
                    <Plus className="h-3 w-3" />
                  </button>
                </div>
                <ToggleChip
                  on={sp.d}
                  label="D"
                  title={sp.d ? 'Distal position included. Click to remove.' : 'No distal position. Click to add.'}
                  disabled={sp.d && only}
                  onClick={() => setSectionPositions(i, { ...sp, d: !sp.d })}
                />
                <span className="ml-auto flex items-center">
                  {custom ? (
                    <IconButton label="Back to auto (match file names)" size="sm" side="left" onClick={() => setSectionPositions(i, null)}>
                      <Undo2 className="h-3.5 w-3.5" />
                    </IconButton>
                  ) : (
                    <span className="rounded bg-sunken px-1.5 py-0.5 text-[10.5px] font-medium text-muted">auto</span>
                  )}
                </span>
              </div>
              <div className="mt-1 flex flex-wrap gap-1 pl-[68px]">
                {list.map((p) => (
                  <span key={p} className="rounded bg-accent-soft px-1.5 py-px font-mono text-[10.5px] font-medium text-accent-soft-ink">
                    {sp.medial === 1 && p === 'M1' ? 'M' : p}
                  </span>
                ))}
              </div>
            </li>
          );
        })}
      </ul>
      {anyCustom && (
        <button type="button" className="mt-1.5 text-[12px] font-medium text-accent hover:underline" onClick={() => setSectionPositions('all', null)}>
          Set every section back to auto
        </button>
      )}
      {mismatches.length > 0 && (
        <Callout
          kind="warning"
          className="mt-2"
          title="Some images use a position their section doesn't have"
          action={
            <Button size="sm" onClick={fixMismatches}>
              Add these positions
            </Button>
          }
        >
          <ul className="mt-0.5">
            {mismatches.map((m) => (
              <li key={`${m.section}${m.position}`}>
                Section {m.section}, {m.position}: {m.count} image{m.count === 1 ? '' : 's'} or value{m.count === 1 ? '' : 's'}
              </li>
            ))}
          </ul>
          <span className="mt-1 block">They aren't shown on the model or included in statistics until the position is added.</span>
        </Callout>
      )}
    </div>
  );
}

export function SectionsStep() {
  const sections = useStore((s) => s.sections);
  const model = useStore((s) => s.model);
  const outlines = useStore((s) => s.heat.outlines);
  const layout = useLayout();
  const d = useDerived();
  const setSec = (patch: Partial<typeof sections>) => update((s) => ({ sections: { ...s.sections, ...patch } }));
  const custom = sections.boundaries !== null;
  const bounds = layout.boundaries;

  return (
    <div className="space-y-4">
      <Help>
        The model is split along its centerline into the sections the vessel was cut into, numbered from proximal to distal. Each section has a
        top and bottom half and proximal, medial and distal positions.
      </Help>

      {d.maxSection > sections.count && (
        <Callout kind="warning" title={`Your data uses sections 1–${d.maxSection}`}>
          The model is split into {sections.count}. Locations in higher sections can't be shown.
          <div className="mt-2">
            <Button size="sm" variant="secondary" onClick={() => setSec({ count: d.maxSection, boundaries: null })}>
              Use {d.maxSection} sections
            </Button>
          </div>
        </Callout>
      )}

      <Field label="Number of sections">
        <div className="flex items-center gap-2">
          <Stepper label="sections" value={sections.count} min={1} max={24} onChange={(count) => setSec({ count, boundaries: null })} />
          {[4, 6].map((n) => (
            <Button key={n} size="sm" variant={sections.count === n ? 'soft' : 'ghost'} onClick={() => setSec({ count: n, boundaries: null })}>
              {n}
            </Button>
          ))}
        </div>
      </Field>

      <Field label="Section lengths">
        <Segmented
          className="w-full"
          value={custom ? 'custom' : 'equal'}
          onChange={(v) => setSec({ boundaries: v === 'custom' ? equalBoundaries(sections.count) : null })}
          options={[
            { value: 'equal', label: 'Equal' },
            { value: 'custom', label: 'Custom' },
          ]}
        />
      </Field>
      {custom && (
        <div className="space-y-2 rounded-lg border border-line bg-surface-2 p-3">
          {bounds.slice(1, -1).map((b, i) => (
            <Slider
              key={i}
              label={`Cut between ${i + 1} and ${i + 2}`}
              min={0}
              max={100}
              step={0.5}
              value={+(b * 100).toFixed(1)}
              format={(v) => `${v.toFixed(1)}%`}
              onChange={(v) => {
                const next = [...bounds];
                const lo = next[i] + 0.01;
                const hi = next[i + 2] - 0.01;
                next[i + 1] = Math.max(lo, Math.min(hi, v / 100));
                setSec({ boundaries: next });
              }}
            />
          ))}
          <p className="text-[11.5px] text-muted">Positions are a percentage of the sectioned length, from the proximal end.</p>
        </div>
      )}

      <SectionPositionsEditor />

      <Field label="Proximal end" hint="Section 1 starts at the proximal end, shown with a label on the model.">
        <Button size="sm" icon={<ArrowLeftRight className="h-3.5 w-3.5" />} onClick={() => setSec({ flip: !sections.flip })}>
          Swap proximal and distal
        </Button>
      </Field>

      <Field label="Top side" hint="Top is the side facing up. Rotate it if your images define top differently.">
        <Slider
          min={-180}
          max={180}
          step={5}
          value={sections.topOffsetDeg}
          format={(v) => `${v > 0 ? '+' : ''}${v}°`}
          onChange={(topOffsetDeg) => setSec({ topOffsetDeg })}
        />
        <div className="mt-1 flex gap-1">
          {[0, 90, 180, -90].map((a) => (
            <Button key={a} size="xs" variant={sections.topOffsetDeg === a ? 'soft' : 'ghost'} onClick={() => setSec({ topOffsetDeg: a })}>
              {a > 0 ? '+' : ''}
              {a}°
            </Button>
          ))}
        </div>
      </Field>

      <Field label="Sectioned length" hint="Leave out connectors or fittings at the ends. Excluded parts are shown plain.">
        <div className="space-y-1">
          <Slider
            label="Start (proximal)"
            min={0}
            max={45}
            step={0.5}
            value={+(sections.trimStart * 100).toFixed(1)}
            format={(v) => `${v.toFixed(1)}%`}
            onChange={(v) => setSec({ trimStart: v / 100 })}
          />
          <Slider
            label="End (distal)"
            min={55}
            max={100}
            step={0.5}
            value={+(sections.trimEnd * 100).toFixed(1)}
            format={(v) => `${v.toFixed(1)}%`}
            onChange={(v) => setSec({ trimEnd: v / 100 })}
          />
        </div>
      </Field>

      <Field label="Centerline" hint="Curved follows bends in tortuous vessels. Straight uses the main axis, which suits straight tubes or messy scans.">
        <Segmented
          className="w-full"
          value={model.centerlineMode}
          onChange={(m) => setCenterlineMode(m)}
          options={[
            { value: 'auto', label: 'Curved (auto)' },
            { value: 'straight', label: 'Straight' },
          ]}
        />
      </Field>

      <Switch
        label="Show region outlines"
        description="Lines at section, position and top/bottom boundaries."
        checked={outlines}
        onChange={(v) => set((s) => ({ heat: { ...s.heat, outlines: v } }))}
      />
      <Button
        size="sm"
        variant="ghost"
        icon={<RotateCcw className="h-3.5 w-3.5" />}
        onClick={() => setSec({ boundaries: null, flip: false, topOffsetDeg: 0, trimStart: 0, trimEnd: 1, minMedial: 1, sectionPositions: [] })}
      >
        Reset section settings
      </Button>
      <NextButton to="images">Next: add images</NextButton>
    </div>
  );
}
