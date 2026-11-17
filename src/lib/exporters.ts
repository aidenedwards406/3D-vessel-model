/** Export helpers: SVG/PNG from React charts, CSV/XLSX data tables. All local. */
import type { ReactElement } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { comparePositions, positionLabel, sideLabel } from './naming';
import { formatP, stars, type Analysis } from './stats/tests';
import { toCsv, writeXlsx, type CellValue } from './spreadsheet';
import { getDerived, getVessels } from '../state/derived';
import { breakdown, filterDescription, runAnalysis, unitDescription } from '../state/analysis';
import type { AppState } from '../state/store';

/** Renders a React element offscreen and returns its <svg> as a string. */
export function renderSvg(element: ReactElement): string {
  const div = document.createElement('div');
  div.style.position = 'fixed';
  div.style.left = '-10000px';
  document.body.appendChild(div);
  const root = createRoot(div);
  flushSync(() => root.render(element));
  const svg = div.querySelector('svg');
  if (svg) svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  const str = svg ? new XMLSerializer().serializeToString(svg) : '';
  root.unmount();
  div.remove();
  return str;
}

export function svgBlob(svg: string): Blob {
  return new Blob([`<?xml version="1.0" encoding="UTF-8"?>\n${svg}`], { type: 'image/svg+xml' });
}

export async function svgToCanvas(svg: string, scale = 3, background: string | null = '#ffffff'): Promise<HTMLCanvasElement> {
  const m = /viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(svg);
  const w = m ? Number(m[1]) : 800;
  const h = m ? Number(m[2]) : 600;
  const img = new Image();
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error('SVG render failed'));
    img.src = url;
  });
  const c = document.createElement('canvas');
  c.width = Math.round(w * scale);
  c.height = Math.round(h * scale);
  const ctx = c.getContext('2d')!;
  if (background) {
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, c.width, c.height);
  }
  ctx.drawImage(img, 0, 0, c.width, c.height);
  URL.revokeObjectURL(url);
  return c;
}

export function canvasBlob(c: HTMLCanvasElement, type = 'image/png', q?: number): Promise<Blob> {
  return new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error('encode failed'))), type, q));
}

export async function svgToPng(svg: string, scale = 3, background: string | null = '#ffffff'): Promise<Blob> {
  return canvasBlob(await svgToCanvas(svg, scale, background));
}

// ── Data tables ─────────────────────────────────────────────────────────────

export function observationRows(s: AppState): CellValue[][] {
  const d = getDerived(s);
  const rows: CellValue[][] = [['Image', 'Vessel', 'Treatment', 'Section', 'Side', 'Position', 'Magnification', 'Damage (%)', 'Image file loaded', 'Placed']];
  const tName = (vKey: string) => s.treatments.find((t) => t.id === s.vesselTreatment[vKey])?.name ?? '';
  const obs = [...d.observations].sort(
    (a, b) =>
      a.vessel.localeCompare(b.vessel, undefined, { numeric: true }) ||
      a.section - b.section ||
      a.side.localeCompare(b.side) * -1 ||
      comparePositions(a.position, b.position),
  );
  for (const o of obs) {
    rows.push([
      o.name.replace(/\.[^.]+$/, ''),
      o.vessel,
      tName(o.vKey),
      o.section,
      sideLabel(o.side),
      o.position,
      o.magnification ?? '',
      o.damage,
      o.imageId ? 'yes' : 'no',
      o.manual ? 'by hand' : 'from name',
    ]);
  }
  return rows;
}

export function vesselRows(s: AppState): CellValue[][] {
  const rows: CellValue[][] = [['Vessel', 'Treatment', 'Images', 'Damage values', 'Mean damage (%)', 'Max damage (%)']];
  for (const v of getVessels(s)) {
    rows.push([v.name, s.treatments.find((t) => t.id === v.treatmentId)?.name ?? '', v.imageCount, v.values.length, round(v.mean), round(v.max)]);
  }
  return rows;
}

function round(x: number | null | undefined, d = 4): number | null {
  if (x === null || x === undefined || !Number.isFinite(x)) return null;
  return +x.toFixed(d);
}

