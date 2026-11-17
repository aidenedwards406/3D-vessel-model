/**
 * Probability distributions used by the statistics module.
 * Implemented from standard numerical methods and verified against SciPy
 * (see stats.test.ts and the reference fixture generated with scipy.stats).
 */

const LANCZOS = [
  0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059,
  12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
];

/** log Γ(x) */
export function lgamma(x: number): number {
  if (x < 0.5) return Math.log(Math.PI / Math.abs(Math.sin(Math.PI * x))) - lgamma(1 - x);
  const z = x - 1;
  let a = LANCZOS[0];
  const t = z + 7.5;
  for (let i = 1; i < 9; i++) a += LANCZOS[i] / (z + i);
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(a);
}

// ── Normal ──────────────────────────────────────────────────────────────────

const SQRT_PI = Math.sqrt(Math.PI);

/** erfc(x) for x ≥ 0, accurate to ~1e-15. */
function erfcPos(x: number): number {
  if (x < 3) {
    const x2 = x * x;
    let term = x;
    let sum = x;
    for (let n = 1; n < 300; n++) {
      term *= (2 * x2) / (2 * n + 1);
      sum += term;
      if (term < sum * 1e-17) break;
    }
    return 1 - (2 / SQRT_PI) * Math.exp(-x2) * sum;
  }
  // Continued fraction (modified Lentz): x + (1/2)/(x + 1/(x + (3/2)/(x + …)))
  const tiny = 1e-300;
  let f = x;
  let C = x;
  let D = 0;
  for (let k = 1; k < 500; k++) {
    const a = k / 2;
    D = x + a * D;
    if (D === 0) D = tiny;
    D = 1 / D;
    C = x + a / C;
    if (C === 0) C = tiny;
    const delta = C * D;
    f *= delta;
    if (Math.abs(delta - 1) < 1e-16) break;
  }
  return Math.exp(-x * x) / SQRT_PI / f;
}

export function erfc(x: number): number {
  return x >= 0 ? erfcPos(x) : 2 - erfcPos(-x);
}

/** Standard normal CDF Φ(x). */
export function pnorm(x: number, mean = 0, sd = 1): number {
  const z = (x - mean) / sd / Math.SQRT2;
  return z >= 0 ? 1 - 0.5 * erfcPos(z) : 0.5 * erfcPos(-z);
}

/** Upper tail 1 − Φ(x), accurate for large x. */
export function pnormUpper(x: number): number {
  const z = x / Math.SQRT2;
  return z >= 0 ? 0.5 * erfcPos(z) : 1 - 0.5 * erfcPos(-z);
}

