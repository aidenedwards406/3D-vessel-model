/**
 * Statistical tests for comparing treatment groups.
 *
 *  Parametric:        one-way ANOVA + Tukey–Kramer HSD
 *  Unequal variances: Welch's ANOVA + Games–Howell
 *  Non-parametric:    Kruskal–Wallis + Dunn's test (Holm or Bonferroni adjusted)
 *  Assumptions:       Shapiro–Wilk (normality per group), Brown–Forsythe (equal variances)
 *
 * Results match SciPy / scikit-posthocs / pingouin (see stats.test.ts).
 */
import { chi2Sf, fSf, pnorm, pnormUpper, ptukey, qnorm, qt, qtukey } from './distributions';

export interface Descriptives {
  n: number;
  mean: number;
  sd: number;
  sem: number;
  median: number;
  q1: number;
  q3: number;
  min: number;
  max: number;
  ci95: [number, number] | null;
}

const sum = (a: number[]) => a.reduce((s, x) => s + x, 0);
const mean = (a: number[]) => sum(a) / a.length;

function variance(a: number[]): number {
  if (a.length < 2) return NaN;
  const m = mean(a);
  let s = 0;
  for (const x of a) s += (x - m) * (x - m);
  return s / (a.length - 1);
}

/** Quantile with linear interpolation (R type 7 / NumPy default). */
export function quantile(sorted: number[], p: number): number {
  if (sorted.length === 0) return NaN;
  const h = (sorted.length - 1) * p;
  const lo = Math.floor(h);
  const hi = Math.ceil(h);
  return sorted[lo] + (h - lo) * (sorted[hi] - sorted[lo]);
}

export function describe(values: number[]): Descriptives {
  const s = [...values].sort((a, b) => a - b);
  const n = s.length;
  if (n === 0) {
    return { n: 0, mean: NaN, sd: NaN, sem: NaN, median: NaN, q1: NaN, q3: NaN, min: NaN, max: NaN, ci95: null };
  }
  const m = mean(s);
  const sd = n > 1 ? Math.sqrt(variance(s)) : NaN;
  const sem = n > 1 ? sd / Math.sqrt(n) : NaN;
  const t = n > 1 ? qt(0.975, n - 1) : NaN;
  return {
    n,
    mean: m,
    sd,
    sem,
    median: quantile(s, 0.5),
    q1: quantile(s, 0.25),
    q3: quantile(s, 0.75),
    min: s[0],
    max: s[n - 1],
    ci95: n > 1 ? [m - t * sem, m + t * sem] : null,
  };
}

// ── Assumption checks ───────────────────────────────────────────────────────

function poly(cc: number[], x: number): number {
  let ret = cc[0];
  if (cc.length > 1) {
    let p = x * cc[cc.length - 1];
    for (let j = cc.length - 2; j > 0; j--) p = (p + cc[j]) * x;
    ret += p;
  }
  return ret;
}

