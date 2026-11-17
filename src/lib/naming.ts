/**
 * Image naming convention (see README):
 *
 *   BRS24-10_4x_2_T_M2
 *   │        │  │ │ └─ position within the section: P (proximal), M1, M2, … (medial), D (distal)
 *   │        │  │ └─── side of the vessel: T (top) or B (bottom)
 *   │        │  └───── section number (1–N, proximal → distal)
 *   │        └──────── magnification (normally 4x)
 *   └───────────────── bioreactor ID (identifies the vessel and its treatment)
 *
 * The parser is deliberately forgiving about case, file extensions, spaces vs.
 * underscores, spelled-out words (Top, Prox, Med2…) and trailing suffixes such as
 * "_2" or "_trace", and gives a plain-language reason when a name can't be read.
 */

export type Side = 'T' | 'B';

export interface ParsedName {
  /** Bioreactor ID as written in the file name (original capitalisation). */
  bioreactor: string;
  /** Magnification such as "4x", or null when the name has none. */
  magnification: string | null;
  /** Section number, 1-based, numbered proximal → distal. */
  section: number;
  side: Side;
  /** "P", "M1", "M2", …, or "D". A bare "M" is read as "M1". */
  position: string;
  /** Anything after the position, e.g. "2" for a second field of view. */
  suffix: string;
  /** True when the suffix marks a traced-outline / mask overlay of another image. */
  overlay: boolean;
}

export type ParseResult = { ok: true; value: ParsedName } | { ok: false; error: string };

export const NAME_EXAMPLE = 'BRS24-10_4x_2_T_M2';
export const NAME_PATTERN_HELP = 'BIOREACTOR_MAGNIFICATION_SECTION_SIDE_POSITION, for example BRS24-10_4x_2_T_M2';

const KNOWN_EXT =
  /\.(tiff?|jpe?g|jfif|png|bmp|gif|webp|avif|heic|heif|jp2|czi|nd2|lif|svs|vsi|ome\.tiff?)$/i;
const GENERIC_EXT = /\.[a-z][a-z0-9]{1,4}$/i;

const OVERLAY_WORDS = new Set([
  'trace',
  'traced',
  'tracing',
  'mask',
  'masked',
  'outline',
  'outlined',
  'overlay',
  'annotated',
  'annotation',
  'annot',
  'roi',
  'damage',
  'damaged',
  'seg',
  'segmented',
  'segmentation',
]);

/** Removes a file extension such as ".tif" (and ".ome.tif"). */
export function stripExtension(name: string): string {
  const trimmed = name.trim();
  if (KNOWN_EXT.test(trimmed)) return trimmed.replace(KNOWN_EXT, '');
  if (GENERIC_EXT.test(trimmed)) return trimmed.replace(GENERIC_EXT, '');
  return trimmed;
}

/** Key used to match an image file to a row in the damage spreadsheet. */
export function nameKey(name: string): string {
  return stripExtension(String(name))
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '_');
}

/** Case-insensitive key for a bioreactor ID. */
export function vesselKey(id: string): string {
  return String(id).trim().toUpperCase().replace(/\s+/g, ' ');
}

const MAG_RE = /^(\d+(?:\.\d+)?)\s*[xX]$/;
const SECTION_RE = /^(?:s|sec|section)?0*(\d{1,2})$/i;

function readSection(tok: string | undefined): number | null {
  if (!tok) return null;
  const m = SECTION_RE.exec(tok);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  return n >= 1 && n <= 99 ? n : null;
}

function readSide(tok: string | undefined): Side | null {
  if (!tok) return null;
  const t = tok.toLowerCase();
  if (t === 't' || t === 'top') return 'T';
  if (t === 'b' || t === 'bot' || t === 'bottom' || t === 'btm') return 'B';
  return null;
}

function readPosition(tok: string | undefined): string | null {
  if (!tok) return null;
  const t = tok.toLowerCase();
  if (t === 'p' || t === 'prox' || t === 'proximal') return 'P';
  if (t === 'd' || t === 'dist' || t === 'distal') return 'D';
  const m = /^(?:m|med|medial|mid)-?0*(\d{0,2})$/.exec(t);
  if (m) {
    const n = m[1] ? parseInt(m[1], 10) : 1;
    if (n >= 1 && n <= 12) return `M${n}`;
  }
  return null;
}

function tokenize(base: string): string[] {
  const raw = base
    .trim()
    .split(/[_\s]+/)
    .filter((t) => t.length > 0);
  // Join a spelled-out section word with its number: "section 2" → "section2".
  const out: string[] = [];
  for (let i = 0; i < raw.length; i++) {
    if (/^(s|sec|section)$/i.test(raw[i]) && i + 1 < raw.length && /^\d{1,2}$/.test(raw[i + 1])) {
      out.push(raw[i] + raw[i + 1]);
      i++;
    } else out.push(raw[i]);
  }
  return out;
}

