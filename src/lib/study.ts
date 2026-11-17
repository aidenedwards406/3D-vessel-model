/**
 * Study data model and derived views.
 *
 * Raw inputs:   image files, damage-sheet rows, treatment key.
 * Derived:      observations (one per image or damage row) grouped by vessel and
 *               location, plus per-region values ready for the heat map.
 */
import type { DamageRow } from './importers';
import {
  medialIndex,
  naturalCompare,
  nameKey,
  parseImageName,
  vesselKey,
  type ParsedName,
  type Side,
} from './naming';
import { regionFor, REGION_COUNT, type Layout } from './regions';

export type TreatmentRole = 'control' | 'investigational' | 'standard' | 'other';

export interface Treatment {
  id: string;
  name: string;
  /** Categorical colour slot 0–7. Colour follows the treatment, never its rank. */
  slot: number;
  role: TreatmentRole;
}

export interface Placement {
  bioreactor: string;
  section: number;
  side: Side;
  position: string;
}

export interface ImageItem {
  id: string;
  fileName: string;
  key: string;
  size: number;
  parsed: ParsedName | null;
  parseError: string | null;
  manual: Placement | null;
  excluded: boolean;
}

export type Aggregation = 'mean' | 'max' | 'median';

export interface Observation {
  id: string;
  vessel: string;
  vKey: string;
  section: number;
  side: Side;
  position: string;
  locKey: string;
  damage: number | null;
  name: string;
  imageId: string | null;
  overlayId: string | null;
  magnification: string | null;
  manual: boolean;
}

export interface LocationData {
  locKey: string;
  vKey: string;
  section: number;
  side: Side;
  position: string;
  observations: Observation[];
  value: number | null;
  n: number;
}

export interface VesselData {
  vKey: string;
  name: string;
  treatmentId: string | null;
  locations: Map<string, LocationData>;
  observations: Observation[];
  values: number[];
  mean: number | null;
  max: number | null;
  imageCount: number;
}

export interface Derived {
  observations: Observation[];
  vessels: VesselData[];
  vesselMap: Map<string, VesselData>;
  /** Highest medial index seen per section (index 0 = section 1). */
  medialBySection: number[];
  maxSection: number;
  unplacedImages: ImageItem[];
  unparsedRows: DamageRow[];
  rowsWithoutImage: number;
  imagesWithoutRow: number;
  duplicateRows: number;
  overlayCount: number;
}

