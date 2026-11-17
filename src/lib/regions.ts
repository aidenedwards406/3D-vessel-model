/**
 * Region layout: how a position on the model maps to (section, side, position).
 *
 * Every model vertex carries:
 *   aT      – normalised distance along the vessel's centerline (0 at end A, 1 at end B)
 *   cosθ/sinθ – its angle around the centerline relative to the "up" frame
 *
 * The same maths runs on the GPU (shader) and here on the CPU (hover, markers,
 * exports), so what you see is exactly what the data lookup uses.
 */
import { positionSlot, positionsForSection, type Side } from './naming';

export const MAX_SECTIONS = 24;
export const MAX_SLOTS = 14; // P + up to 12 medial + D
export const REGION_COUNT = MAX_SECTIONS * 2 * MAX_SLOTS;

export interface SectionSettings {
  /** Number of sections the vessel was cut into. */
  count: number;
  /** Optional custom boundaries along the sectioned length (count + 1 values, 0 … 1). */
  boundaries: number[] | null;
  /** Swap which end is proximal. */
  flip: boolean;
  /** Rotates which side counts as "top", in degrees around the centerline. */
  topOffsetDeg: number;
  /** Part of the model (proximal-based fractions) that is sectioned; outside is left neutral. */
  trimStart: number;
  trimEnd: number;
  /** Minimum medial positions per section (P, M…, D); data can raise it per section. */
  minMedial: number;
}

export const DEFAULT_SECTIONS: SectionSettings = {
  count: 4,
  boundaries: null,
  flip: false,
  topOffsetDeg: 0,
  trimStart: 0,
  trimEnd: 1,
  minMedial: 1,
};

/** Fully resolved layout used for rendering and lookups. */
export interface Layout {
  count: number;
  boundaries: number[];
  medial: number[];
  flip: boolean;
  topOffset: number; // radians
  trimStart: number;
  trimEnd: number;
}

export interface Region {
  section: number; // 1-based
  side: Side;
  slot: number;
  position: string;
  index: number;
}

export function equalBoundaries(count: number): number[] {
  return Array.from({ length: count + 1 }, (_v, i) => i / count);
}

export function resolveLayout(s: SectionSettings, medialFromData: number[] = []): Layout {
  const count = Math.max(1, Math.min(MAX_SECTIONS, Math.round(s.count)));
  let boundaries = s.boundaries && s.boundaries.length === count + 1 ? [...s.boundaries] : equalBoundaries(count);
  boundaries[0] = 0;
  boundaries[count] = 1;
  boundaries = boundaries.map((b, i) => (i === 0 ? 0 : Math.max(boundaries[i - 1] + 1e-4, Math.min(1, b))));
  const medial = Array.from({ length: count }, (_v, i) =>
    Math.max(1, Math.min(MAX_SLOTS - 2, Math.max(s.minMedial, medialFromData[i] ?? 0))),
  );
  const trimStart = Math.max(0, Math.min(0.95, s.trimStart));
  const trimEnd = Math.max(trimStart + 0.05, Math.min(1, s.trimEnd));
  return {
    count,
    boundaries,
    medial,
    flip: s.flip,
    topOffset: (s.topOffsetDeg * Math.PI) / 180,
    trimStart,
    trimEnd,
  };
}

export function regionIndex(section: number, side: Side, slot: number): number {
  return ((section - 1) * 2 + (side === 'T' ? 0 : 1)) * MAX_SLOTS + slot;
}

export function regionFromIndex(index: number, layout: Layout): Region {
  const slot = index % MAX_SLOTS;
  const row = Math.floor(index / MAX_SLOTS);
  const section = Math.floor(row / 2) + 1;
  const side: Side = row % 2 === 0 ? 'T' : 'B';
  const positions = positionsForSection(layout.medial[section - 1] ?? 1);
  return { section, side, slot, position: positions[slot] ?? 'P', index };
}