/** Shapiro–Wilk W test (Royston 1995, AS R94; same algorithm as R and SciPy). */
export function shapiroWilk(values: number[]): { W: number; p: number } | null {
  const x = [...values].sort((a, b) => a - b);
  const n = x.length;
  if (n < 3 || n > 5000) return null;
  const range = x[n - 1] - x[0];
  if (range < 1e-19 * Math.max(1, Math.abs(x[0]))) return null;
  const nn2 = Math.floor(n / 2);
  const a = new Array<number>(nn2 + 1).fill(0); // 1-based
  const g = [-2.273, 0.459];
  const c1 = [0, 0.221157, -0.147981, -2.07119, 4.434685, -2.706056];
  const c2 = [0, 0.042981, -0.293762, -1.752461, 5.682633, -3.582633];
  const c3 = [0.544, -0.39978, 0.025054, -6.714e-4];
  const c4 = [1.3822, -0.77857, 0.062767, -0.0020322];
  const c5 = [-1.5861, -0.31082, -0.083751, 0.0038915];
  const c6 = [-0.4803, -0.082676, 0.0030302];
  const an = n;
  if (n === 3) {
    a[1] = Math.SQRT1_2;
  } else {
    const an25 = an + 0.25;
    let summ2 = 0;
    for (let i = 1; i <= nn2; i++) {
      a[i] = qnorm((i - 0.375) / an25);
      summ2 += a[i] * a[i];
    }
    summ2 *= 2;
    const ssumm2 = Math.sqrt(summ2);
    const rsn = 1 / Math.sqrt(an);
    const a1 = poly(c1, rsn) - a[1] / ssumm2;
    let i1: number;
    let fac: number;
    if (n > 5) {
      i1 = 3;
      const a2 = -a[2] / ssumm2 + poly(c2, rsn);
      fac = Math.sqrt((summ2 - 2 * a[1] * a[1] - 2 * a[2] * a[2]) / (1 - 2 * a1 * a1 - 2 * a2 * a2));
      a[2] = a2;
    } else {
      i1 = 2;
      fac = Math.sqrt((summ2 - 2 * a[1] * a[1]) / (1 - 2 * a1 * a1));
    }
    a[1] = a1;
    for (let i = i1; i <= nn2; i++) a[i] /= -fac;
  }
  // Full antisymmetric coefficient vector for the sorted sample.
  const coef = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    const j = n - 1 - i;
    if (i < j) coef[i] = -a[1 + i];
    else if (i > j) coef[i] = a[1 + j];
    else coef[i] = 0;
  }
  const sa = sum(coef) / n;
  let sx = 0;
  for (let i = 0; i < n; i++) sx += x[i] / range;
  sx /= n;
  let ssa = 0;
  let ssx = 0;
  let sax = 0;
  for (let i = 0; i < n; i++) {
    const asa = coef[i] - sa;
    const xsx = x[i] / range - sx;
    ssa += asa * asa;
    ssx += xsx * xsx;
    sax += asa * xsx;
  }
  const ssassx = Math.sqrt(ssa * ssx);
  const w1 = ((ssassx - sax) * (ssassx + sax)) / (ssa * ssx);
  const W = 1 - w1;
  if (n === 3) {
    const pi6 = 1.90985931710274;
    const stqr = 1.0471975511966;
    return { W, p: Math.max(0, pi6 * (Math.asin(Math.sqrt(W)) - stqr)) };
  }
  let y = Math.log(w1);
  const xx = Math.log(an);
  let m: number;
  let s: number;
  if (n <= 11) {
    const gamma = poly(g, an);
    if (y >= gamma) return { W, p: 1e-99 };
    y = -Math.log(gamma - y);
    m = poly(c3, an);
    s = Math.exp(poly(c4, an));
  } else {
    m = poly(c5, xx);
    s = Math.exp(poly(c6, xx));
  }
  return { W, p: pnormUpper((y - m) / s) };
}

export interface FTest {
  F: number;
  df1: number;
  df2: number;
  p: number;
}

/** Brown–Forsythe test (Levene's test centred on the median). */
export function brownForsythe(groups: number[][]): FTest | null {
  const g = groups.filter((x) => x.length > 0);
  if (g.length < 2) return null;
  const devs = g.map((x) => {
    const med = quantile([...x].sort((a, b) => a - b), 0.5);
    return x.map((v) => Math.abs(v - med));
  });
  const r = oneWayAnova(devs);
  return r ? { F: r.F, df1: r.df1, df2: r.df2, p: r.p } : null;
}

// ── ANOVA family ────────────────────────────────────────────────────────────

export interface AnovaResult extends FTest {
  ssBetween: number;
  ssWithin: number;
  msWithin: number;
  etaSq: number;
  omegaSq: number;
}

export function oneWayAnova(groups: number[][]): AnovaResult | null {
  const g = groups.filter((x) => x.length > 0);
  const k = g.length;
  const N = g.reduce((s, x) => s + x.length, 0);
  if (k < 2 || N - k < 1) return null;
  const grand = sum(g.map(sum)) / N;
  let ssb = 0;
  let ssw = 0;
  for (const x of g) {
    const m = mean(x);
    ssb += x.length * (m - grand) * (m - grand);
    for (const v of x) ssw += (v - m) * (v - m);
  }
  const df1 = k - 1;
  const df2 = N - k;
  const msb = ssb / df1;
  const msw = ssw / df2;
  const F = msw > 0 ? msb / msw : ssb > 0 ? Infinity : NaN;
  const p = Number.isFinite(F) ? fSf(F, df1, df2) : F === Infinity ? 0 : NaN;
  const sst = ssb + ssw;
  return {
    F,
    df1,
    df2,
    p,
    ssBetween: ssb,
    ssWithin: ssw,
    msWithin: msw,
    etaSq: sst > 0 ? ssb / sst : NaN,
    omegaSq: sst + msw > 0 ? Math.max(0, (ssb - df1 * msw) / (sst + msw)) : NaN,
  };
}

