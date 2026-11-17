import { ArrowLeftRight, RotateCcw } from 'lucide-react';
import { positionsForSection } from '../../lib/naming';
import { equalBoundaries } from '../../lib/regions';
import { setCenterlineMode } from '../../state/actions';
import { useDerived, useLayout } from '../../state/derived';
import { set, update, useStore } from '../../state/store';
import { Button, Callout, Field, Segmented, Slider, Switch } from '../ui';
import { Help, NextButton, Stepper } from './common';

export function SectionsStep() {
  const sections = useStore((s) => s.sections);
  const model = useStore((s) => s.model);
  const outlines = useStore((s) => s.heat.outlines);
  const layout = useLayout();
  const d = useDerived();
  const setSec = (patch: Partial<typeof sections>) => update((s) => ({ sections: { ...s.sections, ...patch } }));
  const custom = sections.boundaries !== null;
  const bounds = layout.boundaries;
  const medialSummary = [...new Set(layout.medial)].length === 1 ? positionsForSection(layout.medial[0]).join(', ') : 'varies by section';

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

      <Field
        label="Positions within each section"
        hint={`Currently ${medialSummary}. Extra medial positions (M2, M3…) are added automatically when your file names use them.`}
      >
        <div className="flex items-center gap-2">
          <Stepper label="medial positions" value={sections.minMedial} min={1} max={12} onChange={(minMedial) => setSec({ minMedial })} />
          <span className="text-[12px] text-ink-2">medial position{sections.minMedial === 1 ? '' : 's'} (M)</span>
        </div>
      </Field>

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
        onClick={() => setSec({ boundaries: null, flip: false, topOffsetDeg: 0, trimStart: 0, trimEnd: 1, minMedial: 1 })}
      >
        Reset section settings
      </Button>
      <NextButton to="images">Next: add images</NextButton>
    </div>
  );
}
