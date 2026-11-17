/**
 * Minimal, dependency-free spreadsheet reading and writing.
 *
 *  - .xlsx / .xlsm (Office Open XML) read with a small streaming XML tokenizer
 *    on top of fflate's unzip. Shared strings, inline strings, rich text,
 *    formulas (cached values), booleans and percent number formats are handled.
 *  - .csv / .tsv / .txt with delimiter detection (comma, semicolon, tab).
 *  - .xlsx writing for templates and data exports.
 *
 * Everything runs in the browser (or a worker); nothing is uploaded.
 */
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';

export type CellValue = string | number | boolean | null;

export interface Cell {
  v: CellValue;
  /** The cell is formatted as a percentage (v holds the fraction, e.g. 0.125 for 12.5%). */
  pct?: boolean;
}

export interface Sheet {
  name: string;
  rows: Cell[][];
}

export class SpreadsheetError extends Error {}

// ── XML tokenizer ───────────────────────────────────────────────────────────

interface XmlHandlers {
  open?(name: string, attrs: Record<string, string>, selfClosing: boolean): void;
  close?(name: string): void;
  text?(text: string): void;
}

const ENTITY_RE = /&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g;

export function decodeEntities(s: string): string {
  if (s.indexOf('&') === -1) return s;
  return s.replace(ENTITY_RE, (_m, e: string) => {
    switch (e) {
      case 'amp':
        return '&';
      case 'lt':
        return '<';
      case 'gt':
        return '>';
      case 'quot':
        return '"';
      case 'apos':
        return "'";
      default:
        if (e[1] === 'x' || e[1] === 'X') return String.fromCodePoint(parseInt(e.slice(2), 16));
        return String.fromCodePoint(parseInt(e.slice(1), 10));
    }
  });
}

function localName(qname: string): string {
  const i = qname.indexOf(':');
  return i === -1 ? qname : qname.slice(i + 1);
}

const ATTR_RE = /([^\s=/]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

/** Streams an XML document through callbacks. Element names have prefixes removed. */
export function scanXml(xml: string, h: XmlHandlers): void {
  let i = 0;
  const n = xml.length;
  while (i < n) {
    const lt = xml.indexOf('<', i);
    if (lt === -1) {
      if (h.text && i < n) h.text(decodeEntities(xml.slice(i)));
      break;
    }
    if (lt > i && h.text) h.text(decodeEntities(xml.slice(i, lt)));
    const c1 = xml.charCodeAt(lt + 1);
    if (c1 === 63 /* ? */) {
      const end = xml.indexOf('?>', lt + 2);
      i = end === -1 ? n : end + 2;
      continue;
    }
    if (c1 === 33 /* ! */) {
      if (xml.startsWith('<!--', lt)) {
        const end = xml.indexOf('-->', lt + 4);
        i = end === -1 ? n : end + 3;
      } else if (xml.startsWith('<![CDATA[', lt)) {
        const end = xml.indexOf(']]>', lt + 9);
        const stop = end === -1 ? n : end;
        if (h.text) h.text(xml.slice(lt + 9, stop));
        i = end === -1 ? n : end + 3;
      } else {
        const end = xml.indexOf('>', lt + 2);
        i = end === -1 ? n : end + 1;
      }
      continue;
    }
    // Find the end of the tag, respecting quoted attribute values.
    let j = lt + 1;
    let quote = 0;
    while (j < n) {
      const c = xml.charCodeAt(j);
      if (quote) {
        if (c === quote) quote = 0;
      } else if (c === 34 || c === 39) {
        quote = c;
      } else if (c === 62 /* > */) {
        break;
      }
      j++;
    }
    const body = xml.slice(lt + 1, j);
    i = j + 1;
    if (body.charCodeAt(0) === 47 /* / */) {
      h.close?.(localName(body.slice(1).trim()));
      continue;
    }
    const selfClosing = body.charCodeAt(body.length - 1) === 47;
    const inner = selfClosing ? body.slice(0, -1) : body;
    const sp = inner.search(/\s/);
    const qname = sp === -1 ? inner : inner.slice(0, sp);
    const name = localName(qname);
    const attrs: Record<string, string> = {};
    if (sp !== -1 && h.open) {
      const rest = inner.slice(sp);
      ATTR_RE.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = ATTR_RE.exec(rest))) {
        attrs[m[1]] = decodeEntities(m[2] ?? m[3] ?? '');
      }
    }
    h.open?.(name, attrs, selfClosing);
    if (selfClosing) h.close?.(name);
  }
}