/** Standard normal quantile (Wichura AS241) with a Newton polish step. */
export function qnorm(p: number): number {
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;
  const q = p - 0.5;
  let val: number;
  if (Math.abs(q) <= 0.425) {
    const r = 0.180625 - q * q;
    val =
      (q *
        (((((((r * 2509.0809287301226727 + 33430.575583588128105) * r + 67265.770927008700853) * r +
          45921.953931549871457) *
          r +
          13731.693765509461125) *
          r +
          1971.5909503065514427) *
          r +
          133.14166789178437745) *
          r +
          3.387132872796366608)) /
      (((((((r * 5226.495278852545925 + 28729.085735721942674) * r + 39307.89580009271061) * r +
        21213.794301586595867) *
        r +
        5394.1960214247511077) *
        r +
        687.1870074920579083) *
        r +
        42.313330701600911252) *
        r +
        1.0);
  } else {
    let r = q < 0 ? p : 1 - p;
    r = Math.sqrt(-Math.log(r));
    if (r <= 5) {
      r -= 1.6;
      val =
        (((((((r * 7.7454501427834140764e-4 + 0.0227238449892691845833) * r + 0.24178072517745061177) * r +
          1.27045825245236838258) *
          r +
          3.64784832476320460504) *
          r +
          5.7694972214606914055) *
          r +
          4.6303378461565452959) *
          r +
          1.42343711074968357734) /
        (((((((r * 1.05075007164441684324e-9 + 5.475938084995344946e-4) * r + 0.0151986665636164571966) * r +
          0.14810397642748007459) *
          r +
          0.68976733498510000455) *
          r +
          1.6763848301838038494) *
          r +
          2.05319162663775882187) *
          r +
          1.0);
    } else {
      r -= 5;
      val =
        (((((((r * 2.01033439929228813265e-7 + 2.71155556874348757815e-5) * r + 0.0012426609473880784386) * r +
          0.026532189526576123093) *
          r +
          0.29656057182850489123) *
          r +
          1.7848265399172913358) *
          r +
          5.4637849111641143699) *
          r +
          6.6579046435011037772) /
        (((((((r * 2.04426310338993978564e-15 + 1.4215117583164458887e-7) * r + 1.8463183175100546818e-5) * r +
          7.868691311456132591e-4) *
          r +
          0.0148753612908506148525) *
          r +
          0.13692988092273580531) *
          r +
          0.59983220655588793769) *
          r +
          1.0);
    }
    if (q < 0) val = -val;
  }
  // One Newton step against the accurate CDF.
  const pdf = Math.exp(-0.5 * val * val) / Math.sqrt(2 * Math.PI);
  if (pdf > 1e-300) {
    const err = (val > 0 ? 1 - pnormUpper(val) : pnorm(val)) - p;
    if (Math.abs(err) < 0.01) val -= err / pdf;
  }
  return val;
}

// ── Incomplete beta / gamma ─────────────────────────────────────────────────

function betacf(a: number, b: number, x: number): number {
  const FPMIN = 1e-300;
  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < FPMIN) d = FPMIN;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= 2000; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 3e-16) break;
  }
  return h;
}

/** Regularized incomplete beta I_x(a, b). */
export function betaInc(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const lbt = lgamma(a + b) - lgamma(a) - lgamma(b) + a * Math.log(x) + b * Math.log(1 - x);
  const bt = Math.exp(lbt);
  if (x < (a + 1) / (a + b + 2)) return (bt * betacf(a, b, x)) / a;
  return 1 - (bt * betacf(b, a, 1 - x)) / b;
}

/** Regularized lower incomplete gamma P(a, x). */
export function gammaP(a: number, x: number): number {
  if (x <= 0) return 0;
  if (x < a + 1) {
    let ap = a;
    let sum = 1 / a;
    let del = sum;
    for (let n = 0; n < 2000; n++) {
      ap += 1;
      del *= x / ap;
      sum += del;
      if (Math.abs(del) < Math.abs(sum) * 1e-16) break;
    }
    return sum * Math.exp(-x + a * Math.log(x) - lgamma(a));
  }
  return 1 - gammaQ(a, x);
}

/** Regularized upper incomplete gamma Q(a, x) = 1 − P(a, x). */
export function gammaQ(a: number, x: number): number {
  if (x <= 0) return 1;
  if (x < a + 1) return 1 - gammaP(a, x);
  const FPMIN = 1e-300;
  let b = x + 1 - a;
  let c = 1 / FPMIN;
  let d = 1 / b;
  let h = d;
  for (let i = 1; i < 2000; i++) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = b + an / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 3e-16) break;
  }
  return Math.exp(-x + a * Math.log(x) - lgamma(a)) * h;
}

// ── t, F, χ² ─────────────────────────────────────────────────────────────────

/** Student t CDF. */
export function tCdf(t: number, df: number): number {
  const x = df / (df + t * t);
  const tail = 0.5 * betaInc(x, df / 2, 0.5);
  return t > 0 ? 1 - tail : tail;
}

/** Two-sided p-value for a t statistic. */
export function tTwoSided(t: number, df: number): number {
  return betaInc(df / (df + t * t), df / 2, 0.5);
}

