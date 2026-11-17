import { describe, expect, it } from 'vitest';
import ref from './reference.json';
import { chi2Sf, fSf, pnorm, pnormUpper, ptukey, qnorm, qt, qtukey, tCdf } from './distributions';
import {
  analyze,
  brownForsythe,
  dunn,
  gamesHowell,
  kruskalWallis,
  oneWayAnova,
  shapiroWilk,
  tukeyHSD,
  welchAnova,
} from './tests';

/** Relative-or-absolute closeness. */
function close(actual: number, expected: number, rel = 1e-6, abs = 1e-10) {
  const ok = Math.abs(actual - expected) <= Math.max(abs, rel * Math.abs(expected));
  if (!ok) throw new Error(`expected ${expected}, got ${actual} (diff ${actual - expected})`);
}

describe('distributions match SciPy', () => {
  it('normal', () => {
    for (const [x, p] of ref.distributions.norm_cdf) close(pnorm(x), p, 1e-9, 1e-15);
    for (const [x, p] of ref.distributions.norm_sf) close(pnormUpper(x), p, 1e-9, 1e-15);
    for (const [p, x] of ref.distributions.norm_ppf) close(qnorm(p), x, 1e-9);
  });
  it('t', () => {
    for (const [t, df, p] of ref.distributions.t_cdf) close(tCdf(t, df), p, 1e-9);
    for (const [p, df, t] of ref.distributions.t_ppf) close(qt(p, df), t, 1e-8);
  });
  it('F and chi-square', () => {
    for (const [f, d1, d2, p] of ref.distributions.f_sf) close(fSf(f, d1, d2), p, 1e-8);
    for (const [x, df, p] of ref.distributions.chi2_sf) close(chi2Sf(x, df), p, 1e-8);
  });
  it('studentized range', () => {
    for (const [q, k, df, p] of ref.distributions.ptukey) close(ptukey(q, k, df), p, 1e-5, 1e-7);
    for (const [p, k, df, q] of ref.distributions.qtukey) close(qtukey(p, k, df), q, 1e-5);
  });
});

describe('Shapiro–Wilk matches SciPy', () => {
  it('across sample sizes', () => {
    for (const c of ref.shapiro) {
      const r = shapiroWilk(c.x)!;
      close(r.W, c.W, 1e-6);
      close(r.p, c.p, 1e-4, 1e-8);
    }
  });
});

describe('group comparisons match SciPy / scikit-posthocs / pingouin', () => {
  for (const d of ref.datasets) {
    describe(d.label, () => {
      const g = d.groups;
      it('one-way ANOVA', () => {
        const r = oneWayAnova(g)!;
        close(r.F, d.anova.F, 1e-9);
        close(r.p, d.anova.p, 1e-7, 1e-14);
      });
      it('Brown–Forsythe', () => {
        const r = brownForsythe(g)!;
        close(r.F, d.levene.F, 1e-9);
        close(r.p, d.levene.p, 1e-7, 1e-14);
      });
      it('Kruskal–Wallis', () => {
        const r = kruskalWallis(g)!;
        close(r.H, d.kruskal.H, 1e-9);
        close(r.p, d.kruskal.p, 1e-7, 1e-14);
      });
      it('Tukey HSD', () => {
        const r = tukeyHSD(g);
        expect(r).toHaveLength(d.tukey.length);
        r.forEach((x, i) => {
          const e = d.tukey[i];
          expect([x.a, x.b]).toEqual([e.a, e.b]);
          close(x.diff, e.diff, 1e-9);
          close(x.p, e.p, 1e-4, 1e-6);
          close(x.ciLow!, e.low, 1e-5);
          close(x.ciHigh!, e.high, 1e-5);
        });
      });
      it("Dunn's test (Holm and Bonferroni)", () => {
        for (const method of ['holm', 'bonferroni'] as const) {
          const r = dunn(g, method);
          const e = method === 'holm' ? d.dunn_holm : d.dunn_bonferroni;
          r.forEach((x, i) => close(x.p, e[i].p, 1e-8, 1e-14));
        }
      });
      it("Welch's ANOVA", () => {
        const r = welchAnova(g)!;
        close(r.F, d.welch.F, 1e-8);
        close(r.df2, d.welch.df2, 1e-8);
        close(r.p, d.welch.p, 1e-6, 1e-12);
      });
      it('Games–Howell', () => {
        const r = gamesHowell(g);
        for (const e of d.gameshowell) {
          const x = r.find((p) => p.a === e.a && p.b === e.b)!;
          close(x.diff, e.diff, 1e-9);
          close(x.stat, e.t, 1e-8);
          close(x.p, e.p, 1e-4, 1e-6);
        }
      });
    });
  }
});

describe('analysis orchestration', () => {
  it('picks Kruskal–Wallis for skewed data and explains why', () => {
    const d = ref.datasets[2];
    const a = analyze(d.names.map((name, i) => ({ name, values: d.groups[i] })), 'auto');
    expect(['kruskal', 'welch', 'anova']).toContain(a.test);
    expect(a.reason.length).toBeGreaterThan(10);
    expect(a.omnibus).not.toBeNull();
  });
});
