import { useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { ArrowLeftRight, MousePointerClick } from 'lucide-react';
import { formatPercent, PALETTES, type PaletteId } from '../../lib/colormaps';
import { sectionSummaries, type ViewTarget } from '../../lib/study';
import { getScale, currentVessel, parseTarget, targetToString, useLayout, useVessels } from '../../state/derived';
import { set, useStore, type HeatSettings, type StatsSettings } from '../../state/store';
import { defaultPair } from '../../state/views';
import { positionsForSection } from '../../lib/naming';
import { Button, Callout, Field, Segmented, Stat, Switch, cx } from '../ui';
import { Help, NextButton } from './common';

function setHeat(patch: Partial<HeatSettings>) {
  set((s) => ({ heat: { ...s.heat, ...patch }, dirty: true }));
}

export function HeatSettingsPanel() {
  const heat = useStore((s) => s.heat);
  const scale = useStore(useShallow((s) => getScale(s)));
  return (
    <div className="space-y-3">
      <Field label="Colour scale">
        <div className="grid grid-cols-2 gap-1.5">
          {PALETTES.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setHeat({ palette: p.id as PaletteId })}
              aria-pressed={heat.palette === p.id}
              title={p.description}
              className={cx(
                'rounded-md border p-1.5 text-left transition-colors',
                heat.palette === p.id ? 'border-accent bg-accent-soft' : 'border-line bg-surface-2 hover:border-line-strong',
              )}
            >
              <span className="block h-2.5 rounded-sm" style={{ background: `linear-gradient(to right, ${p.stops.join(',')})` }} />
              <span className="mt-1 block text-[11.5px] font-medium text-ink">{p.label}</span>
            </button>
          ))}
        </div>
      </Field>
      <Field
        label="Range"
        hint={heat.rangeMode === 'study' ? 'One fixed scale for every vessel, so colours are comparable between treatments.' : undefined}
      >
        <Segmented
          className="w-full"
          size="sm"
          value={heat.rangeMode}
          onChange={(rangeMode) => setHeat({ rangeMode, ...(rangeMode === 'custom' ? { min: scale.min, max: scale.max } : {}) })}
          options={[
            { value: 'study', label: 'All vessels' },
            { value: 'vessel', label: 'This vessel' },
            { value: 'custom', label: 'Custom' },
          ]}
        />
        {heat.rangeMode === 'custom' && (
          <div className="mt-2 grid grid-cols-2 gap-2">
            <label className="text-[11.5px] text-ink-2">
              Low (%)
              <input type="number" className="field mt-0.5" value={heat.min} step={0.5} onChange={(e) => setHeat({ min: Number(e.target.value) })} />
            </label>
            <label className="text-[11.5px] text-ink-2">
              High (%)
              <input type="number" className="field mt-0.5" value={heat.max} step={0.5} onChange={(e) => setHeat({ max: Number(e.target.value) })} />
            </label>
          </div>
        )}
      </Field>
      <Field label="Bands">
        <Segmented
          className="w-full"
          size="sm"
          value={String(heat.steps)}
          onChange={(v) => setHeat({ steps: Number(v) })}
          options={[
            { value: '0', label: 'Continuous' },
            { value: '5', label: '5 bands' },
            { value: '7', label: '7 bands' },
          ]}
        />
      </Field>
      <Field label="Several images at one location">
        <Segmented
          className="w-full"
          size="sm"
          value={heat.aggregation}
          onChange={(aggregation) => setHeat({ aggregation })}
          options={[
            { value: 'mean', label: 'Mean' },
            { value: 'median', label: 'Median' },
            { value: 'max', label: 'Maximum' },
          ]}
        />
      </Field>
      <Switch
        label="Blend between locations"
        description="Smooth gradient between neighbouring images. Locations without an image stay gray."
        checked={heat.smooth}
        onChange={(smooth) => setHeat({ smooth })}
      />
      <Switch label="Region outlines" checked={heat.outlines} onChange={(outlines) => setHeat({ outlines })} />
      <Switch label="Image markers" checked={heat.showMarkers} onChange={(showMarkers) => setHeat({ showMarkers })} />
    </div>
  );
}

