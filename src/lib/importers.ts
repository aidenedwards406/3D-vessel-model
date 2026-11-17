/**
 * Turns spreadsheets into study data:
 *  - the damage sheet (image name + percent damage, optional treatment column)
 *  - the treatment key (bioreactor ID → treatment)
 * Column choices are guessed automatically and can be changed by the user.
 */
import { nameKey, parseImageName, vesselKey } from './naming';
import { cellText, type Cell, type Sheet } from './spreadsheet';

export type DamageUnits = 'percent' | 'fraction';

export interface DamageMapping {
  sheetIndex: number;
  /** Header row index, or -1 when the sheet has no header. */
  headerRow: number;
  nameCol: number;
  damageCol: number;
  treatmentCol: number | null;
  units: DamageUnits;
}

export interface DamageRow {
  /** Name exactly as written in the sheet. */
  name: string;
  /** Normalised key used to match image files. */
  key: string;
  /** Percent damage, 0–100. */
  damage: number;
  treatment?: string;
  /** 1-based row number in the sheet, for messages. */
  rowNumber: number;
}

export interface SkippedRow {
  rowNumber: number;
  name: string;
  reason: string;
}

export interface DamageImport {
  rows: DamageRow[];
  skipped: SkippedRow[];
  /** Values look like fractions (all between 0 and 1) but aren't formatted as percentages. */
  ambiguousUnits: boolean;
  /** Cells were formatted as percentages in Excel. */
  percentFormatted: boolean;
}

const DAMAGE_HEADER = /damage|injur|%|percent|pct|area|lesion/i;
const TREATMENT_HEADER = /treat|group|condition|device|arm|cohort|catheter/i;
const VESSEL_HEADER = /bioreactor|vessel|brs|sample|specimen|reactor|\bid\b/i;
const NAME_HEADER = /image|file|name|picture|photo/i;

function numeric(c: Cell | undefined): number | null {
  if (!c || c.v === null) return null;
  if (typeof c.v === 'number') return Number.isFinite(c.v) ? c.v : null;
  if (typeof c.v === 'string') {
    const t = c.v.trim().replace(/%$/, '').trim();
    if (/^-?(\d+([.,]\d*)?|[.,]\d+)$/.test(t)) return Number(t.replace(',', '.'));
  }
  return null;
}

function maxCols(sheet: Sheet, limit = 600): number {
  let m = 0;
  for (let r = 0; r < Math.min(sheet.rows.length, limit); r++) m = Math.max(m, sheet.rows[r]?.length ?? 0);
  return m;
}