/** Student t quantile. */
export function qt(p: number, df: number): number {
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;
  if (p === 0.5) return 0;
  const upper = p > 0.5;
  const target = upper ? 1 - p : p; // lower-tail mass beyond |t|
  let lo = 0;
  let hi = 10;
  while (0.5 * betaInc(df / (df + hi * hi), df / 2, 0.5) > target && hi < 1e8) hi *= 2;
  for (let i = 0; i < 200; i++) {
    const mid = 0.5 * (lo + hi);
    const tail = 0.5 * betaInc(df / (df + mid * mid), df / 2, 0.5);
    if (tail > target) lo = mid;
    else hi = mid;
    if (hi - lo < 1e-13 * Math.max(1, mid)) break;
  }
  const t = 0.5 * (lo + hi);
  return upper ? t : -t;
}

/** Upper tail of the F distribution, P(F ≥ f). */
export function fSf(f: number, df1: number, df2: number): number {
  if (!(f > 0)) return 1;
  return betaInc(df2 / (df2 + df1 * f), df2 / 2, df1 / 2);
}

/** Upper tail of χ², P(X ≥ x). */
export function chi2Sf(x: number, df: number): number {
  if (!(x > 0)) return 1;
  return gammaQ(df / 2, x / 2);
}

// ── Studentized range (port of R's ptukey, Copenhaver & Holland 1988) ───────

function gaussLegendre(n: number): { x: number[]; w: number[] } {
  // Positive nodes and weights, descending x.
  const xs: number[] = [];
  const ws: number[] = [];
  const m = Math.floor((n + 1) / 2);
  for (let i = 1; i <= m; i++) {
    let z = Math.cos((Math.PI * (i - 0.25)) / (n + 0.5));
    let pp = 0;
    for (let it = 0; it < 100; it++) {
      let p1 = 1;
      let p2 = 0;
      for (let j = 1; j <= n; j++) {
        const p3 = p2;
        p2 = p1;
        p1 = ((2 * j - 1) * z * p2 - (j - 1) * p3) / j;
      }
      pp = (n * (z * p1 - p2)) / (z * z - 1);
      const z1 = z;
      z = z1 - p1 / pp;
      if (Math.abs(z - z1) < 1e-16) break;
    }
    xs.push(z);
    ws.push(2 / ((1 - z * z) * pp * pp));
  }
  return { x: xs, w: ws };
}

const GL12 = gaussLegendre(12);
const GL16 = gaussLegendre(16);
// R's tables list nodes from largest to smallest.
const XLEG = GL12.x;
const ALEG = GL12.w;
const XLEGQ = GL16.x;
const ALEGQ = GL16.w;

function wprob(w: number, rr: number, cc: number): number {
  const nleg = 12;
  const ihalf = 6;
  const C1 = -30;
  const C2 = -50;
  const C3 = 60;
  const bb = 8;
  const wlar = 3;
  const wincr1 = 2;
  const wincr2 = 3;
  const qsqz = w * 0.5;
  if (qsqz >= bb) return 1;
  let prW = 2 * pnorm(qsqz) - 1;
  if (prW >= Math.exp(C2 / cc)) prW = Math.pow(prW, cc);
  else prW = 0;
  const wincr = w > wlar ? wincr1 : wincr2;
  let blb = qsqz;
  const binc = (bb - qsqz) / wincr;
  let bub = blb + binc;
  let einsum = 0;
  const cc1 = cc - 1;
  for (let wi = 1; wi <= wincr; wi++) {
    let elsum = 0;
    const a = 0.5 * (bub + blb);
    const b = 0.5 * (bub - blb);
    for (let jj = 1; jj <= nleg; jj++) {
      let j: number;
      let xx: number;
      if (ihalf < jj) {
        j = nleg - jj + 1;
        xx = XLEG[j - 1];
      } else {
        j = jj;
        xx = -XLEG[j - 1];
      }
      const c = b * xx;
      const ac = a + c;
      const qexpo = ac * ac;
      if (qexpo > C3) break;
      const pplus = 2 * pnorm(ac);
      const pminus = 2 * pnorm(ac, w, 1);
      let rinsum = pplus * 0.5 - pminus * 0.5;
      if (rinsum >= Math.exp(C1 / cc1)) {
        rinsum = ALEG[j - 1] * Math.exp(-(0.5 * qexpo)) * Math.pow(rinsum, cc1);
        elsum += rinsum;
      }
    }
    elsum *= (2 * b * cc) / Math.sqrt(2 * Math.PI);
    einsum += elsum;
    blb = bub;
    bub += binc;
  }
  prW += einsum;
  if (prW <= Math.exp(C1 / rr)) return 0;
  prW = Math.pow(prW, rr);
  return prW >= 1 ? 1 : prW;
}