function attrLocal(attrs: Record<string, string>, local: string): string | undefined {
  if (local in attrs) return attrs[local];
  for (const k in attrs) {
    if (localName(k) === local) return attrs[k];
  }
  return undefined;
}

// ── XLSX reading ────────────────────────────────────────────────────────────

function colIndexFromRef(ref: string): number {
  let col = 0;
  for (let i = 0; i < ref.length; i++) {
    const c = ref.charCodeAt(i);
    if (c >= 65 && c <= 90) col = col * 26 + (c - 64);
    else if (c >= 97 && c <= 122) col = col * 26 + (c - 96);
    else break;
  }
  return col - 1;
}

function rowIndexFromRef(ref: string): number {
  const m = /(\d+)$/.exec(ref);
  return m ? parseInt(m[1], 10) - 1 : -1;
}

function resolvePart(target: string, baseDir: string): string {
  let t = target.replace(/\\/g, '/');
  if (t.startsWith('/')) return t.slice(1);
  const parts = (baseDir ? baseDir.split('/') : []).filter(Boolean);
  for (const seg of t.split('/')) {
    if (seg === '..') parts.pop();
    else if (seg !== '.' && seg !== '') parts.push(seg);
  }
  t = parts.join('/');
  return t;
}

function isPercentFormat(code: string): boolean {
  // Ignore % inside quoted literals or escaped with a backslash.
  let inQuote = false;
  for (let i = 0; i < code.length; i++) {
    const c = code[i];
    if (c === '"') inQuote = !inQuote;
    else if (!inQuote && c === '\\') i++;
    else if (!inQuote && c === '%') return true;
  }
  return false;
}

export function isZip(data: Uint8Array): boolean {
  return data.length > 4 && data[0] === 0x50 && data[1] === 0x4b && data[2] === 0x03 && data[3] === 0x04;
}

