import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useDark } from './useTheme';
import { BarChart3, ChevronDown } from 'lucide-react';
import { formatPercent } from '../lib/colormaps';
import { downloadBlob, safeFileName } from '../lib/files';
import { renderSvg, svgBlob } from '../lib/exporters';
import { describe } from '../lib/stats/tests';
import { vesselMeanGroups } from '../state/analysis';
import { useStore } from '../state/store';
import { errorLabel, GroupDotChart } from './charts';
import { chromeColors } from './RegionMap';
import { Button, cx } from './ui';

export function CompareSummary() {
  const s = useStore();
  const [open, setOpen] = useState(true);
  const dark = useDark();
  const groups = useMemo(() => vesselMeanGroups(s, dark), [s, dark]);
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(500);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    setW(el.clientWidth);
    return () => ro.disconnect();
  }, [open]);
  if (groups.length === 0) return null;
  const eb = s.stats.errorBar;
  return (
    <section className="shrink-0 border-t border-line bg-surface" aria-label="Treatment summary">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex w-full items-center gap-2 px-4 py-2 text-left hover:bg-sunken/60">
        <BarChart3 className="h-4 w-4 text-accent" />
        <span className="text-[13px] font-semibold text-ink">Average damage per treatment</span>
        <span className="text-[12px] text-ink-2">
          mean of vessel means {errorLabel(eb)} · each dot is one vessel
        </span>
        <ChevronDown className={cx('ml-auto h-4 w-4 text-muted transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="flex flex-wrap items-start gap-4 px-4 pb-3 lg:flex-nowrap">
          <div ref={ref} className="min-w-[280px] flex-1">
            <GroupDotChart groups={groups} width={Math.max(280, w)} height={230} colors={chromeColors(dark)} errorBar={eb} pointLabel="vessel" />
          </div>
          <div className="w-full shrink-0 lg:w-[340px]">
            <table className="w-full text-[12.5px]">
              <thead className="text-ink-2">
                <tr className="border-b border-line">
                  <th className="py-1 text-left font-medium">Treatment</th>
                  <th className="py-1 text-right font-medium">Vessels</th>
                  <th className="py-1 text-right font-medium">Mean</th>
                  <th className="py-1 text-right font-medium">SD</th>
                </tr>
              </thead>
              <tbody>
                {groups.map((g) => {
                  const d = describe(g.values);
                  return (
                    <tr key={g.id} className="border-b border-line/70">
                      <td className="py-1.5 text-ink">
                        <span className="flex items-center gap-1.5">
                          <span className="h-2.5 w-2.5 rounded-full" style={{ background: g.color }} />
                          {g.name}
                        </span>
                      </td>
                      <td className="tabular py-1.5 text-right text-ink">{d.n}</td>
                      <td className="tabular py-1.5 text-right font-semibold text-ink">{formatPercent(d.mean, 2)}</td>
                      <td className="tabular py-1.5 text-right text-ink-2">{Number.isFinite(d.sd) ? d.sd.toFixed(2) : '–'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <Button
              size="xs"
              variant="ghost"
              className="mt-2"
              icon={<BarChart3 className="h-3 w-3" />}
              onClick={() =>
                downloadBlob(
                  svgBlob(
                    renderSvg(
                      <GroupDotChart
                        groups={vesselMeanGroups(useStore.getState(), false)}
                        width={640}
                        height={380}
                        colors={chromeColors(false)}
                        errorBar={eb}
                        interactive={false}
                        title={`Average damage per treatment (vessel means ${errorLabel(eb)})`}
                      />,
                    ),
                  ),
                  `${safeFileName(s.study.name || 'study')}-treatment-summary.svg`,
                )
              }
            >
              Export chart (SVG)
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