let uidCounter = 0;
export function uid(prefix = 'id'): string {
  uidCounter = (uidCounter + 1) % 1e9;
  return `${prefix}_${Date.now().toString(36)}${uidCounter.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export function locKey(vKey: string, section: number, side: Side, position: string): string {
  return `${vKey}|${section}|${side}|${position}`;
}

export function makeImageItem(fileName: string, size: number, id = uid('img')): ImageItem {
  const r = parseImageName(fileName);
  return {
    id,
    fileName,
    key: nameKey(fileName),
    size,
    parsed: r.ok ? r.value : null,
    parseError: r.ok ? null : r.error,
    manual: null,
    excluded: false,
  };
}

const OVERLAY_TOKEN =
  /_(trace|traced|tracing|mask|masked|outline|outlined|overlay|annotated|annotation|annot|roi|damage|damaged|seg|segmented|segmentation)$/;

/** Key of the base image an overlay belongs to ("…_M2_trace" → "…_M2"). */
export function overlayBaseKey(key: string): string {
  let k = key;
  while (OVERLAY_TOKEN.test(k)) k = k.replace(OVERLAY_TOKEN, '');
  return k;
}

export function aggregate(values: number[], how: Aggregation): number | null {
  if (values.length === 0) return null;
  if (how === 'max') return Math.max(...values);
  if (how === 'median') {
    const s = [...values].sort((a, b) => a - b);
    const m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }
  return values.reduce((a, b) => a + b, 0) / values.length;
}

export function computeDerived(
  images: ImageItem[],
  damageRows: DamageRow[],
  vesselTreatment: Record<string, string>,
  aggregation: Aggregation,
): Derived {
  const imageByKey = new Map<string, ImageItem>();
  const overlayByBase = new Map<string, ImageItem>();
  let overlayCount = 0;
  for (const img of images) {
    if (img.excluded) continue;
    if (img.parsed?.overlay && !img.manual) {
      overlayByBase.set(overlayBaseKey(img.key), img);
      overlayCount++;
      continue;
    }
    if (!imageByKey.has(img.key)) imageByKey.set(img.key, img);
  }

  const placementOf = (img: ImageItem | undefined): (Placement & { magnification: string | null }) | null => {
    if (!img) return null;
    if (img.manual) return { ...img.manual, magnification: img.parsed?.magnification ?? null };
    if (img.parsed) return { ...img.parsed, magnification: img.parsed.magnification };
    return null;
  };

  const observations: Observation[] = [];
  const usedImages = new Set<string>();
  const unparsedRows: DamageRow[] = [];
  const seenRowKeys = new Set<string>();
  let duplicateRows = 0;
  let rowsWithoutImage = 0;

  for (const row of damageRows) {
    if (seenRowKeys.has(row.key)) duplicateRows++;
    seenRowKeys.add(row.key);
    const img = imageByKey.get(row.key);
    let place: (Placement & { magnification: string | null }) | null = null;
    const parsed = parseImageName(row.name);
    if (img?.manual) place = placementOf(img);
    else if (parsed.ok) place = { ...parsed.value, magnification: parsed.value.magnification };
    else if (img) place = placementOf(img);
    if (!place) {
      unparsedRows.push(row);
      continue;
    }
    if (img) usedImages.add(img.id);
    else rowsWithoutImage++;
    const vKey = vesselKey(place.bioreactor);
    observations.push({
      id: `row_${row.rowNumber}_${row.key}`,
      vessel: place.bioreactor,
      vKey,
      section: place.section,
      side: place.side,
      position: place.position,
      locKey: locKey(vKey, place.section, place.side, place.position),
      damage: row.damage,
      name: img?.fileName ?? row.name,
      imageId: img?.id ?? null,
      overlayId: img ? (overlayByBase.get(img.key)?.id ?? null) : (overlayByBase.get(row.key)?.id ?? null),
      magnification: place.magnification,
      manual: !!img?.manual,
    });
  }

  let imagesWithoutRow = 0;
  const unplacedImages: ImageItem[] = [];
  for (const img of images) {
    if (img.excluded || usedImages.has(img.id)) continue;
    if (img.parsed?.overlay && !img.manual) continue;
    const place = placementOf(img);
    if (!place) {
      unplacedImages.push(img);
      continue;
    }
    if (imageByKey.get(img.key) !== img) continue; // duplicate file name
    if (damageRows.length > 0) imagesWithoutRow++;
    const vKey = vesselKey(place.bioreactor);
    observations.push({
      id: `img_${img.id}`,
      vessel: place.bioreactor,
      vKey,
      section: place.section,
      side: place.side,
      position: place.position,
      locKey: locKey(vKey, place.section, place.side, place.position),
      damage: null,
      name: img.fileName,
      imageId: img.id,
      overlayId: overlayByBase.get(img.key)?.id ?? null,
      magnification: place.magnification,
      manual: !!img.manual,
    });
  }

  // Group by vessel and location
  const vesselMap = new Map<string, VesselData>();
  const medialBySection: number[] = [];
  let maxSection = 0;
  for (const o of observations) {
    let v = vesselMap.get(o.vKey);
    if (!v) {
      v = {
        vKey: o.vKey,
        name: o.vessel,
        treatmentId: vesselTreatment[o.vKey] ?? null,
        locations: new Map(),
        observations: [],
        values: [],
        mean: null,
        max: null,
        imageCount: 0,
      };
      vesselMap.set(o.vKey, v);
    }
    v.observations.push(o);
    if (o.imageId) v.imageCount++;
    let loc = v.locations.get(o.locKey);
    if (!loc) {
      loc = { locKey: o.locKey, vKey: o.vKey, section: o.section, side: o.side, position: o.position, observations: [], value: null, n: 0 };
      v.locations.set(o.locKey, loc);
    }
    loc.observations.push(o);
    maxSection = Math.max(maxSection, o.section);
    const mi = medialIndex(o.position);
    if (mi > 0) medialBySection[o.section - 1] = Math.max(medialBySection[o.section - 1] ?? 0, mi);
  }
  for (const v of vesselMap.values()) {
    for (const loc of v.locations.values()) {
      const vals = loc.observations.map((o) => o.damage).filter((d): d is number => d !== null);
      loc.n = vals.length;
      loc.value = aggregate(vals, aggregation);
      v.values.push(...vals);
    }
    v.mean = v.values.length ? v.values.reduce((a, b) => a + b, 0) / v.values.length : null;
    v.max = v.values.length ? Math.max(...v.values) : null;
  }
  for (let i = 0; i < maxSection; i++) medialBySection[i] = medialBySection[i] ?? 0;

  const vessels = [...vesselMap.values()].sort((a, b) => naturalCompare(a.name, b.name));
  return {
    observations,
    vessels,
    vesselMap,
    medialBySection,
    maxSection,
    unplacedImages,
    unparsedRows,
    rowsWithoutImage,
    imagesWithoutRow,
    duplicateRows,
    overlayCount,
  };
}

/** Orders vessels by treatment order, then by natural ID. */
export function orderVessels(vessels: VesselData[], treatments: Treatment[]): VesselData[] {
  const order = new Map(treatments.map((t, i) => [t.id, i]));
  return [...vessels].sort((a, b) => {
    const ta = a.treatmentId !== null && order.has(a.treatmentId) ? order.get(a.treatmentId)! : 999;
    const tb = b.treatmentId !== null && order.has(b.treatmentId) ? order.get(b.treatmentId)! : 999;
    return ta - tb || naturalCompare(a.name, b.name);
  });
}

// ── Region values for the heat map ──────────────────────────────────────────

export interface RegionValues {
  values: Float32Array; // NaN = no data
  counts: Uint16Array; // images (or vessels for group means) contributing
}

export function emptyRegionValues(): RegionValues {
  const values = new Float32Array(REGION_COUNT);
  values.fill(NaN);
  return { values, counts: new Uint16Array(REGION_COUNT) };
}

export function vesselRegionValues(v: VesselData | undefined, layout: Layout): RegionValues {
  const out = emptyRegionValues();
  if (!v) return out;
  for (const loc of v.locations.values()) {
    const r = regionFor(loc.section, loc.side, loc.position, layout);
    if (!r) continue;
    out.counts[r.index] += loc.observations.length;
    if (loc.value === null) continue;
    const prev = out.values[r.index];
    out.values[r.index] = Number.isNaN(prev) ? loc.value : Math.max(prev, loc.value);
  }
  return out;
}

/** Mean of vessel-level region values across the vessels of a group. */
export function groupRegionValues(vessels: VesselData[], layout: Layout): RegionValues {
  const sums = new Float64Array(REGION_COUNT);
  const out = emptyRegionValues();
  for (const v of vessels) {
    const rv = vesselRegionValues(v, layout);
    for (let i = 0; i < REGION_COUNT; i++) {
      const x = rv.values[i];
      if (!Number.isNaN(x)) {
        sums[i] += x;
        out.counts[i]++;
      }
    }
  }
  for (let i = 0; i < REGION_COUNT; i++) if (out.counts[i] > 0) out.values[i] = sums[i] / out.counts[i];
  return out;
}

export function differenceRegionValues(a: RegionValues, b: RegionValues): RegionValues {
  const out = emptyRegionValues();
  for (let i = 0; i < REGION_COUNT; i++) {
    const x = a.values[i];
    const y = b.values[i];
    if (!Number.isNaN(x) && !Number.isNaN(y)) {
      out.values[i] = x - y;
      out.counts[i] = Math.min(a.counts[i], b.counts[i]);
    }
  }
  return out;
}

export function maxRegionValue(rvs: RegionValues[]): number {
  let m = 0;
  for (const rv of rvs) for (const x of rv.values) if (!Number.isNaN(x) && x > m) m = x;
  return m;
}

// ── Summaries ───────────────────────────────────────────────────────────────

export interface SectionSummary {
  section: number;
  mean: number | null;
  max: number | null;
  n: number;
  topMean: number | null;
  bottomMean: number | null;
  images: number;
}

export function sectionSummaries(v: VesselData | undefined, sectionCount: number): SectionSummary[] {
  const out: SectionSummary[] = [];
  for (let s = 1; s <= sectionCount; s++) {
    const obs = v ? v.observations.filter((o) => o.section === s) : [];
    const vals = obs.map((o) => o.damage).filter((d): d is number => d !== null);
    const top = obs.filter((o) => o.side === 'T' && o.damage !== null).map((o) => o.damage!);
    const bot = obs.filter((o) => o.side === 'B' && o.damage !== null).map((o) => o.damage!);
    out.push({
      section: s,
      mean: aggregate(vals, 'mean'),
      max: vals.length ? Math.max(...vals) : null,
      n: vals.length,
      topMean: aggregate(top, 'mean'),
      bottomMean: aggregate(bot, 'mean'),
      images: obs.filter((o) => o.imageId).length,
    });
  }
  return out;
}

export type ViewTarget = { kind: 'vessel'; key: string } | { kind: 'group'; id: string } | { kind: 'diff'; a: string; b: string };