export function readXlsx(data: Uint8Array): Sheet[] {
  if (!isZip(data)) {
    if (data.length > 8 && data[0] === 0xd0 && data[1] === 0xcf) {
      throw new SpreadsheetError(
        'This is an older Excel 97–2003 (.xls) file. Please open it in Excel and save it as .xlsx (or .csv), then try again.',
      );
    }
    throw new SpreadsheetError("This file isn't a valid .xlsx workbook.");
  }
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(data, {
      filter: (f) => f.name.endsWith('.xml') || f.name.endsWith('.rels'),
    });
  } catch {
    throw new SpreadsheetError("The workbook couldn't be opened. It may be damaged or password-protected.");
  }
  const get = (path: string): string | null => {
    const direct = files[path];
    if (direct) return strFromU8(direct);
    const lower = path.toLowerCase();
    for (const k in files) if (k.toLowerCase() === lower) return strFromU8(files[k]);
    return null;
  };

  // Locate the workbook part through the package relationships.
  let workbookPath = 'xl/workbook.xml';
  const rootRels = get('_rels/.rels');
  if (rootRels) {
    scanXml(rootRels, {
      open(name, a) {
        if (name === 'Relationship' && /officeDocument$/.test(a.Type ?? '')) {
          workbookPath = resolvePart(a.Target ?? workbookPath, '');
        }
      },
    });
  }
  const wbXml = get(workbookPath);
  if (!wbXml) {
    throw new SpreadsheetError(
      "This workbook has no sheets that can be read. If it's password-protected, remove the password and try again.",
    );
  }
  const wbDir = workbookPath.includes('/') ? workbookPath.slice(0, workbookPath.lastIndexOf('/')) : '';
  const relsPath = `${wbDir ? wbDir + '/' : ''}_rels/${workbookPath.slice(workbookPath.lastIndexOf('/') + 1)}.rels`;
  const rels: Record<string, { target: string; type: string }> = {};
  const wbRels = get(relsPath);
  if (wbRels) {
    scanXml(wbRels, {
      open(name, a) {
        if (name === 'Relationship' && a.Id) {
          rels[a.Id] = { target: resolvePart(a.Target ?? '', wbDir), type: a.Type ?? '' };
        }
      },
    });
  }

  const sheetsMeta: { name: string; path: string }[] = [];
  scanXml(wbXml, {
    open(name, a) {
      if (name === 'sheet') {
        const rid = attrLocal(a, 'id');
        const rel = rid ? rels[rid] : undefined;
        const path = rel?.target ?? `${wbDir}/worksheets/sheet${sheetsMeta.length + 1}.xml`;
        const state = a.state;
        if (state !== 'veryHidden') sheetsMeta.push({ name: a.name ?? `Sheet${sheetsMeta.length + 1}`, path });
      }
    },
  });

  // Shared strings
  const sharedStrings: string[] = [];
  const ssRel = Object.values(rels).find((r) => /sharedStrings$/.test(r.type));
  const ssXml = get(ssRel?.target ?? `${wbDir}/sharedStrings.xml`);
  if (ssXml) {
    let cur = '';
    let inSi = false;
    let inT = false;
    let inPhonetic = 0;
    scanXml(ssXml, {
      open(name) {
        if (name === 'si') {
          inSi = true;
          cur = '';
        } else if (name === 'rPh') inPhonetic++;
        else if (name === 't' && inSi && !inPhonetic) inT = true;
      },
      close(name) {
        if (name === 'si') {
          sharedStrings.push(cur);
          inSi = false;
        } else if (name === 'rPh') inPhonetic--;
        else if (name === 't') inT = false;
      },
      text(t) {
        if (inT) cur += t;
      },
    });
  }

  // Styles → which style indexes are percentages
  const percentStyles = new Set<number>();
  const stylesRel = Object.values(rels).find((r) => /styles$/.test(r.type));
  const stylesXml = get(stylesRel?.target ?? `${wbDir}/styles.xml`);
  if (stylesXml) {
    const customPct = new Set<number>();
    let inCellXfs = false;
    let xfIndex = 0;
    scanXml(stylesXml, {
      open(name, a) {
        if (name === 'numFmt') {
          const id = parseInt(a.numFmtId ?? '-1', 10);
          if (isPercentFormat(a.formatCode ?? '')) customPct.add(id);
        } else if (name === 'cellXfs') {
          inCellXfs = true;
          xfIndex = 0;
        } else if (name === 'xf' && inCellXfs) {
          const id = parseInt(a.numFmtId ?? '0', 10);
          if (id === 9 || id === 10 || customPct.has(id)) percentStyles.add(xfIndex);
          xfIndex++;
        }
      },
      close(name) {
        if (name === 'cellXfs') inCellXfs = false;
      },
    });
  }

  const sheets: Sheet[] = [];
  for (const meta of sheetsMeta) {
    const xml = get(meta.path);
    if (!xml) continue;
    sheets.push({ name: meta.name, rows: parseSheetXml(xml, sharedStrings, percentStyles) });
  }
  if (sheets.length === 0) throw new SpreadsheetError('No readable sheets were found in this workbook.');
  return sheets;
}

function parseSheetXml(xml: string, shared: string[], percentStyles: Set<number>): Cell[][] {
  const rows: Cell[][] = [];
  let rowIdx = -1;
  let colCounter = 0;
  let cellCol = 0;
  let cellType = '';
  let cellStyle = -1;
  let capture: 'v' | 't' | null = null;
  let inInline = false;
  let vText = '';
  let tText = '';
  let inCell = false;

  scanXml(xml, {
    open(name, a) {
      switch (name) {
        case 'row': {
          const r = a.r ? parseInt(a.r, 10) - 1 : rowIdx + 1;
          rowIdx = r;
          colCounter = 0;
          break;
        }
        case 'c': {
          inCell = true;
          const ref = a.r;
          if (ref) {
            cellCol = colIndexFromRef(ref);
            const rr = rowIndexFromRef(ref);
            if (rr >= 0 && rr !== rowIdx) rowIdx = rr;
          } else {
            cellCol = colCounter;
          }
          if (rowIdx < 0) rowIdx = 0;
          colCounter = cellCol + 1;
          cellType = a.t ?? 'n';
          cellStyle = a.s ? parseInt(a.s, 10) : -1;
          vText = '';
          tText = '';
          inInline = false;
          break;
        }
        case 'v':
          if (inCell) capture = 'v';
          break;
        case 'is':
          if (inCell) inInline = true;
          break;
        case 't':
          if (inCell && inInline) capture = 't';
          break;
      }
    },
    close(name) {
      if (name === 'v' || name === 't') {
        capture = null;
        return;
      }
      if (name !== 'c' || !inCell) return;
      inCell = false;
      let v: CellValue = null;
      let pct = false;
      switch (cellType) {
        case 's': {
          const idx = parseInt(vText, 10);
          v = Number.isFinite(idx) ? (shared[idx] ?? '') : '';
          break;
        }
        case 'inlineStr':
          v = tText;
          break;
        case 'str':
          v = vText;
          break;
        case 'b':
          v = vText.trim() === '1';
          break;
        case 'e':
          v = null;
          break;
        case 'd':
          v = vText;
          break;
        default: {
          const t = vText.trim();
          if (t !== '') {
            const num = Number(t);
            v = Number.isFinite(num) ? num : t;
            if (typeof v === 'number' && percentStyles.has(cellStyle)) pct = true;
          }
        }
      }
      if (v === '' || v === null) return;
      const row = (rows[rowIdx] ??= []);
      row[cellCol] = pct ? { v, pct } : { v };
    },
    text(t) {
      if (capture === 'v') vText += t;
      else if (capture === 't') tText += t;
    },
  });

  // Densify (fill holes so callers can index safely)
  for (let r = 0; r < rows.length; r++) {
    const row = (rows[r] ??= []);
    for (let c = 0; c < row.length; c++) if (!row[c]) row[c] = { v: null };
  }
  return rows;
}

