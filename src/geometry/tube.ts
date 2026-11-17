/**
 * Procedural vessel geometry: a hollow tube (outer + inner wall, annular ends)
 * swept along any 3D curve. Used for the demo study and for tests.
 */

export type Vec3 = [number, number, number];

export interface TubeOptions {
  curve: (t: number) => Vec3;
  rings?: number;
  radial?: number;
  outerRadius?: number | ((t: number) => number);
  innerRadius?: number;
  /** Close the ends with solid caps instead of annular faces. */
  capped?: boolean;
  /** Random displacement (model units) to imitate a scan. */
  noise?: number;
  seed?: number;
}

export interface TubeMesh {
  positions: Float32Array;
  index: Uint32Array;
  /** True arc-length parameter (0…1) of each vertex, for tests. */
  trueT: Float32Array;
  length: number;
}

function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}
function dot(a: Vec3, b: Vec3) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
function norm(a: Vec3): Vec3 {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
}

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Re-parameterises a curve by arc length. */
function arcLengthSampler(curve: (t: number) => Vec3, n = 4000) {
  const pts: Vec3[] = [];
  const cum = new Float64Array(n + 1);
  for (let i = 0; i <= n; i++) pts.push(curve(i / n));
  for (let i = 1; i <= n; i++) {
    const d = sub(pts[i], pts[i - 1]);
    cum[i] = cum[i - 1] + Math.hypot(d[0], d[1], d[2]);
  }
  const L = cum[n];
  return {
    length: L,
    at(u: number): Vec3 {
      const target = u * L;
      let lo = 0;
      let hi = n;
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (cum[mid] < target) lo = mid;
        else hi = mid;
      }
      const f = (target - cum[lo]) / Math.max(1e-12, cum[hi] - cum[lo]);
      const a = pts[lo];
      const b = pts[hi];
      return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
    },
  };
}

export function makeTube(opts: TubeOptions): TubeMesh {
  const rings = opts.rings ?? 200;
  const radial = opts.radial ?? 40;
  const rOut = opts.outerRadius ?? 3;
  const rIn = opts.innerRadius ?? 2.3;
  const capped = opts.capped ?? false;
  const rand = mulberry32(opts.seed ?? 7);
  const sampler = arcLengthSampler(opts.curve);
  const P: Vec3[] = [];
  for (let i = 0; i < rings; i++) P.push(sampler.at(i / (rings - 1)));
  const T: Vec3[] = P.map((_p, i) => norm(sub(P[Math.min(rings - 1, i + 1)], P[Math.max(0, i - 1)])));
  // Parallel-transport frames, starting from world up projected.
  const N: Vec3[] = [];
  const B: Vec3[] = [];
  let up: Vec3 = [0, 1, 0];
  if (Math.abs(dot(up, T[0])) > 0.9) up = [1, 0, 0];
  let n0 = norm(sub(up, T[0].map((x) => x * dot(up, T[0])) as Vec3));
  for (let i = 0; i < rings; i++) {
    const t = T[i];
    n0 = norm(sub(n0, t.map((x) => x * dot(n0, t)) as Vec3));
    N.push(n0);
    B.push(norm(cross(t, n0)));
  }

  const positions: number[] = [];
  const trueT: number[] = [];
  const index: number[] = [];
  const jitter = () => (opts.noise ? (rand() - 0.5) * 2 * opts.noise : 0);
  const ring = (i: number, r: number) => {
    const start = positions.length / 3;
    const t = i / (rings - 1);
    for (let j = 0; j < radial; j++) {
      const a = (2 * Math.PI * j) / radial;
      const c = Math.cos(a);
      const s = Math.sin(a);
      positions.push(
        P[i][0] + r * (c * N[i][0] + s * B[i][0]) + jitter(),
        P[i][1] + r * (c * N[i][1] + s * B[i][1]) + jitter(),
        P[i][2] + r * (c * N[i][2] + s * B[i][2]) + jitter(),
      );
      trueT.push(t);
    }
    return start;
  };
  const outerStarts: number[] = [];
  const innerStarts: number[] = [];
  for (let i = 0; i < rings; i++) {
    const r = typeof rOut === 'function' ? rOut(i / (rings - 1)) : rOut;
    outerStarts.push(ring(i, r));
  }
  const hollow = !capped && rIn > 0;
  if (hollow) for (let i = 0; i < rings; i++) innerStarts.push(ring(i, rIn));

  const quadStrip = (a0: number, b0: number, flip: boolean) => {
    for (let j = 0; j < radial; j++) {
      const j1 = (j + 1) % radial;
      const a = a0 + j;
      const b = a0 + j1;
      const c = b0 + j;
      const d = b0 + j1;
      if (flip) index.push(a, c, b, b, c, d);
      else index.push(a, b, c, b, d, c);
    }
  };
  for (let i = 0; i < rings - 1; i++) quadStrip(outerStarts[i], outerStarts[i + 1], false);
  if (hollow) {
    for (let i = 0; i < rings - 1; i++) quadStrip(innerStarts[i], innerStarts[i + 1], true);
    quadStrip(outerStarts[0], innerStarts[0], true);
    quadStrip(outerStarts[rings - 1], innerStarts[rings - 1], false);
  } else {
    for (const [i, flip] of [
      [0, true],
      [rings - 1, false],
    ] as const) {
      const c = positions.length / 3;
      positions.push(P[i][0], P[i][1], P[i][2]);
      trueT.push(i / (rings - 1));
      for (let j = 0; j < radial; j++) {
        const a = outerStarts[i] + j;
        const b = outerStarts[i] + ((j + 1) % radial);
        if (flip) index.push(c, b, a);
        else index.push(c, a, b);
      }
    }
  }
  return {
    positions: new Float32Array(positions),
    index: new Uint32Array(index),
    trueT: new Float32Array(trueT),
    length: sampler.length,
  };
}