export function ExploreStep() {
  const v = useStore(currentVessel);
  const layout = useLayout();
  const hasRows = useStore((s) => s.damage.rows.length > 0);
  const tr = useStore((s) => (v ? s.treatments.find((t) => t.id === s.vesselTreatment[v.vKey]) : null));
  const highlight = useStore((s) => s.highlightSection);
  const summaries = sectionSummaries(v ?? undefined, layout.count);
  if (!v) {
    return (
      <div className="space-y-3">
        <Callout kind="info" title="Nothing to explore yet">
          Add images (step 3) or damage data (step 4) to see markers and the heat map.
        </Callout>
        <NextButton to="images">Go to step 3</NextButton>
      </div>
    );
  }
  return (
    <div className="space-y-4">
      <div className="flex items-start gap-2 rounded-lg bg-accent-soft px-3 py-2 text-[12.5px] text-ink">
        <MousePointerClick className="mt-0.5 h-4 w-4 shrink-0 text-accent-soft-ink" />
        <span>Click a marker or region to see its images. Use ← → to switch vessels.</span>
      </div>
      <div>
        <div className="mb-1.5 text-[12px] text-muted">{tr?.name ?? 'No treatment assigned'}</div>
        <div className="grid grid-cols-3 gap-2">
          <Stat label="Mean" value={formatPercent(v.mean)} />
          <Stat label="Max" value={formatPercent(v.max)} />
          <Stat label="Images" value={v.imageCount} />
        </div>
      </div>
      <div>
        <div className="mb-1.5 text-[12px] font-semibold text-ink">By section</div>
        <table className="w-full text-[12px]">
          <thead className="text-ink-2">
            <tr className="border-b border-line">
              <th className="py-1 text-left font-medium">Section</th>
              <th className="py-1 text-right font-medium">Mean</th>
              <th className="py-1 text-right font-medium">Max</th>
              <th className="py-1 text-right font-medium">Top</th>
              <th className="py-1 text-right font-medium">Bottom</th>
            </tr>
          </thead>
          <tbody>
            {summaries.map((r) => (
              <tr
                key={r.section}
                className={cx('cursor-default border-b border-line/70', highlight === r.section && 'bg-accent-soft')}
                onMouseEnter={() => set({ highlightSection: r.section })}
                onMouseLeave={() => set({ highlightSection: null })}
              >
                <td className="py-1 font-medium text-ink">
                  {r.section}
                  <span className="ml-1 text-[10.5px] text-muted">({r.n})</span>
                </td>
                <td className="tabular py-1 text-right text-ink">{formatPercent(r.mean)}</td>
                <td className="tabular py-1 text-right text-ink">{formatPercent(r.max)}</td>
                <td className="tabular py-1 text-right text-ink-2">{formatPercent(r.topMean)}</td>
                <td className="tabular py-1 text-right text-ink-2">{formatPercent(r.bottomMean)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-1 text-[11px] text-muted">Hover a row to highlight the section. (n) = damage values.</p>
      </div>
      {hasRows ? (
        <div>
          <div className="mb-2 text-[12px] font-semibold text-ink">Heat map</div>
          <HeatSettingsPanel />
        </div>
      ) : (
        <Callout kind="info">Add the damage spreadsheet in step 4 to colour the model by damage.</Callout>
      )}
      <NextButton to="compare">Next: compare treatments</NextButton>
    </div>
  );
}

function TargetSelect({ value, onChange, label }: { value: ViewTarget | null; onChange: (t: ViewTarget) => void; label: string }) {
  const vessels = useVessels();
  const treatments = useStore((s) => s.treatments);
  const groups = treatments.filter((t) => vessels.some((v) => v.treatmentId === t.id));
  return (
    <label className="block text-[11.5px] text-ink-2">
      {label}
      <select
        className="field mt-0.5"
        value={value ? targetToString(value) : ''}
        onChange={(e) => onChange(parseTarget(e.target.value))}
      >
        {groups.length > 0 && (
          <optgroup label="Treatment averages">
            {groups.map((t) => (
              <option key={t.id} value={`g:${t.id}`}>
                {t.name} (average)
              </option>
            ))}
          </optgroup>
        )}
        {(groups.length ? groups : [null]).map((g) => (
          <optgroup key={g?.id ?? 'all'} label={g ? `${g.name} vessels` : 'Vessels'}>
            {vessels
              .filter((v) => (g ? v.treatmentId === g.id : true))
              .map((v) => (
                <option key={v.vKey} value={`v:${v.vKey}`}>
                  {v.name}
                </option>
              ))}
          </optgroup>
        ))}
        {groups.length > 0 && vessels.some((v) => !v.treatmentId) && (
          <optgroup label="Unassigned vessels">
            {vessels
              .filter((v) => !v.treatmentId)
              .map((v) => (
                <option key={v.vKey} value={`v:${v.vKey}`}>
                  {v.name}
                </option>
              ))}
          </optgroup>
        )}
      </select>
    </label>
  );
}

export function CompareStep() {
  const compare = useStore((s) => s.compare);
  const vessels = useVessels();
  const treatments = useStore((s) => s.treatments);
  const vt = useStore((s) => s.vesselTreatment);
  const pair = useMemo(() => defaultPair(useStore.getState()), [treatments, vt, vessels]);
  const left = compare.left ?? pair[0];
  const right = compare.right ?? pair[1];
  const setCompare = (patch: Partial<typeof compare>) => set((s) => ({ compare: { ...s.compare, ...patch }, dirty: true }));
  if (vessels.length === 0) {
    return <Callout kind="info">Add data and treatments first, then compare vessels and treatment groups here.</Callout>;
  }
  return (
    <div className="space-y-4">
      <Help>Compare treatments on matching models. All views share one colour scale and rotate together.</Help>
      <Field label="Layout">
        <Segmented
          className="w-full"
          size="sm"
          value={compare.layout}
          onChange={(layout) => setCompare({ layout })}
          options={[
            { value: 'pair', label: 'Side by side' },
            { value: 'groups', label: 'Averages' },
            { value: 'all', label: 'All vessels' },
          ]}
        />
      </Field>
      {compare.layout === 'pair' && (
        <div className="space-y-2">
          <TargetSelect label="Left" value={left} onChange={(t) => setCompare({ left: t, right })} />
          <TargetSelect label="Right" value={right} onChange={(t) => setCompare({ right: t, left })} />
          <Button size="sm" variant="ghost" icon={<ArrowLeftRight className="h-3.5 w-3.5" />} onClick={() => setCompare({ left: right, right: left })}>
            Swap sides
          </Button>
          <Switch
            label="Show the difference"
            description="A third view: left minus right, blue where left is lower, red where it is higher."
            checked={compare.diff}
            onChange={(diff) => setCompare({ diff, left, right })}
          />
        </div>
      )}
      {compare.layout === 'all' && (
        <Help>Every vessel, ordered by treatment. Click a region on any vessel to open its images.</Help>
      )}
      {compare.layout === 'groups' && <Help>Each treatment's average damage at every location (mean of its vessels).</Help>}
      <Callout kind="info">The summary chart below the views shows average damage per treatment group.</Callout>
      <NextButton to="stats">Next: statistics</NextButton>
    </div>
  );
}

export function StatsStep() {
  const st = useStore((s) => s.stats);
  const layout = useLayout();
  const setStats = (patch: Partial<StatsSettings>) => set((s) => ({ stats: { ...s.stats, ...patch }, dirty: true }));
  const positions = positionsForSection(Math.max(...layout.medial));
  return (
    <div className="space-y-4">
      <Help>
        Group comparisons run here instead of separately in JMP. Results update as you change the settings and can be exported as CSV to check in JMP.
      </Help>
      <Field
        label="Unit of analysis"
        hint={
          st.unit === 'vessel'
            ? 'Each vessel counts once (its mean damage). Recommended: images from one vessel are not independent.'
            : 'Each image counts once. Images from the same vessel are correlated, so p-values can look smaller than they should.'
        }
      >
        <Segmented
          className="w-full"
          size="sm"
          value={st.unit}
          onChange={(unit) => setStats({ unit })}
          options={[
            { value: 'image', label: 'Images' },
            { value: 'vessel', label: 'Vessel means' },
          ]}
        />
      </Field>
      <Field label="Test">
        <select className="field" value={st.test} onChange={(e) => setStats({ test: e.target.value as StatsSettings['test'] })}>
          <option value="auto">Choose automatically</option>
          <option value="anova">One-way ANOVA + Tukey HSD</option>
          <option value="welch">Welch's ANOVA + Games–Howell</option>
          <option value="kruskal">Kruskal–Wallis + Dunn</option>
        </select>
      </Field>
      {(st.test === 'kruskal' || st.test === 'auto') && (
        <Field label="Dunn p-value adjustment">
          <Segmented
            className="w-full"
            size="sm"
            value={st.padjust}
            onChange={(padjust) => setStats({ padjust })}
            options={[
              { value: 'holm', label: 'Holm' },
              { value: 'bonferroni', label: 'Bonferroni' },
            ]}
          />
        </Field>
      )}
      <div className="grid grid-cols-2 gap-2">
        <Field label="Significance level">
          <select className="field" value={st.alpha} onChange={(e) => setStats({ alpha: Number(e.target.value) })}>
            <option value={0.05}>α = 0.05</option>
            <option value={0.01}>α = 0.01</option>
            <option value={0.1}>α = 0.10</option>
          </select>
        </Field>
        <Field label="Error bars">
          <select className="field" value={st.errorBar} onChange={(e) => setStats({ errorBar: e.target.value as StatsSettings['errorBar'] })}>
            <option value="sd">± SD</option>
            <option value="sem">± SEM</option>
            <option value="ci">95% CI</option>
          </select>
        </Field>
      </div>
      <div>
        <div className="label">Limit to a region</div>
        <div className="grid grid-cols-3 gap-1.5">
          <select className="field text-[12px]" aria-label="Section" value={st.section ?? ''} onChange={(e) => setStats({ section: e.target.value ? Number(e.target.value) : null })}>
            <option value="">All sections</option>
            {Array.from({ length: layout.count }, (_v, i) => (
              <option key={i} value={i + 1}>
                Section {i + 1}
              </option>
            ))}
          </select>
          <select className="field text-[12px]" aria-label="Side" value={st.side ?? ''} onChange={(e) => setStats({ side: (e.target.value || null) as StatsSettings['side'] })}>
            <option value="">Both sides</option>
            <option value="T">Top</option>
            <option value="B">Bottom</option>
          </select>
          <select className="field text-[12px]" aria-label="Position" value={st.position ?? ''} onChange={(e) => setStats({ position: e.target.value || null })}>
            <option value="">All positions</option>
            {positions.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );
}