// ── CSV ─────────────────────────────────────────────────────────────────────

function detectDelimiter(text: string): string {
  const sample = text.slice(0, 20000).split(/\r?\n/).slice(0, 20);
  const cands = [',', ';', '\t', '|'];
  let best = ',';
  let bestScore = -1;
  for (const d of cands) {
    const counts = sample.filter((l) => l.length > 0).map((l) => l.split(d).length - 1);
    if (counts.length === 0) continue;
    const min = Math.min(...counts);
    const avg = counts.reduce((s, x) => s + x, 0) / counts.length;
    const score = min > 0 ? avg + min * 2 : 0;
    if (score > bestScore) {
      bestScore = score;
      best = d;
    }
  }
  return best;
}

function csvValue(raw: string, quoted: boolean): Cell {
  if (quoted) {
    // Quoted values may still be numbers ("12.5")
    const t = raw.trim();
    const pctMatch = /^(-?\d+(?:[.,]\d+)?)\s*%$/.exec(t);
    if (pctMatch) return { v: Number(pctMatch[1].replace(',', '.')) / 100, pct: true };
    return { v: raw };
  }
  const t = raw.trim();
  if (t === '') return { v: null };
  const pctMatch = /^(-?\d+(?:[.,]\d+)?)\s*%$/.exec(t);
  if (pctMatch) return { v: Number(pctMatch[1].replace(',', '.')) / 100, pct: true };
  if (/^-?(\d+([.]\d*)?|[.]\d+)(e[-+]?\d+)?$/i.test(t)) return { v: Number(t) };
  if (/^-?\d+,\d+$/.test(t)) return { v: Number(t.replace(',', '.')) }; // decimal comma
  if (/^(true|false)$/i.test(t)) return { v: t.toLowerCase() === 'true' };
  return { v: t };
}

export function readCsv(text: string, name = 'Sheet1'): Sheet {
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const delim = detectDelimiter(src);
  const rows: Cell[][] = [];
  let row: Cell[] = [];
  let field = '';
  let quoted = false;
  let inQuotes = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
      continue;
    }
    if (c === '"' && field.trim() === '') {
      inQuotes = true;
      quoted = true;
      field = '';
    } else if (c === delim) {
      row.push(csvValue(field, quoted));
      field = '';
      quoted = false;
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(csvValue(field, quoted));
      rows.push(row);
      row = [];
      field = '';
      quoted = false;
    } else field += c;
  }
  if (field !== '' || row.length > 0) {
    row.push(csvValue(field, quoted));
    rows.push(row);
  }
  // Drop fully empty trailing rows
  while (rows.length && rows[rows.length - 1].every((c) => c.v === null)) rows.pop();
  return { name, rows };
}

/** Reads .xlsx/.xlsm/.csv/.tsv/.txt from raw bytes. */
export function readSpreadsheet(fileName: string, data: Uint8Array): Sheet[] {
  const lower = fileName.toLowerCase();
  if (/\.(csv|tsv|txt)$/.test(lower) || (!isZip(data) && !(data[0] === 0xd0 && data[1] === 0xcf))) {
    const text = new TextDecoder('utf-8').decode(data);
    return [readCsv(text, fileName.replace(/\.[^.]+$/, ''))];
  }
  return readXlsx(data);
}