export function welchAnova(groups: number[][]): FTest | null {
  const g = groups.filter((x) => x.length > 1);
  const k = g.length;
  if (k < 2) return null;
  const n = g.map((x) => x.length);
  const m = g.map(mean);
  const v = g.map(variance);
  if (v.some((x) => !(x > 0))) return null;
  const w = n.map((ni, i) => ni / v[i]);
  const sw = sum(w);
  const mw = sum(w.map((wi, i) => wi * m[i])) / sw;
  const A = sum(w.map((wi, i) => wi * (m[i] - mw) * (m[i] - mw))) / (k - 1);
  const tmp = sum(w.map((wi, i) => Math.pow(1 - wi / sw, 2) / (n[i] - 1)));
  const B = 1 + ((2 * (k - 2)) / (k * k - 1)) * tmp;
  const F = A / B;
  const df1 = k - 1;
  const df2 = (k * k - 1) / (3 * tmp);
  return { F, df1, df2, p: fSf(F, df1, df2) };
}

export interface PairResult {
  a: number;
  b: number;
  /** mean(a) − mean(b) (or mean rank difference for Dunn). */
  diff: number;
  ciLow: number | null;
  ciHigh: number | null;
  stat: number;
  /** Adjusted p-value (family-wise). */
  p: number;
  /** Unadjusted p-value where meaningful (Dunn). */
  pRaw: number | null;
}

export function tukeyHSD(groups: number[][], alpha = 0.05): PairResult[] {
  const k = groups.length;
  const an = oneWayAnova(groups);
  if (!an || k < 2) return [];
  const qcrit = qtukey(1 - alpha, k, an.df2);
  const out: PairResult[] = [];
  for (let i = 0; i < k; i++) {
    for (let j = i + 1; j < k; j++) {
      const ni = groups[i].length;
      const nj = groups[j].length;
      if (ni === 0 || nj === 0) continue;
      const diff = mean(groups[i]) - mean(groups[j]);
      const se = Math.sqrt((an.msWithin / 2) * (1 / ni + 1 / nj));
      const q = se > 0 ? Math.abs(diff) / se : Infinity;
      const p = Number.isFinite(q) ? Math.max(0, Math.min(1, 1 - ptukey(q, k, an.df2))) : 0;
      out.push({ a: i, b: j, diff, ciLow: diff - qcrit * se, ciHigh: diff + qcrit * se, stat: q, p, pRaw: null });
    }
  }
  return out;
}

export function gamesHowell(groups: number[][], alpha = 0.05): PairResult[] {
  const k = groups.length;
  const out: PairResult[] = [];
  for (let i = 0; i < k; i++) {
    for (let j = i + 1; j < k; j++) {
      const a = groups[i];
      const b = groups[j];
      if (a.length < 2 || b.length < 2) continue;
      const va = variance(a) / a.length;
      const vb = variance(b) / b.length;
      const diff = mean(a) - mean(b);
      const se = Math.sqrt(va + vb);
      const df = ((va + vb) * (va + vb)) / ((va * va) / (a.length - 1) + (vb * vb) / (b.length - 1));
      const t = se > 0 ? diff / se : Infinity;
      const q = Math.abs(t) * Math.SQRT2;
      const p = Number.isFinite(q) && df >= 2 ? Math.max(0, Math.min(1, 1 - ptukey(q, k, df))) : NaN;
      const qcrit = df >= 2 ? qtukey(1 - alpha, k, df) : NaN;
      const half = (qcrit * se) / Math.SQRT2;
      out.push({ a: i, b: j, diff, ciLow: diff - half, ciHigh: diff + half, stat: t, p, pRaw: null });
    }
  }
  return out;
}

// ── Rank-based ──────────────────────────────────────────────────────────────

/** Average ranks (ties share the mean rank), plus tie group sizes. */
export function rankData(values: number[]): { ranks: number[]; ties: number[] } {
  const idx = values.map((v, i) => [v, i] as const).sort((a, b) => a[0] - b[0]);
  const ranks = new Array<number>(values.length);
  const ties: number[] = [];
  let i = 0;
  while (i < idx.length) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
    const r = (i + j) / 2 + 1;
    for (let t = i; t <= j; t++) ranks[idx[t][1]] = r;
    if (j > i) ties.push(j - i + 1);
    i = j + 1;
  }
  return { ranks, ties };
}