export function columnLetter(c: number): string {
  let s = '';
  let n = c + 1;
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/** Column labels such as "B · % Damage" for pickers. */
export function columnLabels(sheet: Sheet, headerRow: number): string[] {
  const n = maxCols(sheet);
  return Array.from({ length: n }, (_v, c) => {
    const h = headerRow >= 0 ? cellText(sheet.rows[headerRow]?.[c]) : '';
    return h ? `${columnLetter(c)} · ${h}` : `Column ${columnLetter(c)}`;
  });
}

interface SheetScan {
  nameCol: number;
  nameHits: number;
  firstDataRow: number;
}

function scanNames(sheet: Sheet): SheetScan {
  const cols = maxCols(sheet);
  let best: SheetScan = { nameCol: 0, nameHits: 0, firstDataRow: 0 };
  for (let c = 0; c < cols; c++) {
    let hits = 0;
    let first = -1;
    for (let r = 0; r < Math.min(sheet.rows.length, 600); r++) {
      const t = cellText(sheet.rows[r]?.[c]);
      if (t && parseImageName(t).ok) {
        hits++;
        if (first === -1) first = r;
      }
    }
    if (hits > best.nameHits) best = { nameCol: c, nameHits: hits, firstDataRow: Math.max(0, first) };
  }
  return best;
}

function detectHeaderRow(sheet: Sheet, firstDataRow: number): number {
  if (firstDataRow <= 0) {
    // Is row 0 a header (mostly text that isn't data)?
    const row = sheet.rows[0] ?? [];
    const texts = row.filter((c) => typeof c?.v === 'string' && !parseImageName(String(c.v)).ok).length;
    const nums = row.filter((c) => typeof c?.v === 'number').length;
    return texts > 0 && nums === 0 && sheet.rows.length > 1 ? 0 : -1;
  }
  for (let r = firstDataRow - 1; r >= 0; r--) {
    const row = sheet.rows[r] ?? [];
    if (row.some((c) => typeof c?.v === 'string' && c.v.trim() !== '')) return r;
  }
  return -1;
}

export function guessDamageMapping(sheets: Sheet[]): DamageMapping {
  let sheetIndex = 0;
  let scan: SheetScan = { nameCol: 0, nameHits: -1, firstDataRow: 0 };
  sheets.forEach((s, i) => {
    const sc = scanNames(s);
    if (sc.nameHits > scan.nameHits) {
      scan = sc;
      sheetIndex = i;
    }
  });
  const sheet = sheets[sheetIndex];
  let headerRow = detectHeaderRow(sheet, scan.firstDataRow);
  // If nothing parses as an image name, fall back to a column whose header says "image/file/name".
  if (scan.nameHits <= 0) {
    headerRow = detectHeaderRow(sheet, 1);
    const header = sheet.rows[headerRow] ?? [];
    const idx = header.findIndex((c) => NAME_HEADER.test(cellText(c)));
    scan = { nameCol: idx >= 0 ? idx : 0, nameHits: 0, firstDataRow: headerRow + 1 };
  }
  const cols = maxCols(sheet);
  const header = headerRow >= 0 ? (sheet.rows[headerRow] ?? []) : [];
  const dataStart = headerRow + 1;
  const dataEnd = Math.min(sheet.rows.length, dataStart + 600);

  let damageCol = -1;
  let bestScore = -1;
  let treatmentCol: number | null = null;
  for (let c = 0; c < cols; c++) {
    if (c === scan.nameCol) continue;
    let nums = 0;
    let texts = 0;
    let filled = 0;
    let inRange = 0;
    for (let r = dataStart; r < dataEnd; r++) {
      const cell = sheet.rows[r]?.[c];
      if (!cell || cell.v === null) continue;
      filled++;
      const n = numeric(cell);
      if (n !== null) {
        nums++;
        if (n >= 0 && n <= (cell.pct ? 1 : 100)) inRange++;
      } else texts++;
    }
    const h = cellText(header[c]);
    if (filled > 0 && nums / filled >= 0.6) {
      let score = inRange / filled;
      if (DAMAGE_HEADER.test(h)) score += 2;
      if (/mag|section|position|row|#|count|n$/i.test(h)) score -= 1;
      if (score > bestScore) {
        bestScore = score;
        damageCol = c;
      }
    }
    if (treatmentCol === null && filled > 0 && texts / filled >= 0.6 && TREATMENT_HEADER.test(h)) {
      treatmentCol = c;
    }
  }
  if (damageCol < 0) damageCol = scan.nameCol + 1 < cols ? scan.nameCol + 1 : 0;

  // Units
  let pctCells = 0;
  for (let r = dataStart; r < dataEnd; r++) if (sheet.rows[r]?.[damageCol]?.pct) pctCells++;

  return {
    sheetIndex,
    headerRow,
    nameCol: scan.nameCol,
    damageCol,
    treatmentCol,
    units: pctCells > 0 ? 'fraction' : 'percent',
  };
}

export function extractDamage(sheets: Sheet[], m: DamageMapping): DamageImport {
  const sheet = sheets[m.sheetIndex];
  const rows: DamageRow[] = [];
  const skipped: SkippedRow[] = [];
  let maxAbs = 0;
  let pctFormatted = false;
  let count = 0;
  if (!sheet) return { rows, skipped, ambiguousUnits: false, percentFormatted: false };
  for (let r = m.headerRow + 1; r < sheet.rows.length; r++) {
    const row = sheet.rows[r] ?? [];
    const name = cellText(row[m.nameCol]);
    const cell = row[m.damageCol];
    if (!name && (!cell || cell.v === null)) continue; // blank line
    if (!name) {
      skipped.push({ rowNumber: r + 1, name: '', reason: 'No image name in this row.' });
      continue;
    }
    const value = numeric(cell);
    if (value === null) {
      skipped.push({
        rowNumber: r + 1,
        name,
        reason: cell && cell.v !== null ? `"${cellText(cell)}" isn't a number.` : 'No damage value.',
      });
      continue;
    }
    if (cell?.pct) pctFormatted = true;
    let damage = value;
    if (m.units === 'fraction') damage = value * 100;
    if (damage < 0 || damage > 100.0001) {
      skipped.push({ rowNumber: r + 1, name, reason: `${+damage.toFixed(3)}% is outside 0–100%.` });
      continue;
    }
    maxAbs = Math.max(maxAbs, Math.abs(value));
    count++;
    const treatment = m.treatmentCol !== null ? cellText(row[m.treatmentCol]) || undefined : undefined;
    rows.push({ name, key: nameKey(name), damage: Math.min(100, Math.max(0, damage)), treatment, rowNumber: r + 1 });
  }
  return {
    rows,
    skipped,
    ambiguousUnits: count > 0 && m.units === 'percent' && !pctFormatted && maxAbs <= 1,
    percentFormatted: pctFormatted,
  };
}

// ── Treatment key ───────────────────────────────────────────────────────────

export interface TreatmentKeyMapping {
  sheetIndex: number;
  headerRow: number;
  vesselCol: number;
  treatmentCol: number;
}

export interface TreatmentKeyEntry {
  vessel: string;
  treatment: string;
}

export function guessTreatmentKeyMapping(sheets: Sheet[], knownVessels: string[]): TreatmentKeyMapping {
  const known = new Set(knownVessels.map(vesselKey));
  let best: TreatmentKeyMapping = { sheetIndex: 0, headerRow: 0, vesselCol: 0, treatmentCol: 1 };
  let bestScore = -1;
  sheets.forEach((sheet, si) => {
    const cols = maxCols(sheet);
    const header = sheet.rows[0] ?? [];
    const headerLooksLikeHeader = header.some((c) => typeof c?.v === 'string') && sheet.rows.length > 1;
    const headerRow = headerLooksLikeHeader ? 0 : -1;
    let vCol = -1;
    let vScore = -1;
    for (let c = 0; c < cols; c++) {
      let hits = 0;
      let filled = 0;
      for (let r = headerRow + 1; r < Math.min(sheet.rows.length, 500); r++) {
        const t = cellText(sheet.rows[r]?.[c]);
        if (!t) continue;
        filled++;
        if (known.has(vesselKey(t))) hits++;
      }
      let score = known.size ? hits : 0;
      if (VESSEL_HEADER.test(cellText(header[c]))) score += 0.5;
      if (filled === 0) score = -1;
      if (score > vScore) {
        vScore = score;
        vCol = c;
      }
    }
    let tCol = -1;
    for (let c = 0; c < cols; c++) {
      if (c !== vCol && TREATMENT_HEADER.test(cellText(header[c]))) {
        tCol = c;
        break;
      }
    }
    if (tCol < 0) {
      for (let c = 0; c < cols; c++) {
        if (c === vCol) continue;
        const sample = cellText(sheet.rows[headerRow + 1]?.[c]);
        if (sample && typeof sheet.rows[headerRow + 1]?.[c]?.v === 'string') {
          tCol = c;
          break;
        }
      }
    }
    if (tCol < 0) tCol = vCol === 0 ? 1 : 0;
    const score = vScore + (/treat|key/i.test(sheet.name) ? 0.25 : 0);
    if (score > bestScore) {
      bestScore = score;
      best = { sheetIndex: si, headerRow, vesselCol: Math.max(0, vCol), treatmentCol: tCol };
    }
  });
  return best;
}

export function extractTreatmentKey(sheets: Sheet[], m: TreatmentKeyMapping): TreatmentKeyEntry[] {
  const sheet = sheets[m.sheetIndex];
  if (!sheet) return [];
  const out: TreatmentKeyEntry[] = [];
  const seen = new Set<string>();
  for (let r = m.headerRow + 1; r < sheet.rows.length; r++) {
    const row = sheet.rows[r] ?? [];
    const vessel = cellText(row[m.vesselCol]);
    const treatment = cellText(row[m.treatmentCol]);
    if (!vessel || !treatment) continue;
    const k = vesselKey(vessel);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ vessel, treatment });
  }
  return out;
}

/** Treatment key embedded as a column in the damage sheet. */
export function treatmentKeyFromDamageRows(rows: DamageRow[]): TreatmentKeyEntry[] {
  const out = new Map<string, TreatmentKeyEntry>();
  for (const r of rows) {
    if (!r.treatment) continue;
    const p = parseImageName(r.name);
    if (!p.ok) continue;
    const k = vesselKey(p.value.bioreactor);
    if (!out.has(k)) out.set(k, { vessel: p.value.bioreactor, treatment: r.treatment });
  }
  return [...out.values()];
}

/** Guesses a role from a treatment name, used for sensible default ordering/colours. */
export function guessRole(name: string): 'control' | 'investigational' | 'standard' | 'other' {
  const n = name.toLowerCase();
  if (/control|baseline|sham|no device|untreated|ctrl/.test(n)) return 'control';
  if (/investig|new|test device|novel|candidate|experimental|ide\b/.test(n)) return 'investigational';
  if (/market|standard|predicate|comparator|reference|approved|soc\b|commercial/.test(n)) return 'standard';
  return 'other';
}
