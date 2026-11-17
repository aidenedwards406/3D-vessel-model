/** PDF summary report for written reports and FDA submissions. Built locally with jsPDF. */
import { createElement } from 'react';
import { formatPercent, seriesColor } from './colormaps';
import { formatP, stars } from './stats/tests';
import { renderSvg, svgToCanvas, observationRows } from './exporters';
import { renderTargetImage } from './viewExport';
import { getDerived, getLayout, getScale, getVessels, targetValues } from '../state/derived';
import { breakdown, filterDescription, plainLanguageResult, runAnalysis, statsGroups, unitDescription, vesselMeanGroups } from '../state/analysis';
import { useStore } from '../state/store';
import { BoxPlotChart, BreakdownChart, GroupDotChart, errorLabel } from '../components/charts';
import { RegionMap, chromeColors } from '../components/RegionMap';
import type { ViewTarget } from './study';
import { positionsSummary } from './regions';

export interface ReportOptions {
  pageSize: 'letter' | 'a4';
  vessels: boolean;
  stats: boolean;
  data: boolean;
  onProgress?: (fraction: number, text: string) => void;
}

/** Keeps text within the PDF standard fonts' character set. */
function t(s: string): string {
  return s
    .replace(/[−–—]/g, '-')
    .replace(/η²/g, 'eta-squared')
    .replace(/ε²/g, 'epsilon-squared')
    .replace(/α/g, 'alpha')
    .replace(/→/g, '->')
    .replace(/≥/g, '>=')
    .replace(/≤/g, '<=')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/…/g, '...')
    .replace(/·/g, '-')
    .replace(/[^\x20-\x7E -ÿ]/g, '');
}

function hexRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