export interface KruskalResult {
  H: number;
  df: number;
  p: number;
  epsilonSq: number;
  meanRanks: number[];
}

export function kruskalWallis(groups: number[][]): KruskalResult | null {
  const g = groups.filter((x) => x.length > 0);
  if (g.length < 2) return null;
  const all = g.flat();
  const N = all.length;
  const { ranks, ties } = rankData(all);
  let offset = 0;
  let H = 0;
  const meanRanks: number[] = [];
  for (const x of g) {
    const r = ranks.slice(offset, offset + x.length);
    offset += x.length;
    const R = sum(r);
    meanRanks.push(R / x.length);
    H += (R * R) / x.length;
  }
  H = (12 / (N * (N + 1))) * H - 3 * (N + 1);
  const tieSum = ties.reduce((s, t) => s + t * t * t - t, 0);
  const C = 1 - tieSum / (N * N * N - N);
  if (C <= 0) return { H: NaN, df: g.length - 1, p: NaN, epsilonSq: NaN, meanRanks };
  H /= C;
  return { H, df: g.length - 1, p: chi2Sf(H, g.length - 1), epsilonSq: H / ((N * N - 1) / (N + 1)), meanRanks };
}

export type PAdjust = 'holm' | 'bonferroni';

export function adjustP(p: number[], method: PAdjust): number[] {
  const m = p.length;
  if (method === 'bonferroni') return p.map((x) => Math.min(1, x * m));
  const order = p.map((x, i) => [x, i] as const).sort((a, b) => a[0] - b[0]);
  const out = new Array<number>(m);
  let running = 0;
  order.forEach(([x, i], rank) => {
    running = Math.max(running, Math.min(1, (m - rank) * x));
    out[i] = running;
  });
  return out;
}

/** Dunn's test with tie correction (matches scikit-posthocs posthoc_dunn). */
export function dunn(groups: number[][], method: PAdjust = 'holm'): PairResult[] {
  const k = groups.length;
  const all = groups.flat();
  const N = all.length;
  if (N < 2) return [];
  const { ranks, ties } = rankData(all);
  const meanRanks: number[] = [];
  let offset = 0;
  for (const x of groups) {
    const r = ranks.slice(offset, offset + x.length);
    offset += x.length;
    meanRanks.push(x.length ? sum(r) / x.length : NaN);
  }
  const tieSum = ties.reduce((s, t) => s + t * t * t - t, 0);
  const base = (N * (N + 1)) / 12 - tieSum / (12 * (N - 1));
  const pairs: PairResult[] = [];
  for (let i = 0; i < k; i++) {
    for (let j = i + 1; j < k; j++) {
      if (!groups[i].length || !groups[j].length) continue;
      const diff = meanRanks[i] - meanRanks[j];
      const se = Math.sqrt(base * (1 / groups[i].length + 1 / groups[j].length));
      const z = se > 0 ? diff / se : 0;
      const pRaw = 2 * pnormUpper(Math.abs(z));
      pairs.push({ a: i, b: j, diff, ciLow: null, ciHigh: null, stat: z, p: pRaw, pRaw });
    }
  }
  const adj = adjustP(
    pairs.map((x) => x.pRaw!),
    method,
  );
  pairs.forEach((x, i) => (x.p = adj[i]));
  return pairs;
}

// ── Orchestration ───────────────────────────────────────────────────────────

export type TestChoice = 'auto' | 'anova' | 'welch' | 'kruskal';

export interface GroupStats {
  name: string;
  values: number[];
  desc: Descriptives;
  normality: { W: number; p: number } | null;
}

export interface Analysis {
  groups: GroupStats[];
  test: Exclude<TestChoice, 'auto'>;
  testName: string;
  postHocName: string;
  reason: string;
  omnibus: { stat: number; statName: string; df1: number; df2: number | null; p: number; effect: number | null; effectName: string } | null;
  pairs: PairResult[];
  equalVariance: FTest | null;
  allNormal: boolean;
  warnings: string[];
  alpha: number;
}