export function summaryRows(s: AppState, a: Analysis = runAnalysis(s)): CellValue[][] {
  const rows: CellValue[][] = [
    ['Treatment', 'n', 'Mean (%)', 'SD', 'SEM', '95% CI low', '95% CI high', 'Median', 'Q1', 'Q3', 'Min', 'Max', 'Range', 'Shapiro–Wilk W', 'Shapiro–Wilk p'],
  ];
  for (const g of a.groups) {
    const d = g.desc;
    rows.push([
      g.name,
      d.n,
      round(d.mean),
      round(d.sd),
      round(d.sem),
      round(d.ci95?.[0]),
      round(d.ci95?.[1]),
      round(d.median),
      round(d.q1),
      round(d.q3),
      round(d.min),
      round(d.max),
      round(d.max - d.min),
      round(g.normality?.W),
      round(g.normality?.p, 6),
    ]);
  }
  return rows;
}

export function pairwiseRows(a: Analysis): CellValue[][] {
  const isRank = a.test === 'kruskal';
  const rows: CellValue[][] = [
    [
      'Group A',
      'Group B',
      isRank ? 'Mean rank difference' : 'Mean difference (%)',
      ...(isRank ? [] : ['95% CI low', '95% CI high']),
      isRank ? 'z' : a.test === 'welch' ? 't' : 'q',
      ...(isRank ? ['p (unadjusted)'] : []),
      'p (adjusted)',
      'Significance',
    ],
  ];
  for (const p of a.pairs) {
    rows.push([
      a.groups[p.a].name,
      a.groups[p.b].name,
      round(p.diff),
      ...(isRank ? [] : [round(p.ciLow), round(p.ciHigh)]),
      round(p.stat),
      ...(isRank ? [round(p.pRaw, 8)] : []),
      round(p.p, 8),
      stars(p.p),
    ]);
  }
  return rows;
}

export function breakdownRows(s: AppState, by: 'section' | 'side' | 'position'): CellValue[][] {
  const b = breakdown(s, by);
  const rows: CellValue[][] = [['Treatment', by === 'section' ? 'Section' : by === 'side' ? 'Side' : 'Position', 'n', 'Mean (%)', 'SD', 'SEM']];
  for (const ser of b.series) {
    ser.stats.forEach((d, i) => {
      if (!d || !d.n) return;
      const cat = by === 'position' ? `${b.categories[i]} (${positionLabel(b.categories[i])})` : b.categories[i];
      rows.push([ser.name, cat, d.n, round(d.mean), round(d.sd), round(d.sem)]);
    });
  }
  return rows;
}

export function methodsRows(s: AppState, a: Analysis): CellValue[][] {
  return [
    ['Item', 'Value'],
    ['Study', s.study.name || 'Untitled study'],
    ['Exported', new Date().toISOString()],
    ['Unit of analysis', unitDescription(s)],
    ['Regions included', filterDescription(s)],
    ['Omnibus test', a.testName],
    ['Post-hoc test', a.postHocName],
    ['Why this test', a.reason],
    ['Significance level (alpha)', a.alpha],
    ['Omnibus statistic', a.omnibus ? `${a.omnibus.statName} = ${a.omnibus.stat.toFixed(4)}` : ''],
    ['Degrees of freedom', a.omnibus ? (a.omnibus.df2 !== null ? `${a.omnibus.df1}, ${a.omnibus.df2.toFixed(2)}` : `${a.omnibus.df1}`) : ''],
    ['p-value', a.omnibus ? formatP(a.omnibus.p) : ''],
    ['Effect size', a.omnibus?.effect !== null && a.omnibus?.effect !== undefined ? `${a.omnibus.effectName} = ${a.omnibus.effect.toFixed(4)}` : ''],
    ['Equal variances (Brown–Forsythe)', a.equalVariance ? `F = ${a.equalVariance.F.toFixed(4)}, p = ${formatP(a.equalVariance.p)}` : ''],
    ['Software', '3D Vessel Model (statistics verified against SciPy, scikit-posthocs and pingouin)'],
  ];
}

export function statsWorkbook(s: AppState): Uint8Array<ArrayBuffer> {
  const a = runAnalysis(s);
  return writeXlsx([
    { name: 'Summary', rows: summaryRows(s, a) },
    { name: 'Pairwise', rows: pairwiseRows(a) },
    { name: 'By section', rows: breakdownRows(s, 'section') },
    { name: 'By side', rows: breakdownRows(s, 'side') },
    { name: 'By position', rows: breakdownRows(s, 'position') },
    { name: 'Vessels', rows: vesselRows(s) },
    { name: 'Data', rows: observationRows(s) },
    { name: 'Methods', rows: methodsRows(s, a) },
  ]);
}

export function csvBlob(rows: CellValue[][]): Blob {
  return new Blob(['﻿' + toCsv(rows)], { type: 'text/csv;charset=utf-8' });
}

export function xlsxBlob(bytes: Uint8Array<ArrayBuffer>): Blob {
  return new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}
