/** Builds statistics inputs (groups, breakdowns) from the study. */
import { seriesColor } from '../lib/colormaps';
import { comparePositions, sideLabel } from '../lib/naming';
import { analyze, describe, type Analysis } from '../lib/stats/tests';
import type { Observation } from '../lib/study';
import type { BreakdownSeries, GroupSeries } from '../components/charts';
import { getDerived, getLayout, getVessels } from './derived';
import type { AppState } from './store';

function mean(a: number[]) {
  return a.reduce((s, x) => s + x, 0) / a.length;
}

export function filteredObservations(s: AppState): Observation[] {
  const { section, side, position } = s.stats;
  return getDerived(s).observations.filter(
    (o) =>
      o.damage !== null &&
      (section === null || o.section === section) &&
      (side === null || o.side === side) &&
      (position === null || o.position === position),
  );
}

/** Values per treatment group, either one per image or one per vessel (vessel mean). */
export function statsGroups(s: AppState, dark = false, obsIn?: Observation[]): GroupSeries[] {
  const obs = obsIn ?? filteredObservations(s);
  const vt = s.vesselTreatment;
  const out: GroupSeries[] = [];
  for (const t of s.treatments) {
    const mine = obs.filter((o) => vt[o.vKey] === t.id);
    let values: number[];
    if (s.stats.unit === 'vessel') {
      const byVessel = new Map<string, number[]>();
      for (const o of mine) {
        if (!byVessel.has(o.vKey)) byVessel.set(o.vKey, []);
        byVessel.get(o.vKey)!.push(o.damage!);
      }
      values = [...byVessel.values()].map(mean);
    } else values = mine.map((o) => o.damage!);
    if (values.length) out.push({ id: t.id, name: t.name, color: seriesColor(t.slot, dark), values });
  }
  return out;
}

/** Per-vessel means for every treatment group (ignores the region filter). */
export function vesselMeanGroups(s: AppState, dark = false): GroupSeries[] {
  const vessels = getVessels(s);
  return s.treatments
    .map((t) => ({
      id: t.id,
      name: t.name,
      color: seriesColor(t.slot, dark),
      values: vessels.filter((v) => v.treatmentId === t.id && v.mean !== null).map((v) => v.mean as number),
    }))
    .filter((g) => g.values.length > 0);
}

export type BreakdownBy = 'section' | 'side' | 'position';

export function breakdown(s: AppState, by: BreakdownBy, dark = false): { categories: string[]; series: BreakdownSeries[] } {
  const layout = getLayout(s);
  // Breakdowns use every region (they are the breakdown), but respect other filters.
  const all = getDerived(s).observations.filter((o) => o.damage !== null);
  let keys: (string | number)[];
  let labels: string[];
  if (by === 'section') {
    keys = Array.from({ length: layout.count }, (_v, i) => i + 1);
    labels = keys.map((k) => `S${k}`);
  } else if (by === 'side') {
    keys = ['T', 'B'];
    labels = keys.map((k) => sideLabel(k as 'T' | 'B'));
  } else {
    keys = [...new Set(all.map((o) => o.position))].sort(comparePositions);
    labels = keys.map(String);
  }
  const keyOf = (o: Observation) => (by === 'section' ? o.section : by === 'side' ? o.side : o.position);
  const series: BreakdownSeries[] = [];
  for (const t of s.treatments) {
    const mine = all.filter((o) => s.vesselTreatment[o.vKey] === t.id);
    if (!mine.length) continue;
    const stats = keys.map((k) => {
      const sub = mine.filter((o) => keyOf(o) === k);
      if (!sub.length) return null;
      if (s.stats.unit === 'vessel') {
        const by2 = new Map<string, number[]>();
        for (const o of sub) {
          if (!by2.has(o.vKey)) by2.set(o.vKey, []);
          by2.get(o.vKey)!.push(o.damage!);
        }
        return describe([...by2.values()].map(mean));
      }
      return describe(sub.map((o) => o.damage!));
    });
    series.push({ id: t.id, name: t.name, color: seriesColor(t.slot, dark), stats });
  }
  return { categories: labels, series };
}

let cache: { key: unknown[]; value: Analysis } | null = null;
export function runAnalysis(s: AppState): Analysis {
  const key = [getDerived(s), s.treatments, s.vesselTreatment, s.stats];
  if (cache && cache.key.every((k, i) => k === key[i])) return cache.value;
  const groups = statsGroups(s);
  const value = analyze(
    groups.map((g) => ({ name: g.name, values: g.values })),
    s.stats.test,
    s.stats.alpha,
    s.stats.padjust,
  );
  cache = { key, value };
  return value;
}

export function filterDescription(s: AppState): string {
  const parts: string[] = [];
  if (s.stats.section !== null) parts.push(`section ${s.stats.section}`);
  if (s.stats.side) parts.push(sideLabel(s.stats.side).toLowerCase());
  if (s.stats.position) parts.push(`position ${s.stats.position}`);
  return parts.length ? parts.join(', ') : 'all regions';
}

export function unitDescription(s: AppState): string {
  return s.stats.unit === 'vessel' ? 'vessel means' : 'individual images';
}

export function plainLanguageResult(a: Analysis): string {
  if (!a.omnibus) return 'Not enough data to compare groups.';
  const { statName, stat, df1, df2, p } = a.omnibus;
  const dfText = df2 !== null ? `(${df1}, ${df2 % 1 === 0 ? df2 : df2.toFixed(1)})` : `(${df1})`;
  const pText = p < 0.0001 ? 'p < 0.0001' : `p = ${p < 0.001 ? p.toFixed(4) : p.toFixed(3)}`;
  const sigText =
    p < a.alpha
      ? 'Damage differs significantly between treatment groups'
      : 'No statistically significant difference in damage between treatment groups was found';
  return `${sigText} (${a.testName}, ${statName}${dfText} = ${stat.toFixed(2)}, ${pText}).`;
}