// ── Writing ─────────────────────────────────────────────────────────────────

export interface WriteSheet {
  name: string;
  rows: CellValue[][];
  colWidths?: number[];
  /** Freeze the first row (header). Default true. */
  freezeHeader?: boolean;
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    // Remove characters that are illegal in XML 1.0
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
}

function colRef(c: number): string {
  let s = '';
  let n = c + 1;
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function sanitizeSheetName(name: string, used: Set<string>): string {
  let s = name.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31).trim() || 'Sheet';
  let k = 2;
  const base = s;
  while (used.has(s.toLowerCase())) s = `${base.slice(0, 28)} ${k++}`;
  used.add(s.toLowerCase());
  return s;
}

export function writeXlsx(sheets: WriteSheet[]): Uint8Array<ArrayBuffer> {
  const used = new Set<string>();
  const names = sheets.map((s) => sanitizeSheetName(s.name, used));
  const files: Record<string, Uint8Array> = {};

  files['[Content_Types].xml'] = strToU8(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
${names
  .map(
    (_n, i) =>
      `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
  )
  .join('\n')}
</Types>`,
  );
  files['_rels/.rels'] = strToU8(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`,
  );
  files['xl/workbook.xml'] = strToU8(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets>${names.map((n, i) => `<sheet name="${escapeXml(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets>
</workbook>`,
  );
  files['xl/_rels/workbook.xml.rels'] = strToU8(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${names
  .map(
    (_n, i) =>
      `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`,
  )
  .join('\n')}
<Relationship Id="rId${names.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`,
  );
  // Style 0: default. Style 1: bold header with light fill and bottom border.
  files['xl/styles.xml'] = strToU8(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>
<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFEFEFEB"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left/><right/><top/><bottom style="thin"><color rgb="FFC3C2B7"/></bottom><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/></cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`,
  );

  sheets.forEach((sheet, si) => {
    const freeze = sheet.freezeHeader !== false && sheet.rows.length > 1;
    const maxCols = sheet.rows.reduce((m, r) => Math.max(m, r.length), 0);
    const widths =
      sheet.colWidths ??
      Array.from({ length: maxCols }, (_v, c) => {
        let w = 8;
        for (let r = 0; r < Math.min(sheet.rows.length, 200); r++) {
          const v = sheet.rows[r][c];
          if (v !== null && v !== undefined) w = Math.max(w, String(v).length + 2);
        }
        return Math.min(w, 60);
      });
    const cols = widths.length
      ? `<cols>${widths.map((w, c) => `<col min="${c + 1}" max="${c + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>`
      : '';
    const rowsXml = sheet.rows
      .map((row, r) => {
        const cells = row
          .map((v, c) => {
            if (v === null || v === undefined || v === '') return '';
            const ref = `${colRef(c)}${r + 1}`;
            const style = freeze && r === 0 ? ' s="1"' : '';
            if (typeof v === 'number' && Number.isFinite(v)) return `<c r="${ref}"${style}><v>${v}</v></c>`;
            if (typeof v === 'boolean') return `<c r="${ref}"${style} t="b"><v>${v ? 1 : 0}</v></c>`;
            return `<c r="${ref}"${style} t="inlineStr"><is><t xml:space="preserve">${escapeXml(String(v))}</t></is></c>`;
          })
          .join('');
        return `<row r="${r + 1}">${cells}</row>`;
      })
      .join('');
    const pane = freeze
      ? `<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>`
      : '';
    files[`xl/worksheets/sheet${si + 1}.xml`] = strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${pane}${cols}<sheetData>${rowsXml}</sheetData></worksheet>`,
    );
  });

  return zipSync(files, { level: 6 }) as Uint8Array<ArrayBuffer>;
}

export function toCsv(rows: CellValue[][]): string {
  return rows
    .map((row) =>
      row
        .map((v) => {
          if (v === null || v === undefined) return '';
          const s = String(v);
          return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
        })
        .join(','),
    )
    .join('\r\n');
}

export function cellText(c: Cell | undefined): string {
  if (!c || c.v === null) return '';
  return String(c.v).trim();
}