export async function buildReport(opts: ReportOptions): Promise<Blob> {
  const progress = opts.onProgress ?? (() => {});
  progress(0.02, 'Preparing the report…');
  const [{ jsPDF }, autoTableMod] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);
  const autoTable = (autoTableMod as unknown as { default: (doc: unknown, o: unknown) => void }).default;
  const s = useStore.getState();
  const doc = new jsPDF({ unit: 'pt', format: opts.pageSize });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 48;
  const CW = W - 2 * M;
  const light = chromeColors(false);
  const layout = getLayout(s);
  const d = getDerived(s);
  const vessels = getVessels(s);
  const scale = getScale(s);
  const groups = s.treatments.filter((tr) => vessels.some((v) => v.treatmentId === tr.id));
  const title = t(s.presentation.title || s.study.name || 'Vessel damage study');
  let y = M;

  const ensure = (h: number) => {
    if (y + h > H - M - 18) {
      doc.addPage();
      y = M;
    }
  };
  const h1 = (text: string) => {
    ensure(40);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(16);
    doc.setTextColor(11, 11, 11);
    doc.text(t(text), M, y + 14);
    y += 28;
  };
  const h2 = (text: string) => {
    ensure(28);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11.5);
    doc.setTextColor(11, 11, 11);
    doc.text(t(text), M, y + 10);
    y += 18;
  };
  const para = (text: string, size = 9.5, color: [number, number, number] = [82, 81, 78]) => {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(size);
    doc.setTextColor(...color);
    const lines = doc.splitTextToSize(t(text), CW) as string[];
    ensure(lines.length * size * 1.35 + 4);
    doc.text(lines, M, y + size);
    y += lines.length * size * 1.35 + 6;
  };
  const image = (canvas: HTMLCanvasElement, x: number, yy: number, w: number, h: number, jpeg = false) => {
    doc.addImage(jpeg ? canvas.toDataURL('image/jpeg', 0.92) : canvas.toDataURL('image/png'), jpeg ? 'JPEG' : 'PNG', x, yy, w, h, undefined, 'FAST');
  };
  const svgImage = async (el: ReturnType<typeof createElement>, w: number) => {
    const svg = renderSvg(el);
    const c = await svgToCanvas(svg, 2.5, '#ffffff');
    const h = (c.height / c.width) * w;
    ensure(h + 8);
    image(c, M, y, w, h);
    y += h + 10;
  };
  const table = (head: string[], body: (string | number)[][], colAlign?: ('left' | 'right')[]) => {
    autoTable(doc, {
      head: [head.map(t)],
      body: body.map((r) => r.map((c) => (typeof c === 'string' ? t(c) : c))),
      startY: y,
      margin: { left: M, right: M },
      styles: { font: 'helvetica', fontSize: 8.5, cellPadding: 3, textColor: [11, 11, 11], lineColor: [225, 224, 217], lineWidth: 0.5 },
      headStyles: { fillColor: [239, 239, 235], textColor: [82, 81, 78], fontStyle: 'bold' },
      columnStyles: Object.fromEntries((colAlign ?? []).map((a, i) => [i, { halign: a }])),
      theme: 'grid',
    });
    y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 14;
  };

  // ── Cover ────────────────────────────────────────────────────────────────
  if (s.presentation.logo) {
    try {
      const img = new Image();
      img.src = s.presentation.logo;
      await img.decode();
      const lw = Math.min(140, (img.width / img.height) * 48);
      doc.addImage(s.presentation.logo, M, y, lw, (img.height / img.width) * lw);
      y += (img.height / img.width) * lw + 16;
    } catch {
      /* ignore bad logos */
    }
  }
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(24);
  doc.setTextColor(11, 11, 11);
  const titleLines = doc.splitTextToSize(title, CW) as string[];
  doc.text(titleLines, M, y + 22);
  y += titleLines.length * 28 + 6;
  const sub = [s.presentation.subtitle, s.study.partner].filter(Boolean).join(' - ');
  if (sub) para(sub, 12, [82, 81, 78]);
  para(`Report generated ${new Date().toLocaleString()}`, 9, [116, 114, 108]);
  y += 6;
  progress(0.08, 'Rendering the treatment averages…');
  if (groups.length) {
    const engine = (await import('../state/assets')).assets.engine!;
    const cam = engine.getCameraState();
    engine.setCameraPreset('iso', false);
    const views = groups.slice(0, 4).map((g) => ({ name: g.name, c: null as HTMLCanvasElement | null, g }));
    for (const v of views) v.c = await renderTargetImage({ kind: 'group', id: v.g.id }, 'top', 900, 520);
    engine.setCameraState(cam, false);
    const cols = Math.min(2, views.length);
    const cw = CW / cols - 6;
    views.forEach((v, i) => {
      const x = M + (i % cols) * (cw + 12);
      const yy = y + Math.floor(i / cols) * (cw * 0.58 + 26);
      doc.setFillColor(...hexRgb(seriesColor(v.g.slot)));
      doc.circle(x + 3.5, yy + 5.5, 3.5, 'F');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10);
      doc.setTextColor(11, 11, 11);
      doc.text(t(`${v.name} (average)`), x + 11, yy + 9);
      image(v.c!, x, yy + 14, cw, cw * 0.58, true);
    });
    y += Math.ceil(views.length / cols) * (cw * 0.58 + 26) + 6;
  }
  const a = runAnalysis(s);
  if (groups.length >= 2 && s.damage.rows.length) {
    h2('Key result');
    para(plainLanguageResult(a), 10.5, [11, 11, 11]);
  }
  h2('Study at a glance');
  table(
    ['Vessels', 'Treatment groups', 'Images', 'Damage values', 'Sections', 'Positions per section'],
    [
      [
        vessels.length,
        groups.length,
        s.images.filter((i) => !i.excluded && !(i.parsed?.overlay && !i.manual)).length,
        s.damage.rows.length,
        layout.count,
        new Set(layout.positions.map((p) => p.join(','))).size === 1 ? layout.positions[0].join(', ') : 'Varies (see Methods)',
      ],
    ],
  );

  // ── Methods ──────────────────────────────────────────────────────────────
  doc.addPage();
  y = M;
  h1('Methods');
  para(
    `Model: ${s.model.name || 'not loaded'} (${s.model.format.toUpperCase()}, ${s.model.triangleCount.toLocaleString()} triangles). The vessel was divided along its ${s.model.method === 'curved' ? 'curved centerline (following bends)' : 'main axis'} into ${layout.count} sections numbered from proximal to distal${layout.trimStart > 0 || layout.trimEnd < 1 ? `, covering ${(layout.trimStart * 100).toFixed(1)}-${(layout.trimEnd * 100).toFixed(1)}% of its length` : ''}. Each section was divided into top and bottom halves and into proximal (P), medial (M1, M2, ...) and distal (D) positions along its length (${positionsSummary(layout)}).`,
  );
  para(
    'Images were placed automatically from their file names (BIOREACTOR_MAGNIFICATION_SECTION_SIDE_POSITION, e.g. BRS24-10_4x_2_T_M2). Damage was quantified by tracing damaged areas in each image and counting damaged pixels, recorded as percent damage per image.',
  );
  para(
    `Heat maps colour each location by its ${s.heat.aggregation} percent damage on one fixed scale from ${scale.min} to ${scale.max}% for all vessels, so colours are comparable between treatments. Locations without an image are neutral gray with hatching and are never shown as 0%. Treatment averages are the mean of the vessel values at each location.`,
  );
  para(
    `Statistics: ${a.testName} with ${a.postHocName} post-hoc comparisons on ${unitDescription(s)} (${filterDescription(s)}), significance level ${a.alpha}. ${a.reason}`,
  );
  para('All processing was done locally on the user\'s computer by 3D Vessel Model. No data was uploaded or analysed by AI.', 9, [116, 114, 108]);

  // ── Treatment averages in detail ─────────────────────────────────────────
  if (groups.length && s.damage.rows.length) {
    doc.addPage();
    y = M;
    h1('Damage maps by treatment');
    para(`Average damage per location (mean of vessels). Colour scale ${scale.min}-${scale.max}% damage.`);
    let gi = 0;
    for (const g of groups) {
      progress(0.15 + (0.25 * gi++) / groups.length, `Rendering ${g.name}…`);
      const target: ViewTarget = { kind: 'group', id: g.id };
      const top = await renderTargetImage(target, 'top', 900, 520);
      const bottom = await renderTargetImage(target, 'bottom', 900, 520);
      ensure(CW * 0.29 + 120);
      h2(`${g.name} - average of ${vessels.filter((v) => v.treatmentId === g.id).length} vessels`);
      const iw = CW / 2 - 6;
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8.5);
      doc.setTextColor(116, 114, 108);
      doc.text('Top view', M, y + 8);
      doc.text('Bottom view', M + iw + 12, y + 8);
      image(top, M, y + 12, iw, iw * 0.58, true);
      image(bottom, M + iw + 12, y + 12, iw, iw * 0.58, true);
      y += iw * 0.58 + 20;
      await svgImage(
        createElement(RegionMap, { values: targetValues(s, target), scale, layout, width: 760, colors: light, showValues: true }),
        CW,
      );
    }
  }

  // ── Statistics ───────────────────────────────────────────────────────────
  if (opts.stats && groups.length >= 2 && s.damage.rows.length) {
    progress(0.45, 'Adding statistics…');
    doc.addPage();
    y = M;
    h1('Statistics');
    para(plainLanguageResult(a), 10.5, [11, 11, 11]);
    const sg = statsGroups(s, false);
    await svgImage(
      createElement(BoxPlotChart, {
        groups: sg,
        width: 760,
        height: 380,
        colors: light,
        pairs: a.pairs.map((p) => ({ a: p.a, b: p.b, p: p.p })),
        alpha: a.alpha,
        interactive: false,
        title: `Damage by treatment (${unitDescription(s)})`,
      }),
      CW * 0.86,
    );
    table(
      ['Treatment', 'n', 'Mean', 'SD', 'SEM', 'Median', 'Min', 'Max', 'Shapiro-Wilk p'],
      a.groups.map((g) => [
        g.name,
        g.desc.n,
        g.desc.mean.toFixed(2),
        Number.isFinite(g.desc.sd) ? g.desc.sd.toFixed(2) : '-',
        Number.isFinite(g.desc.sem) ? g.desc.sem.toFixed(2) : '-',
        g.desc.median.toFixed(2),
        g.desc.min.toFixed(2),
        g.desc.max.toFixed(2),
        formatP(g.normality?.p),
      ]),
      ['left', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right'],
    );
    h2(`Pairwise comparisons (${a.postHocName})`);
    table(
      ['Comparison', a.test === 'kruskal' ? 'Mean rank diff.' : 'Difference', a.test === 'kruskal' ? 'z' : 'Statistic', 'Adjusted p', ''],
      a.pairs.map((p) => [`${a.groups[p.a].name} vs ${a.groups[p.b].name}`, p.diff.toFixed(2), p.stat.toFixed(3), formatP(p.p), stars(p.p)]),
      ['left', 'right', 'right', 'right', 'left'],
    );
    await svgImage(
      createElement(GroupDotChart, {
        groups: vesselMeanGroups(s, false),
        width: 700,
        height: 320,
        colors: light,
        errorBar: s.stats.errorBar,
        interactive: false,
        title: `Average damage per treatment (vessel means ${errorLabel(s.stats.errorBar)})`,
      }),
      CW * 0.78,
    );
    for (const by of ['section', 'side', 'position'] as const) {
      const b = breakdown(s, by, false);
      await svgImage(
        createElement(BreakdownChart, {
          categories: b.categories,
          series: b.series,
          width: 700,
          height: 250,
          colors: light,
          errorBar: s.stats.errorBar,
          connect: by === 'section',
          interactive: false,
          title: `Mean damage by ${by} (${errorLabel(s.stats.errorBar)})`,
        }),
        CW * 0.78,
      );
    }
  }

  // ── Vessel gallery ───────────────────────────────────────────────────────
  if (opts.vessels && vessels.length) {
    doc.addPage();
    y = M;
    h1('All vessels');
    para('Top view of every vessel on the same colour scale.');
    const cols = 3;
    const cw = (CW - (cols - 1) * 10) / cols;
    const ch = cw * 0.62;
    let i = 0;
    for (const v of vessels) {
      progress(0.6 + (0.3 * i) / vessels.length, `Rendering ${v.name}…`);
      const c = await renderTargetImage({ kind: 'vessel', key: v.vKey }, 'top', 640, 400);
      if (i % cols === 0) ensure(ch + 30);
      const x = M + (i % cols) * (cw + 10);
      const tr = s.treatments.find((x2) => x2.id === v.treatmentId);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9);
      doc.setTextColor(11, 11, 11);
      doc.text(t(v.name), x, y + 9);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(82, 81, 78);
      doc.text(t(`${tr?.name ?? 'No treatment'} - mean ${formatPercent(v.mean)}`), x, y + 20);
      image(c, x, y + 24, cw, ch, true);
      i++;
      if (i % cols === 0) y += ch + 34;
    }
    if (i % cols !== 0) y += ch + 34;
  }

  // ── Data appendix ────────────────────────────────────────────────────────
  if (opts.data && d.observations.length) {
    progress(0.92, 'Adding the data table…');
    doc.addPage();
    y = M;
    h1('Appendix: data');
    const rows = observationRows(s);
    table(
      rows[0].map(String).slice(0, 8),
      rows.slice(1).map((r) => r.slice(0, 8).map((c) => (c === null ? '' : typeof c === 'number' ? +c.toFixed(3) : String(c)))),
    );
  }

  // Footer on every page
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(116, 114, 108);
    doc.text(t(s.presentation.footer || 'Confidential'), M, H - 24);
    doc.text(t(`${title} - page ${p} of ${pages}`), W - M, H - 24, { align: 'right' });
  }
  progress(1, 'Done');
  return doc.output('blob');
}
