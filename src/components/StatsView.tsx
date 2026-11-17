import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useDark } from './useTheme';
import { BarChart3, Download, FileSpreadsheet, Image as ImageIcon, Table2 } from 'lucide-react';
import { formatPercent } from '../lib/colormaps';
import { downloadBlob, safeFileName } from '../lib/files';
import { csvBlob, observationRows, renderSvg, statsWorkbook, svgBlob, svgToPng, xlsxBlob } from '../lib/exporters';
import { formatP, pText, stars } from '../lib/stats/tests';
import { breakdown, filterDescription, plainLanguageResult, runAnalysis, statsGroups, unitDescription, type BreakdownBy } from '../state/analysis';
import { goToStep } from '../state/actions';
import { useStore } from '../state/store';
import { BoxPlotChart, BreakdownChart, errorLabel } from './charts';
import { chromeColors } from './RegionMap';
import { Badge, Button, Callout, cx } from './ui';

function useWidth(ref: React.RefObject<HTMLElement | null>) {
  const [w, setW] = useState(600);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    setW(el.clientWidth);
    return () => ro.disconnect();
  }, [ref]);
  return w;
}

function Card({ title, children, actions, className }: { title: ReactNode; children: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <section className={cx('rounded-xl border border-line bg-surface p-4 shadow-card', className)}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-[14px] font-semibold text-ink">{title}</h2>
        {actions}
      </div>
      {children}
    </section>
  );
}

function Th({ children, right }: { children: ReactNode; right?: boolean }) {
  return <th className={cx('border-b border-line px-1.5 py-1.5 text-[11.5px] font-medium whitespace-nowrap text-ink-2', right ? 'text-right' : 'text-left')}>{children}</th>;
}
function Td({ children, right, strong }: { children: ReactNode; right?: boolean; strong?: boolean }) {
  return (
    <td className={cx('border-b border-line/70 px-1.5 py-1.5 text-[12.5px] whitespace-nowrap', right && 'tabular text-right', strong ? 'font-semibold text-ink' : 'text-ink')}>
      {children}
    </td>
  );
}

