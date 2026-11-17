/** Memoised derived data (computed from the store, never stored). */
import { niceCeil, paletteStops } from '../lib/colormaps';
import { resolveLayout, type Layout } from '../lib/regions';
import {
  computeDerived,
  differenceRegionValues,
  groupRegionValues,
  maxRegionValue,
  orderVessels,
  vesselRegionValues,
  type Derived,
  type RegionValues,
  type Treatment,
  type VesselData,
  type ViewTarget,
} from '../lib/study';
import { useStore, type AppState } from './store';

function memo<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R {
  let last: { args: A; value: R } | null = null;
  return (...args: A) => {
    if (last && last.args.length === args.length && last.args.every((a, i) => a === args[i])) return last.value;
    const value = fn(...args);
    last = { args, value };
    return value;
  };
}

const derivedMemo = memo(computeDerived);
export const getDerived = (s: AppState): Derived =>
  derivedMemo(s.images, s.damage.rows, s.vesselTreatment, s.heat.aggregation);

const layoutMemo = memo((sections: AppState['sections'], medial: number[]) => resolveLayout(sections, medial));
export const getLayout = (s: AppState): Layout => layoutMemo(s.sections, getDerived(s).medialBySection);

const orderedMemo = memo((vessels: VesselData[], treatments: Treatment[], vt: Record<string, string>) => {
  const withT = vessels.map((v) => (v.treatmentId === (vt[v.vKey] ?? null) ? v : { ...v, treatmentId: vt[v.vKey] ?? null }));
  return orderVessels(withT, treatments);
});
export const getVessels = (s: AppState): VesselData[] => orderedMemo(getDerived(s).vessels, s.treatments, s.vesselTreatment);

export function useDerived() {
  return useStore(getDerived);
}
export function useLayout() {
  return useStore(getLayout);
}
export function useVessels() {
  return useStore(getVessels);
}

const valuesCache = new Map<string, { d: Derived; l: Layout; vt: Record<string, string>; v: RegionValues }>();

export function targetValues(s: AppState, target: ViewTarget): RegionValues {
  const d = getDerived(s);
  const l = getLayout(s);
  const key =
    target.kind === 'vessel' ? `v:${target.key}` : target.kind === 'group' ? `g:${target.id}` : `d:${target.a}:${target.b}`;
  const hit = valuesCache.get(key);
  if (hit && hit.d === d && hit.l === l && hit.vt === s.vesselTreatment) return hit.v;
  let v: RegionValues;
  if (target.kind === 'vessel') v = vesselRegionValues(d.vesselMap.get(target.key), l);
  else if (target.kind === 'group') v = groupRegionValues(getVessels(s).filter((x) => x.treatmentId === target.id), l);
  else v = differenceRegionValues(targetValues(s, parseTarget(target.a)), targetValues(s, parseTarget(target.b)));
  valuesCache.set(key, { d, l, vt: s.vesselTreatment, v });
  if (valuesCache.size > 400) valuesCache.clear();
  return v;
}

export function targetToString(t: ViewTarget): string {
  return t.kind === 'vessel' ? `v:${t.key}` : t.kind === 'group' ? `g:${t.id}` : `d:${t.a}|${t.b}`;
}

export function parseTarget(str: string): ViewTarget {
  if (str.startsWith('g:')) return { kind: 'group', id: str.slice(2) };
  if (str.startsWith('d:')) {
    const [a, b] = str.slice(2).split('|');
    return { kind: 'diff', a, b };
  }
  return { kind: 'vessel', key: str.replace(/^v:/, '') };
}

export function targetLabel(s: AppState, t: ViewTarget): string {
  if (t.kind === 'vessel') return getDerived(s).vesselMap.get(t.key)?.name ?? t.key;
  if (t.kind === 'group') return s.treatments.find((x) => x.id === t.id)?.name ?? 'Unknown treatment';
  return `${targetLabel(s, parseTarget(t.a))} − ${targetLabel(s, parseTarget(t.b))}`;
}

const studyMaxMemo = memo((d: Derived, l: Layout) => maxRegionValue(d.vessels.map((v) => vesselRegionValues(v, l))));

export interface Scale {
  min: number;
  max: number;
  stops: string[];
  steps: number;
}

export function getScale(s: AppState, forTarget?: ViewTarget): Scale {
  const d = getDerived(s);
  const l = getLayout(s);
  const stops = paletteStops(s.heat.palette);
  if (s.heat.rangeMode === 'custom') {
    return { min: s.heat.min, max: Math.max(s.heat.min + 0.001, s.heat.max), stops, steps: s.heat.steps };
  }
  if (s.heat.rangeMode === 'vessel' && forTarget) {
    const m = maxRegionValue([targetValues(s, forTarget)]);
    return { min: 0, max: niceCeil(m || 1), stops, steps: s.heat.steps };
  }
  const m = studyMaxMemo(d, l);
  return { min: 0, max: niceCeil(m || 1), stops, steps: s.heat.steps };
}

export function normalizeValues(rv: RegionValues, min: number, max: number): Float32Array {
  const out = new Float32Array(rv.values.length);
  const span = max - min || 1;
  for (let i = 0; i < out.length; i++) {
    const x = rv.values[i];
    out[i] = Number.isNaN(x) ? NaN : Math.max(0, Math.min(1, (x - min) / span));
  }
  return out;
}

/** The vessel currently shown in single view (falls back to the first vessel). */
export function currentVessel(s: AppState): VesselData | null {
  const vessels = getVessels(s);
  if (vessels.length === 0) return null;
  return vessels.find((v) => v.vKey === s.vessel) ?? vessels[0];
}
