/** Builds the 3D views (single vessel, side by side, grids) from study state. */
import { buildColormapLUT, colorForValue, DIVERGING_STOPS, niceCeil, seriesColor } from '../lib/colormaps';
import { regionFor, REGION_COUNT } from '../lib/regions';
import { aggregate, type ViewTarget } from '../lib/study';
import type { EngineView, MarkerSpec } from '../three/engine';
import {
  currentVessel,
  getDerived,
  getLayout,
  getScale,
  getVessels,
  normalizeValues,
  targetLabel,
  targetToString,
  targetValues,
  type Scale,
} from './derived';
import type { AppState } from './store';

export interface ViewDescriptor extends EngineView {
  target: ViewTarget | null;
  label: string;
  sublabel: string;
  color: string | null;
  mean: number | null;
  isDiff: boolean;
  diffMax: number;
}

export interface ViewSet {
  views: ViewDescriptor[];
  columns: number;
  scale: Scale;
  compare: boolean;
}

const MARKER_ACCENT = '#2a78d6';
const MARKER_NODATA = '#a9a8a2';

function emptyValues(): Float32Array {
  const v = new Float32Array(REGION_COUNT);
  v.fill(NaN);
  return v;
}

function meanOf(values: Float32Array): number | null {
  const xs: number[] = [];
  for (const x of values) if (!Number.isNaN(x)) xs.push(x);
  return aggregate(xs, 'mean');
}

export function defaultPair(s: AppState): [ViewTarget | null, ViewTarget | null] {
  const groups = s.treatments.filter((t) => getVessels(s).some((v) => v.treatmentId === t.id));
  if (groups.length >= 2) return [{ kind: 'group', id: groups[0].id }, { kind: 'group', id: groups[1].id }];
  const vessels = getVessels(s);
  return [vessels[0] ? { kind: 'vessel', key: vessels[0].vKey } : null, vessels[1] ? { kind: 'vessel', key: vessels[1].vKey } : null];
}

export function describeTarget(s: AppState, t: ViewTarget, scale: Scale, dark: boolean, withMarkers: boolean): ViewDescriptor {
  const rv = targetValues(s, t);
  const layout = getLayout(s);
  const d = getDerived(s);
  let color: string | null = null;
  let sublabel = '';
  if (t.kind === 'vessel') {
    const tid = s.vesselTreatment[t.key];
    const tr = s.treatments.find((x) => x.id === tid);
    color = tr ? seriesColor(tr.slot, dark) : null;
    sublabel = tr?.name ?? 'No treatment assigned';
  } else if (t.kind === 'group') {
    const tr = s.treatments.find((x) => x.id === t.id);
    color = tr ? seriesColor(tr.slot, dark) : null;
    const n = getVessels(s).filter((v) => v.treatmentId === t.id).length;
    sublabel = `Average of ${n} vessel${n === 1 ? '' : 's'}`;
  } else {
    sublabel = 'Difference in % damage';
  }
  const isDiff = t.kind === 'diff';
  let values: Float32Array;
  let lut: EngineView['lut'] = null;
  let diffMax = 0;
  if (isDiff) {
    for (const x of rv.values) if (!Number.isNaN(x)) diffMax = Math.max(diffMax, Math.abs(x));
    diffMax = niceCeil(diffMax || 1);
    values = normalizeValues(rv, -diffMax, diffMax);
    lut = { data: buildColormapLUT(DIVERGING_STOPS, s.heat.steps), stepped: s.heat.steps > 0 };
  } else {
    values = normalizeValues(rv, scale.min, scale.max);
  }
  let markers: MarkerSpec[] | null = null;
  if (withMarkers && t.kind === 'vessel') {
    const v = d.vesselMap.get(t.key);
    markers = [];
    if (v) {
      for (const loc of v.locations.values()) {
        const r = regionFor(loc.section, loc.side, loc.position, layout);
        if (!r) continue;
        const hasImage = loc.observations.some((o) => o.imageId);
        let c = MARKER_ACCENT;
        if (s.viewMode === 'heat') c = loc.value === null ? MARKER_NODATA : colorForValue(loc.value, scale);
        if (!hasImage && s.viewMode !== 'heat') continue;
        markers.push({ key: loc.locKey, section: r.section, side: r.side, slot: r.slot, color: c });
      }
    }
  }
  return {
    key: targetToString(t),
    target: t,
    values,
    lut,
    markers,
    label: targetLabel(s, t),
    sublabel,
    color,
    mean: meanOf(rv.values),
    isDiff,
    diffMax,
  };
}

export function computeViews(s: AppState, dark: boolean): ViewSet {
  const vessels = getVessels(s);
  const compare = s.step === 'compare' && vessels.length > 0;
  if (compare) {
    const scale = getScale(s);
    let targets: ViewTarget[] = [];
    let columns = 1;
    if (s.compare.layout === 'all') {
      targets = vessels.map((v) => ({ kind: 'vessel', key: v.vKey }) as ViewTarget);
      const n = targets.length;
      columns = Math.max(1, Math.min(8, Math.ceil(Math.sqrt(n * 1.8))));
    } else if (s.compare.layout === 'groups') {
      targets = s.treatments
        .filter((t) => vessels.some((v) => v.treatmentId === t.id))
        .map((t) => ({ kind: 'group', id: t.id }) as ViewTarget);
      if (targets.length === 0) targets = vessels.slice(0, 1).map((v) => ({ kind: 'vessel', key: v.vKey }) as ViewTarget);
      columns = Math.min(4, Math.max(1, targets.length));
    } else {
      const [dl, dr] = defaultPair(s);
      const left = s.compare.left ?? dl;
      const right = s.compare.right ?? dr;
      targets = [left, right].filter((x): x is ViewTarget => !!x);
      if (s.compare.diff && targets.length === 2) {
        targets.push({ kind: 'diff', a: targetToString(targets[0]), b: targetToString(targets[1]) });
      }
      columns = targets.length;
    }
    const views = targets.map((t) => describeTarget(s, t, scale, dark, s.compare.layout === 'pair' && s.heat.showMarkers));
    return { views, columns, scale, compare: true };
  }
  const v = currentVessel(s);
  const target: ViewTarget | null = v ? { kind: 'vessel', key: v.vKey } : null;
  const scale = getScale(s, target ?? undefined);
  if (!target) {
    return {
      views: [
        {
          key: 'empty',
          target: null,
          values: emptyValues(),
          lut: null,
          markers: null,
          label: '',
          sublabel: '',
          color: null,
          mean: null,
          isDiff: false,
          diffMax: 0,
        },
      ],
      columns: 1,
      scale,
      compare: false,
    };
  }
  return { views: [describeTarget(s, target, scale, dark, s.heat.showMarkers)], columns: 1, scale, compare: false };
}