function BreakdownCard({
  by,
  tables,
  name,
  onExport,
}: {
  by: BreakdownBy;
  tables: boolean;
  name: string;
  onExport: (kind: 'svg' | 'png', el: React.ReactElement, file: string) => void;
}) {
  const s = useStore();
  const dark = useDark();
  const ref = useRef<HTMLDivElement>(null);
  const w = useWidth(ref);
  const b = useMemo(() => breakdown(s, by, dark), [s, by, dark]);
  const chart = (cols: ReturnType<typeof chromeColors>, interactive: boolean, width: number, bb = b) => (
    <BreakdownChart
      categories={bb.categories}
      series={bb.series}
      width={width}
      colors={cols}
      errorBar={s.stats.errorBar}
      connect={by === 'section'}
      interactive={interactive}
      title={interactive ? undefined : `Mean damage by ${by} (${errorLabel(s.stats.errorBar)})`}
    />
  );
  return (
    <Card
      title={`By ${by}`}
      actions={
        <Button
          size="xs"
          variant="ghost"
          icon={<Download className="h-3 w-3" />}
          onClick={() => onExport('svg', chart(chromeColors(false), false, 640, breakdown(s, by, false)), `${name}-by-${by}`)}
        >
          SVG
        </Button>
      }
    >
      <div ref={ref}>{chart(chromeColors(dark), true, Math.max(220, w))}</div>
      {tables && (
        <table className="mt-2 w-full">
          <thead>
            <tr>
              <Th>Treatment</Th>
              {b.categories.map((c) => (
                <Th key={c} right>
                  {c}
                </Th>
              ))}
            </tr>
          </thead>
          <tbody>
            {b.series.map((ser) => (
              <tr key={ser.id}>
                <Td>{ser.name}</Td>
                {ser.stats.map((d, i) => (
                  <Td key={i} right>
                    {d && d.n ? d.mean.toFixed(1) : '–'}
                  </Td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}

const fmt = (x: number | null | undefined, d = 2) => (x === null || x === undefined || !Number.isFinite(x) ? '–' : x.toFixed(d));

export function StatsView() {
  const s = useStore();
  const dark = useDark();
  const colors = chromeColors(dark);
  const a = useMemo(() => runAnalysis(s), [s]);
  const groups = useMemo(() => statsGroups(s, dark), [s, dark]);
  const boxRef = useRef<HTMLDivElement>(null);
  const boxW = useWidth(boxRef);
  const [tables, setTables] = useState(false);
  const pairs = a.pairs.map((p) => ({ a: p.a, b: p.b, p: p.p }));
  const name = safeFileName(s.study.name || 'study');
  const groupsWithData = groups.length;

  const exportChart = async (kind: 'svg' | 'png', el: React.ReactElement, file: string) => {
    const svg = renderSvg(el);
    if (kind === 'svg') downloadBlob(svgBlob(svg), `${file}.svg`);
    else downloadBlob(await svgToPng(svg, 3), `${file}.png`);
  };
  const light = chromeColors(false);
  const lightGroups = statsGroups(s, false);
  const boxForExport = (
    <BoxPlotChart groups={lightGroups} width={760} height={420} colors={light} pairs={pairs} alpha={a.alpha} interactive={false} title={`Damage by treatment (${unitDescription(s)}, ${filterDescription(s)})`} />
  );

  if (groupsWithData < 2) {
    return (
      <div className="absolute inset-0 overflow-y-auto bg-bg">
        <div className="mx-auto max-w-[760px] px-6 py-10">
          <h1 className="mb-2 text-[22px] font-semibold text-ink">Statistics</h1>
          <Callout
            kind="info"
            title="Two or more treatment groups with damage data are needed"
            action={
              <div className="flex gap-2">
                <Button size="sm" onClick={() => goToStep('damage')}>
                  Add damage data
                </Button>
                <Button size="sm" onClick={() => goToStep('treatments')}>
                  Assign treatments
                </Button>
              </div>
            }
          >
            {groupsWithData === 1 ? 'Only one treatment group has damage values so far.' : 'No treatment group has damage values yet.'}
          </Callout>
        </div>
      </div>
    );
  }

  const isRank = a.test === 'kruskal';
  return (
    <div className="scroll-thin absolute inset-0 overflow-y-auto bg-bg">
      <div className="mx-auto max-w-[1180px] space-y-4 px-4 py-5 sm:px-6">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-[22px] font-semibold text-ink">Statistics</h1>
            <div className="mt-1 flex flex-wrap gap-1.5">
              <Badge tone="accent">{unitDescription(s)}</Badge>
              <Badge>{filterDescription(s)}</Badge>
              <Badge>{a.testName} + {a.postHocName}</Badge>
              <Badge>α = {a.alpha}</Badge>
            </div>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <Button size="sm" icon={<FileSpreadsheet className="h-3.5 w-3.5" />} onClick={() => downloadBlob(xlsxBlob(statsWorkbook(s)), `${name}-statistics.xlsx`)}>
              Results (.xlsx)
            </Button>
            <Button size="sm" icon={<Download className="h-3.5 w-3.5" />} onClick={() => downloadBlob(csvBlob(observationRows(s)), `${name}-data-for-JMP.csv`)}>
              Data for JMP (.csv)
            </Button>
            <Button size="sm" variant="ghost" icon={<Table2 className="h-3.5 w-3.5" />} onClick={() => setTables((t) => !t)}>
              {tables ? 'Hide' : 'Show'} chart tables
            </Button>
          </div>
        </header>

        <section className="rounded-xl border border-line bg-surface p-4 shadow-card">
          <p className="text-[16px] leading-snug font-semibold text-ink">{plainLanguageResult(a)}</p>
          <p className="mt-1.5 text-[12.5px] text-ink-2">{a.reason}</p>
          {a.omnibus?.effect !== null && a.omnibus?.effect !== undefined && (
            <p className="mt-1 text-[12.5px] text-ink-2">
              Effect size {a.omnibus.effectName} = {a.omnibus.effect.toFixed(3)} (share of variation explained by treatment).
            </p>
          )}
          {s.stats.unit === 'image' && (
            <p className="mt-1 text-[12px] text-muted">
              Each image is treated as independent. Switch the unit of analysis to vessel means for a more conservative comparison.
            </p>
          )}
          {a.warnings.map((w) => (
            <Callout key={w} kind="warning" className="mt-2">
              {w}
            </Callout>
          ))}
        </section>

        <div className="grid gap-4 2xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
          <Card
            title="Damage by treatment"
            actions={
              <div className="flex gap-1">
                <Button size="xs" variant="ghost" icon={<ImageIcon className="h-3 w-3" />} onClick={() => exportChart('png', boxForExport, `${name}-boxplot`)}>
                  PNG
                </Button>
                <Button size="xs" variant="ghost" icon={<BarChart3 className="h-3 w-3" />} onClick={() => exportChart('svg', boxForExport, `${name}-boxplot`)}>
                  SVG
                </Button>
              </div>
            }
          >
            <div ref={boxRef}>
              <BoxPlotChart groups={groups} width={boxW} height={360} colors={colors} pairs={pairs} alpha={a.alpha} />
            </div>
            <p className="mt-2 text-[11.5px] text-muted">
              Box: median and quartiles; whiskers: 1.5 × IQR; ◇ mean; dots: {unitDescription(s)}. Brackets mark significant pairs ({a.postHocName}): * p &lt; 0.05,
              ** p &lt; 0.01, *** p &lt; 0.001.
            </p>
          </Card>
          <Card title="Summary statistics">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr>
                    <Th>Treatment</Th>
                    <Th right>n</Th>
                    <Th right>Mean</Th>
                    <Th right>SD</Th>
                    <Th right>Median</Th>
                    <Th right>Range</Th>
                  </tr>
                </thead>
                <tbody>
                  {a.groups.map((g, i) => (
                    <tr key={g.name}>
                      <Td strong>
                        <span className="flex items-center gap-1.5">
                          <span className="h-2.5 w-2.5 rounded-full" style={{ background: groups[i]?.color }} />
                          {g.name}
                        </span>
                      </Td>
                      <Td right>{g.desc.n}</Td>
                      <Td right>{formatPercent(g.desc.mean, 2)}</Td>
                      <Td right>{fmt(g.desc.sd)}</Td>
                      <Td right>{fmt(g.desc.median)}</Td>
                      <Td right>
                        {fmt(g.desc.min, 1)}–{fmt(g.desc.max, 1)}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-4 text-[12.5px] font-semibold text-ink">Assumption checks</div>
            <table className="mt-1 w-full">
              <thead>
                <tr>
                  <Th>Treatment</Th>
                  <Th right>Shapiro–Wilk W</Th>
                  <Th right>p</Th>
                  <Th>Normal?</Th>
                </tr>
              </thead>
              <tbody>
                {a.groups.map((g) => (
                  <tr key={g.name}>
                    <Td>{g.name}</Td>
                    <Td right>{fmt(g.normality?.W, 3)}</Td>
                    <Td right>{formatP(g.normality?.p)}</Td>
                    <Td>{g.normality ? (g.normality.p >= a.alpha ? 'Looks normal' : 'Not normal') : 'Too few values'}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
            {a.equalVariance && (
              <p className="mt-2 text-[12px] text-ink-2">
                Equal spread (Brown–Forsythe): F({a.equalVariance.df1}, {a.equalVariance.df2}) = {a.equalVariance.F.toFixed(2)}, {pText(a.equalVariance.p)}:{' '}
                {a.equalVariance.p >= a.alpha ? 'spreads look similar.' : 'spreads differ.'}
              </p>
            )}
          </Card>
        </div>

        <Card title={`Pairwise comparisons · ${a.postHocName}`}>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr>
                  <Th>Comparison</Th>
                  <Th right>{isRank ? 'Mean rank difference' : 'Difference (% points)'}</Th>
                  {!isRank && <Th right>95% CI</Th>}
                  <Th right>{isRank ? 'z' : a.test === 'welch' ? 't' : 'q'}</Th>
                  <Th right>Adjusted p</Th>
                  <Th>Result</Th>
                </tr>
              </thead>
              <tbody>
                {a.pairs.map((p, i) => (
                  <tr key={i}>
                    <Td strong>
                      {a.groups[p.a].name} vs {a.groups[p.b].name}
                    </Td>
                    <Td right>
                      {p.diff >= 0 ? '+' : ''}
                      {p.diff.toFixed(2)}
                    </Td>
                    {!isRank && (
                      <Td right>
                        {fmt(p.ciLow)} to {fmt(p.ciHigh)}
                      </Td>
                    )}
                    <Td right>{fmt(p.stat, 3)}</Td>
                    <Td right>{formatP(p.p)}</Td>
                    <Td>
                      {p.p < a.alpha ? (
                        <span className="font-semibold text-ink">Significant {stars(p.p)}</span>
                      ) : (
                        <span className="text-ink-2">Not significant</span>
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <div className="grid gap-4 xl:grid-cols-3">
          {(['section', 'side', 'position'] as BreakdownBy[]).map((by) => (
            <BreakdownCard key={by} by={by} tables={tables} name={name} onExport={exportChart} />
          ))}
        </div>
        <p className="pb-4 text-[11.5px] leading-relaxed text-muted">
          Methods: {a.testName} with {a.postHocName} post-hoc comparisons on {unitDescription(s)} ({filterDescription(s)}). The test is chosen automatically from
          Shapiro–Wilk normality checks and the Brown–Forsythe test for equal spread unless chosen manually. Calculations run locally in this browser and
          match SciPy, scikit-posthocs and pingouin. Error bars in breakdown charts show {errorLabel(s.stats.errorBar)}.
        </p>
      </div>
    </div>
  );
}