function build(
  tokens: string[],
  bioEnd: number,
  magnification: string | null,
  sectionIdx: number,
): ParseResult {
  const bioreactor = tokens.slice(0, bioEnd).join('_');
  if (!bioreactor) return { ok: false, error: 'The bioreactor ID is missing at the start of the name.' };
  const secTok = tokens[sectionIdx];
  const sideTok = tokens[sectionIdx + 1];
  const posTok = tokens[sectionIdx + 2];
  const section = readSection(secTok);
  if (section === null) {
    return {
      ok: false,
      error: secTok
        ? `"${secTok}" isn't a section number. Expected a number such as 2 after the magnification.`
        : 'The section number is missing after the magnification.',
    };
  }
  const side = readSide(sideTok);
  if (side === null) {
    return {
      ok: false,
      error: sideTok
        ? `"${sideTok}" isn't a side. Use T for top or B for bottom.`
        : 'The side (T or B) is missing after the section number.',
    };
  }
  const position = readPosition(posTok);
  if (position === null) {
    return {
      ok: false,
      error: posTok
        ? `"${posTok}" isn't a position. Use P (proximal), M1, M2, … (medial) or D (distal).`
        : 'The position (P, M1, M2, … or D) is missing after the side.',
    };
  }
  const suffixTokens = tokens.slice(sectionIdx + 3);
  const overlay = suffixTokens.some((t) => OVERLAY_WORDS.has(t.toLowerCase().replace(/[^a-z]/g, '')));
  return {
    ok: true,
    value: {
      bioreactor,
      magnification,
      section,
      side,
      position,
      suffix: suffixTokens.join('_'),
      overlay,
    },
  };
}

/** Parses an image or spreadsheet name that follows the lab's naming convention. */
export function parseImageName(rawName: string): ParseResult {
  const base = stripExtension(String(rawName ?? ''));
  if (!base) return { ok: false, error: 'The name is empty.' };
  const tokens = tokenize(base);
  if (tokens.length < 4) {
    return {
      ok: false,
      error: `The name has too few parts. Expected ${NAME_PATTERN_HELP}.`,
    };
  }

  // Preferred: the magnification token (e.g. "4x") anchors everything after it.
  for (let k = 1; k < tokens.length; k++) {
    const m = MAG_RE.exec(tokens[k]);
    if (m) {
      return build(tokens, k, `${m[1]}x`, k + 1);
    }
  }

  // Fallback: no magnification. Look for SECTION SIDE POSITION from the left.
  for (let i = 1; i + 2 < tokens.length; i++) {
    if (readSection(tokens[i]) !== null && readSide(tokens[i + 1]) && readPosition(tokens[i + 2])) {
      return build(tokens, i, null, i);
    }
  }

  // Give the most useful explanation we can.
  const hasSide = tokens.some((t) => readSide(t));
  const hasPos = tokens.some((t, i) => i > 0 && readPosition(t));
  if (!hasSide) return { ok: false, error: `No side found. The name needs T (top) or B (bottom), e.g. ${NAME_EXAMPLE}.` };
  if (!hasPos)
    return { ok: false, error: `No position found. The name needs P, M1, M2, … or D at the end, e.g. ${NAME_EXAMPLE}.` };
  return {
    ok: false,
    error: `The parts aren't in the expected order. Expected ${NAME_PATTERN_HELP}.`,
  };
}

// ── Positions ───────────────────────────────────────────────────────────────

/** Positions along a section from proximal to distal: P, M1…Mk, D. */
export function positionsForSection(medialCount: number): string[] {
  const k = Math.max(1, Math.floor(medialCount));
  const out = ['P'];
  for (let i = 1; i <= k; i++) out.push(`M${i}`);
  out.push('D');
  return out;
}

/** Index of a position within its section (0 = proximal end). */
export function positionSlot(position: string, medialCount: number): number {
  if (position === 'P') return 0;
  if (position === 'D') return Math.max(1, medialCount) + 1;
  const n = parseInt(position.slice(1), 10);
  return Math.min(Math.max(1, n || 1), Math.max(1, medialCount));
}

export function medialIndex(position: string): number {
  if (position.startsWith('M')) return parseInt(position.slice(1), 10) || 1;
  return 0;
}

export function positionLabel(position: string, medialCount = 2): string {
  if (position === 'P') return 'Proximal';
  if (position === 'D') return 'Distal';
  const n = medialIndex(position);
  return medialCount <= 1 ? 'Medial' : `Medial ${n}`;
}

export function positionShort(position: string, medialCount = 2): string {
  if (position === 'P' || position === 'D') return position;
  return medialCount <= 1 ? 'M' : position;
}

export function sideLabel(side: Side): string {
  return side === 'T' ? 'Top' : 'Bottom';
}

/** Sorts positions proximal → distal. */
export function comparePositions(a: string, b: string): number {
  const rank = (p: string) => (p === 'P' ? 0 : p === 'D' ? 1000 : medialIndex(p));
  return rank(a) - rank(b);
}

/** Natural sort for IDs like BRS24-2 vs BRS24-10. */
export function naturalCompare(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
}

/** Builds a name in the convention (used by templates and the demo study). */
export function formatImageName(p: {
  bioreactor: string;
  magnification?: string | null;
  section: number;
  side: Side;
  position: string;
  suffix?: string;
}): string {
  const parts = [p.bioreactor];
  if (p.magnification) parts.push(p.magnification);
  parts.push(String(p.section), p.side, p.position);
  if (p.suffix) parts.push(p.suffix);
  return parts.join('_');
}