export function regionFor(section: number, side: Side, position: string, layout: Layout): Region | null {
  if (section < 1 || section > layout.count) return null;
  const medial = layout.medial[section - 1];
  const slot = positionSlot(position, medial);
  return { section, side, slot, position: positionsForSection(medial)[slot], index: regionIndex(section, side, slot) };
}

/** Proximal-based position along the sectioned length (0…1), or null outside the trimmed range. */
export function sectionedU(aT: number, layout: Layout): number | null {
  const u0 = layout.flip ? 1 - aT : aT;
  const u = (u0 - layout.trimStart) / (layout.trimEnd - layout.trimStart);
  if (u < -1e-6 || u > 1 + 1e-6) return null;
  return Math.max(0, Math.min(1 - 1e-9, u));
}

/** cos of the angle between a vertex and the "top" direction. ≥ 0 means top. */
export function topness(cosT: number, sinT: number, layout: Layout): number {
  const s = layout.flip ? -sinT : sinT;
  return cosT * Math.cos(layout.topOffset) + s * Math.sin(layout.topOffset);
}

export function locateRegion(aT: number, cosT: number, sinT: number, layout: Layout): Region | null {
  const u = sectionedU(aT, layout);
  if (u === null) return null;
  let s = 0;
  while (s < layout.count - 1 && u >= layout.boundaries[s + 1]) s++;
  const b0 = layout.boundaries[s];
  const b1 = layout.boundaries[s + 1];
  const w = (u - b0) / Math.max(1e-9, b1 - b0);
  const medial = layout.medial[s];
  const slots = medial + 2;
  const slot = Math.max(0, Math.min(slots - 1, Math.floor(w * slots)));
  const side: Side = topness(cosT, sinT, layout) >= 0 ? 'T' : 'B';
  const section = s + 1;
  return { section, side, slot, position: positionsForSection(medial)[slot], index: regionIndex(section, side, slot) };
}

/** Centre of a region: model aT and the angle (radians) around the centerline in the raw frame. */
export function regionCenter(section: number, side: Side, slot: number, layout: Layout): { aT: number; angle: number } {
  const s = Math.max(0, Math.min(layout.count - 1, section - 1));
  const slots = layout.medial[s] + 2;
  const w = (Math.min(slot, slots - 1) + 0.5) / slots;
  const u = layout.boundaries[s] + w * (layout.boundaries[s + 1] - layout.boundaries[s]);
  const u0 = layout.trimStart + u * (layout.trimEnd - layout.trimStart);
  const aT = layout.flip ? 1 - u0 : u0;
  // In the raw frame: top direction is (cos φ, ±sin φ); bottom is opposite.
  const phi = layout.flip ? -layout.topOffset : layout.topOffset;
  const angle = side === 'T' ? phi : phi + Math.PI;
  return { aT, angle };
}

/** aT of a section's centre (for 3D labels). */
export function sectionCenterT(section: number, layout: Layout): number {
  const s = section - 1;
  const u = (layout.boundaries[s] + layout.boundaries[s + 1]) / 2;
  const u0 = layout.trimStart + u * (layout.trimEnd - layout.trimStart);
  return layout.flip ? 1 - u0 : u0;
}

/** aT of the proximal / distal ends of the sectioned length. */
export function endT(which: 'proximal' | 'distal', layout: Layout): number {
  const u0 = which === 'proximal' ? layout.trimStart : layout.trimEnd;
  return layout.flip ? 1 - u0 : u0;
}

export function allRegions(layout: Layout): Region[] {
  const out: Region[] = [];
  for (let s = 1; s <= layout.count; s++) {
    const positions = positionsForSection(layout.medial[s - 1]);
    for (const side of ['T', 'B'] as Side[]) {
      positions.forEach((position, slot) => out.push({ section: s, side, slot, position, index: regionIndex(s, side, slot) }));
    }
  }
  return out;
}