export function analyze(
  groupsIn: { name: string; values: number[] }[],
  choice: TestChoice,
  alpha = 0.05,
  padjust: PAdjust = 'holm',
): Analysis {
  const groups: GroupStats[] = groupsIn
    .filter((g) => g.values.length > 0)
    .map((g) => ({ name: g.name, values: g.values, desc: describe(g.values), normality: shapiroWilk(g.values) }));
  const warnings: string[] = [];
  const vals = groups.map((g) => g.values);
  const tooSmall = groups.filter((g) => g.values.length < 3);
  if (tooSmall.length) warnings.push(`${tooSmall.map((g) => g.name).join(', ')} ha${tooSmall.length > 1 ? 've' : 's'} fewer than 3 values; results are unreliable.`);
  const normalities = groups.map((g) => g.normality);
  const allNormal = normalities.every((n) => n === null || n.p >= alpha);
  const equalVariance = brownForsythe(vals);
  const equalVar = !equalVariance || equalVariance.p >= alpha;

  let test: Exclude<TestChoice, 'auto'>;
  let reason: string;
  if (choice === 'auto') {
    if (!allNormal) {
      test = 'kruskal';
      const failed = groups.filter((g) => g.normality && g.normality.p < alpha).map((g) => g.name);
      reason = `Kruskal–Wallis was chosen because the values in ${failed.join(', ')} don't look normally distributed (Shapiro–Wilk p < ${alpha}).`;
    } else if (!equalVar) {
      test = 'welch';
      reason = `Welch's ANOVA was chosen because the groups have unequal spread (Brown–Forsythe p < ${alpha}).`;
    } else {
      test = 'anova';
      reason = 'One-way ANOVA was chosen because each group looks normally distributed with similar spread.';
    }
  } else {
    test = choice;
    reason = 'Test chosen manually.';
    if (choice === 'anova' && !allNormal) warnings.push("Some groups don't look normally distributed; consider Kruskal–Wallis.");
    if (choice === 'anova' && !equalVar) warnings.push("Group spreads differ; consider Welch's ANOVA.");
  }

  let omnibus: Analysis['omnibus'] = null;
  let pairs: PairResult[] = [];
  let testName = '';
  let postHocName = '';
  if (groups.length >= 2) {
    if (test === 'anova') {
      testName = 'One-way ANOVA';
      postHocName = 'Tukey HSD';
      const r = oneWayAnova(vals);
      if (r) omnibus = { stat: r.F, statName: 'F', df1: r.df1, df2: r.df2, p: r.p, effect: r.etaSq, effectName: 'η²' };
      pairs = tukeyHSD(vals, alpha);
    } else if (test === 'welch') {
      testName = "Welch's ANOVA";
      postHocName = 'Games–Howell';
      const r = welchAnova(vals);
      if (r) omnibus = { stat: r.F, statName: 'F', df1: r.df1, df2: r.df2, p: r.p, effect: null, effectName: '' };
      else warnings.push("Welch's ANOVA needs at least 2 values with some spread in every group.");
      pairs = gamesHowell(vals, alpha);
    } else {
      testName = 'Kruskal–Wallis';
      postHocName = `Dunn (${padjust === 'holm' ? 'Holm' : 'Bonferroni'})`;
      const r = kruskalWallis(vals);
      if (r) omnibus = { stat: r.H, statName: 'H', df1: r.df, df2: null, p: r.p, effect: r.epsilonSq, effectName: 'ε²' };
      pairs = dunn(vals, padjust);
    }
  } else {
    warnings.push('At least two groups with data are needed to compare treatments.');
  }
  return { groups, test, testName, postHocName, reason, omnibus, pairs, equalVariance, allNormal, warnings, alpha };
}

export function stars(p: number): string {
  if (!Number.isFinite(p)) return '';
  if (p < 0.001) return '***';
  if (p < 0.01) return '**';
  if (p < 0.05) return '*';
  return 'ns';
}

/** "p < 0.0001" or "p = 0.032". */
export function pText(p: number | null | undefined): string {
  const f = formatP(p);
  return f.startsWith('<') ? `p ${f}` : `p = ${f}`;
}

export function formatP(p: number | null | undefined): string {
  if (p === null || p === undefined || !Number.isFinite(p)) return '–';
  if (p < 0.0001) return '< 0.0001';
  if (p < 0.001) return p.toFixed(4);
  return p.toFixed(3);
}

export { pnorm };
