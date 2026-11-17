/**
 * Colour scales.
 *
 * Damage is a magnitude, so it uses sequential scales (light → dark). "Heat" is
 * the semantic-heat exception to the one-hue rule and always ships with a scale
 * legend. Locations without an image are never coloured from the scale: they are
 * neutral gray with diagonal hatching, so missing data can't be mistaken for 0%.
 */

export type PaletteId = 'heat' | 'blues' | 'viridis' | 'cividis';

export interface Palette {
  id: PaletteId;
  label: string;
  stops: string[];
  description: string;
}

export const PALETTES: Palette[] = [
  {
    id: 'heat',
    label: 'Heat',
    stops: ['#ffeda0', '#fed976', '#feb24c', '#fd8d3c', '#fc4e2a', '#e31a1c', '#bd0026', '#800026'],
    description: 'Yellow → red. Intuitive for damage.',
  },
  {
    id: 'blues',
    label: 'Blue',
    stops: [
      '#cde2fb',
      '#b7d3f6',
      '#9ec5f4',
      '#86b6ef',
      '#6da7ec',
      '#5598e7',
      '#3987e5',
      '#2a78d6',
      '#256abf',
      '#1c5cab',
      '#184f95',
      '#104281',
      '#0d366b',
    ],
    description: 'Single hue. Prints well in grayscale.',
  },
  {
    id: 'viridis',
    label: 'Viridis',
    stops: ['#440154', '#482878', '#3e4989', '#31688e', '#26828e', '#1f9e89', '#35b779', '#6ece58', '#b5de2b', '#fde725'],
    description: 'Perceptually uniform, colour-blind safe.',
  },
  {
    id: 'cividis',
    label: 'Cividis',
    stops: ['#00224e', '#123570', '#3b496c', '#575d6d', '#707173', '#8a8678', '#a59c74', '#c3b369', '#e1cc55', '#fee838'],
    description: 'Optimised for colour-vision deficiency.',
  },
];

/** Diverging scale for differences: blue (lower) ↔ neutral gray ↔ red (higher). */
export const DIVERGING_STOPS = ['#0d366b', '#256abf', '#6da7ec', '#b7d3f6', '#ecebe6', '#f6c4b8', '#ec8a7b', '#d03b3b', '#8f1d1d'];

/** Neutral gray used for "no image here" (always drawn with hatching). */
export const NO_DATA_HEX = '#a9a8a2';
/** Neutral for parts of the model outside the sectioned length. */
export const UNSECTIONED_HEX = '#d9d8d2';

/** Categorical slots for treatment groups (fixed order, light / dark mode). */
export const SERIES_LIGHT = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'];
export const SERIES_DARK = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#0ca30c', '#9085e9', '#e66767'];

export function seriesColor(slot: number, dark = false): string {
  const arr = dark ? SERIES_DARK : SERIES_LIGHT;
  return arr[((slot % arr.length) + arr.length) % arr.length];
}

/** Ordinal blue ramp used to tell sections apart (proximal light → distal dark). */
const SECTION_RAMP = ['#86b6ef', '#6da7ec', '#5598e7', '#3987e5', '#2a78d6', '#256abf', '#1c5cab', '#184f95', '#104281'];
export function sectionColor(index: number, count: number): string {
  if (count <= 1) return SECTION_RAMP[3];
  const t = index / (count - 1);
  return sampleHex(SECTION_RAMP, t * 0.85);
}

export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const v = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  return [parseInt(v.slice(0, 2), 16), parseInt(v.slice(2, 4), 16), parseInt(v.slice(4, 6), 16)];
}

export function rgbToHex(r: number, g: number, b: number): string {
  const c = (x: number) => Math.round(Math.max(0, Math.min(255, x))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

export function sampleStops(stops: string[], t: number): [number, number, number] {
  const x = Math.max(0, Math.min(1, Number.isFinite(t) ? t : 0)) * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(x));
  const f = x - i;
  const a = hexToRgb(stops[i]);
  const b = hexToRgb(stops[i + 1]);
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
}

export function sampleHex(stops: string[], t: number): string {
  const [r, g, b] = sampleStops(stops, t);
  return rgbToHex(r, g, b);
}

/** Quantises t into `steps` bins (0 = continuous). */
export function quantize(t: number, steps: number): number {
  if (!steps || steps < 2) return t;
  const bin = Math.min(steps - 1, Math.floor(Math.max(0, Math.min(1, t)) * steps));
  return bin / (steps - 1);
}

export function paletteStops(id: PaletteId | 'diverging'): string[] {
  if (id === 'diverging') return DIVERGING_STOPS;
  return (PALETTES.find((p) => p.id === id) ?? PALETTES[0]).stops;
}

/** 256×1 RGBA lookup table for the GPU. */
export function buildColormapLUT(stops: string[], steps: number, size = 256): Uint8Array {
  const out = new Uint8Array(size * 4);
  for (let i = 0; i < size; i++) {
    const t = quantize(i / (size - 1), steps);
    const [r, g, b] = sampleStops(stops, t);
    out[i * 4] = Math.round(r);
    out[i * 4 + 1] = Math.round(g);
    out[i * 4 + 2] = Math.round(b);
    out[i * 4 + 3] = 255;
  }
  return out;
}

export interface ScaleSpec {
  stops: string[];
  min: number;
  max: number;
  steps: number;
}

export function normalize(value: number, min: number, max: number): number {
  if (!(max > min)) return 0;
  return Math.max(0, Math.min(1, (value - min) / (max - min)));
}

export function colorForValue(value: number | null | undefined, s: ScaleSpec): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return NO_DATA_HEX;
  return sampleHex(s.stops, quantize(normalize(value, s.min, s.max), s.steps));
}

/** Text colour (near-black or white) that reads on a given fill. */
export function inkOn(hex: string): string {
  const [r, g, b] = hexToRgb(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  const L = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return L > 0.36 ? '#0b0b0b' : '#ffffff';
}

// ── Nice numbers for axes and scales ─────────────────────────────────────────

export function niceNumber(x: number, round: boolean): number {
  if (!(x > 0)) return 0;
  const exp = Math.floor(Math.log10(x));
  const f = x / Math.pow(10, exp);
  let nf: number;
  if (round) nf = f < 1.5 ? 1 : f < 2.25 ? 2 : f < 3.5 ? 2.5 : f < 7.5 ? 5 : 10;
  else nf = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
  return nf * Math.pow(10, exp);
}

/** Smallest "nice" number ≥ x, e.g. 23.4 → 25, 61 → 80?  (uses 1/2/2.5/4/5/6/8 steps) */
export function niceCeil(x: number): number {
  if (!(x > 0)) return 1;
  const exp = Math.floor(Math.log10(x));
  const base = Math.pow(10, exp);
  for (const m of [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) {
    const v = m * base;
    if (v >= x - 1e-9) return +v.toPrecision(6);
  }
  return 10 * base;
}

export function niceTicks(min: number, max: number, count = 5): number[] {
  if (!(max > min)) return [min];
  const range = niceNumber(max - min, false);
  const step = niceNumber(range / Math.max(1, count - 1), true);
  const start = Math.ceil(min / step - 1e-9) * step;
  const ticks: number[] = [];
  for (let v = start; v <= max + step * 1e-6; v += step) ticks.push(+v.toFixed(10));
  return ticks;
}

export function formatPercent(v: number | null | undefined, digits = 1): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '–';
  return `${v.toFixed(digits)}%`;
}