/** The demo vessel: a tortuous S-shaped mimic lying flat, ~110 mm long. */
export function demoVesselCurve(t: number): Vec3 {
  const x = -55 + 110 * t;
  const z = 15 * Math.sin((2 * Math.PI * (x + 55)) / 110);
  const y = 1.5 * Math.sin((Math.PI * (x + 55)) / 110);
  return [x, y, z];
}

export function makeDemoVessel(): TubeMesh {
  return makeTube({
    curve: demoVesselCurve,
    rings: 260,
    radial: 56,
    outerRadius: (t) => 3.1 + 0.25 * Math.sin(t * Math.PI * 3),
    innerRadius: 2.35,
  });
}

/** Writes a binary STL (so users can download the demo model and try the STL import). */
export function writeBinaryStl(positions: Float32Array, index: Uint32Array, header = 'Demo vessel mimic'): ArrayBuffer {
  const triCount = index.length / 3;
  const buf = new ArrayBuffer(84 + triCount * 50);
  const dv = new DataView(buf);
  const enc = new TextEncoder().encode(header.slice(0, 79));
  new Uint8Array(buf, 0, 80).set(enc);
  dv.setUint32(80, triCount, true);
  let o = 84;
  for (let f = 0; f < triCount; f++) {
    const ia = index[3 * f] * 3;
    const ib = index[3 * f + 1] * 3;
    const ic = index[3 * f + 2] * 3;
    const ax = positions[ia], ay = positions[ia + 1], az = positions[ia + 2];
    const bx = positions[ib], by = positions[ib + 1], bz = positions[ib + 2];
    const cx = positions[ic], cy = positions[ic + 1], cz = positions[ic + 2];
    const ux = bx - ax, uy = by - ay, uz = bz - az;
    const vx = cx - ax, vy = cy - ay, vz = cz - az;
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l;
    ny /= l;
    nz /= l;
    for (const v of [nx, ny, nz, ax, ay, az, bx, by, bz, cx, cy, cz]) {
      dv.setFloat32(o, v, true);
      o += 4;
    }
    dv.setUint16(o, 0, true);
    o += 2;
  }
  return buf;
}