/** CDF of the studentized range distribution for k means and df error degrees of freedom. */
export function ptukey(q: number, k: number, df: number, nranges = 1): number {
  if (!(q > 0)) return 0;
  if (!Number.isFinite(q)) return 1;
  if (df < 2 || k < 2) return NaN;
  const nlegq = 16;
  const ihalfq = 8;
  const eps1 = -30;
  const eps2 = 1e-14;
  const dhaf = 100;
  const dquar = 800;
  const deigh = 5000;
  const dlarg = 25000;
  if (df > dlarg) return wprob(q, nranges, k);
  const f2 = df * 0.5;
  let f2lf = f2 * Math.log(df) - df * Math.LN2 - lgamma(f2);
  const f21 = f2 - 1;
  const ff4 = df * 0.25;
  const ulen = df <= dhaf ? 1 : df <= dquar ? 0.5 : df <= deigh ? 0.25 : 0.125;
  f2lf += Math.log(ulen);
  let ans = 0;
  let otsum = 0;
  for (let i = 1; i <= 50; i++) {
    otsum = 0;
    const twa1 = (2 * i - 1) * ulen;
    for (let jj = 1; jj <= nlegq; jj++) {
      let j: number;
      let t1: number;
      if (ihalfq < jj) {
        j = jj - ihalfq - 1;
        t1 = f2lf + f21 * Math.log(twa1 + XLEGQ[j] * ulen) - (XLEGQ[j] * ulen + twa1) * ff4;
      } else {
        j = jj - 1;
        t1 = f2lf + f21 * Math.log(twa1 - XLEGQ[j] * ulen) + (XLEGQ[j] * ulen - twa1) * ff4;
      }
      if (t1 >= eps1) {
        const qsqz =
          ihalfq < jj ? q * Math.sqrt((XLEGQ[j] * ulen + twa1) * 0.5) : q * Math.sqrt((-(XLEGQ[j] * ulen) + twa1) * 0.5);
        const wprb = wprob(qsqz, nranges, k);
        otsum += wprb * ALEGQ[j] * Math.exp(t1);
      }
    }
    if (i * ulen >= 1 && otsum <= eps2) break;
    ans += otsum;
  }
  return ans > 1 ? 1 : ans;
}

/** Quantile of the studentized range distribution. */
export function qtukey(p: number, k: number, df: number): number {
  if (!(p > 0 && p < 1)) return NaN;
  let lo = 0;
  let hi = 8;
  while (ptukey(hi, k, df) < p && hi < 1e4) {
    lo = hi;
    hi *= 2;
  }
  // Illinois-modified regula falsi: keeps the bracket and avoids the slow
  // one-sided convergence of plain false position.
  let flo = ptukey(lo, k, df) - p;
  let fhi = ptukey(hi, k, df) - p;
  let x = hi;
  let side = 0;
  for (let i = 0; i < 200; i++) {
    let next = (lo * fhi - hi * flo) / (fhi - flo);
    if (!(next > lo && next < hi) || !Number.isFinite(next)) next = 0.5 * (lo + hi);
    const fn = ptukey(next, k, df) - p;
    x = next;
    if (Math.abs(fn) < 1e-12 || hi - lo < 1e-11 * Math.max(1, x)) break;
    if (fn < 0) {
      lo = next;
      flo = fn;
      if (side === -1) fhi /= 2;
      side = -1;
    } else {
      hi = next;
      fhi = fn;
      if (side === 1) flo /= 2;
      side = 1;
    }
  }
  return x;
}
