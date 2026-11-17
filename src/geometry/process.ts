/**
 * Vessel geometry processing (runs in a Web Worker).
 *
 * Finds the vessel's centerline and gives every vertex:
 *   aT      – position along the centerline, 0 … 1 (end to end)
 *   radial  – unit direction from the centerline to the vertex
 *
 * Curved ("auto") method, robust to tortuous geometry:
 *   1. Weld duplicate vertices (STL files are triangle soup) and build the surface graph.
 *   2. Find the two ends with a double sweep of geodesic (Dijkstra) distances.
 *   3. Pick the end rims/caps and run multi-source geodesic distances from each end;
 *      f = d₀ / (d₀ + d₁) has ring-shaped level sets around a tube, even through bends.
 *   4. Centroids of rings of equal f trace the centerline; smooth it.
 *   5. Project every vertex onto the centerline (planar cuts, like a blade).
 * Straight method: principal axis (PCA) of the surface.
 */

export interface ProcessInput {
  positions: Float32Array;
  index: Uint32Array | null;
  mode: 'auto' | 'straight';
}

export interface ProcessResult {
  positions: Float32Array;
  index: Uint32Array;
  aT: Float32Array;
  radial: Float32Array;
  dist: Float32Array;
  centerline: Float32Array;
  tangents: Float32Array;
  radiusMax: Float32Array;
  radiusMean: Float32Array;
  length: number;
  method: 'curved' | 'straight';
  quality: number;
  warnings: string[];
  components: number;
  mainShare: number;
  vertexCount: number;
  triangleCount: number;
  timings: Record<string, number>;
}

export const CENTERLINE_SAMPLES = 256;
const GRAPH_LIMIT = 160_000;
const CLUSTER_TARGET = 110_000;

type Progress = (stage: string, fraction: number) => void;

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

// ── Welding ─────────────────────────────────────────────────────────────────

export function weld(pos: Float32Array, index: Uint32Array | null) {
  const nIn = Math.floor(pos.length / 3);
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < nIn; i++) {
    const x = pos[3 * i], y = pos[3 * i + 1], z = pos[3 * i + 2];
    if (!(Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z))) continue;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (z < minZ) minZ = z;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
    if (z > maxZ) maxZ = z;
  }
  const diag = Math.hypot(maxX - minX, maxY - minY, maxZ - minZ) || 1;
  const inv = 1 / (diag * 1e-6);
  let cap = 1;
  while (cap < nIn * 2) cap <<= 1;
  const mask = cap - 1;
  const table = new Int32Array(cap).fill(-1);
  const qx = new Int32Array(nIn);
  const qy = new Int32Array(nIn);
  const qz = new Int32Array(nIn);
  const out = new Float32Array(nIn * 3);
  const map = new Uint32Array(nIn);
  let count = 0;
  for (let i = 0; i < nIn; i++) {
    const x = pos[3 * i], y = pos[3 * i + 1], z = pos[3 * i + 2];
    const ix = Math.round((x - minX) * inv) | 0;
    const iy = Math.round((y - minY) * inv) | 0;
    const iz = Math.round((z - minZ) * inv) | 0;
    let h = (Math.imul(ix, 73856093) ^ Math.imul(iy, 19349663) ^ Math.imul(iz, 83492791)) & mask;
    for (;;) {
      const e = table[h];
      if (e === -1) {
        table[h] = count;
        qx[count] = ix;
        qy[count] = iy;
        qz[count] = iz;
        out[3 * count] = x;
        out[3 * count + 1] = y;
        out[3 * count + 2] = z;
        map[i] = count++;
        break;
      }
      if (qx[e] === ix && qy[e] === iy && qz[e] === iz) {
        map[i] = e;
        break;
      }
      h = (h + 1) & mask;
    }
  }
  const nTri = index ? Math.floor(index.length / 3) : Math.floor(nIn / 3);
  const tri = new Uint32Array(nTri * 3);
  let t = 0;
  for (let f = 0; f < nTri; f++) {
    const a = map[index ? index[3 * f] : 3 * f];
    const b = map[index ? index[3 * f + 1] : 3 * f + 1];
    const c = map[index ? index[3 * f + 2] : 3 * f + 2];
    if (a === b || b === c || a === c) continue;
    tri[t++] = a;
    tri[t++] = b;
    tri[t++] = c;
  }
  return { pos: out.slice(0, count * 3), tri: tri.slice(0, t), count };
}

// ── Graph ───────────────────────────────────────────────────────────────────

interface Graph {
  n: number;
  px: Float64Array;
  py: Float64Array;
  pz: Float64Array;
  w: Float64Array;
  off: Int32Array;
  adj: Int32Array;
  len: Float32Array;
}

function vertexAreas(pos: Float32Array, tri: Uint32Array, V: number): { area: Float64Array; total: number } {
  const area = new Float64Array(V);
  let total = 0;
  for (let f = 0; f < tri.length; f += 3) {
    const a = tri[f] * 3, b = tri[f + 1] * 3, c = tri[f + 2] * 3;
    const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
    const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
    const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
    const ar = 0.5 * Math.sqrt(cx * cx + cy * cy + cz * cz);
    total += ar;
    area[tri[f]] += ar / 3;
    area[tri[f + 1]] += ar / 3;
    area[tri[f + 2]] += ar / 3;
  }
  return { area, total };
}

function buildGraph(pos: Float32Array, tri: Uint32Array, V: number, area: Float64Array, totalArea: number) {
  let nodeOf: Int32Array;
  let n: number;
  if (V <= GRAPH_LIMIT) {
    nodeOf = new Int32Array(V);
    for (let i = 0; i < V; i++) nodeOf[i] = i;
    n = V;
  } else {
    // Cluster vertices on a grid so the graph stays a manageable size.
    const h = Math.sqrt(totalArea / CLUSTER_TARGET) || 1;
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    for (let i = 0; i < V; i++) {
      if (pos[3 * i] < minX) minX = pos[3 * i];
      if (pos[3 * i + 1] < minY) minY = pos[3 * i + 1];
      if (pos[3 * i + 2] < minZ) minZ = pos[3 * i + 2];
    }
    let cap = 1;
    while (cap < V) cap <<= 1;
    const mask = cap - 1;
    const table = new Int32Array(cap).fill(-1);
    const kx: number[] = [], ky: number[] = [], kz: number[] = [];
    nodeOf = new Int32Array(V);
    n = 0;
    for (let i = 0; i < V; i++) {
      const ix = Math.floor((pos[3 * i] - minX) / h);
      const iy = Math.floor((pos[3 * i + 1] - minY) / h);
      const iz = Math.floor((pos[3 * i + 2] - minZ) / h);
      let hh = (Math.imul(ix, 73856093) ^ Math.imul(iy, 19349663) ^ Math.imul(iz, 83492791)) & mask;
      for (;;) {
        const e = table[hh];
        if (e === -1) {
          table[hh] = n;
          kx.push(ix);
          ky.push(iy);
          kz.push(iz);
          nodeOf[i] = n++;
          break;
        }
        if (kx[e] === ix && ky[e] === iy && kz[e] === iz) {
          nodeOf[i] = e;
          break;
        }
        hh = (hh + 1) & mask;
      }
    }
  }
  const px = new Float64Array(n), py = new Float64Array(n), pz = new Float64Array(n), w = new Float64Array(n);
  const cnt = new Float64Array(n);
  for (let i = 0; i < V; i++) {
    const k = nodeOf[i];
    const a = area[i] + 1e-12;
    px[k] += pos[3 * i] * a;
    py[k] += pos[3 * i + 1] * a;
    pz[k] += pos[3 * i + 2] * a;
    w[k] += a;
    cnt[k]++;
  }
  for (let k = 0; k < n; k++) {
    px[k] /= w[k];
    py[k] /= w[k];
    pz[k] /= w[k];
  }
  const deg = new Int32Array(n + 1);
  for (let f = 0; f < tri.length; f += 3) {
    for (let e = 0; e < 3; e++) {
      const a = nodeOf[tri[f + e]];
      const b = nodeOf[tri[f + ((e + 1) % 3)]];
      if (a !== b) {
        deg[a]++;
        deg[b]++;
      }
    }
  }
  const off = new Int32Array(n + 1);
  for (let k = 0; k < n; k++) off[k + 1] = off[k] + deg[k];
  const fill = off.slice(0, n);
  const adj = new Int32Array(off[n]);
  const len = new Float32Array(off[n]);
  for (let f = 0; f < tri.length; f += 3) {
    for (let e = 0; e < 3; e++) {
      const a = nodeOf[tri[f + e]];
      const b = nodeOf[tri[f + ((e + 1) % 3)]];
      if (a === b) continue;
      const d = Math.hypot(px[a] - px[b], py[a] - py[b], pz[a] - pz[b]);
      adj[fill[a]] = b;
      len[fill[a]++] = d;
      adj[fill[b]] = a;
      len[fill[b]++] = d;
    }
  }
  return { g: { n, px, py, pz, w, off, adj, len } as Graph, nodeOf };
}

function components(g: Graph) {
  const comp = new Int32Array(g.n).fill(-1);
  const weights: number[] = [];
  const queue = new Int32Array(g.n);
  let c = 0;
  for (let s = 0; s < g.n; s++) {
    if (comp[s] !== -1) continue;
    let head = 0, tail = 0, wsum = 0;
    queue[tail++] = s;
    comp[s] = c;
    while (head < tail) {
      const u = queue[head++];
      wsum += g.w[u];
      for (let e = g.off[u]; e < g.off[u + 1]; e++) {
        const v = g.adj[e];
        if (comp[v] === -1) {
          comp[v] = c;
          queue[tail++] = v;
        }
      }
    }
    weights.push(wsum);
    c++;
  }
  let main = 0;
  for (let i = 1; i < weights.length; i++) if (weights[i] > weights[main]) main = i;
  const total = weights.reduce((a, b) => a + b, 0) || 1;
  return { comp, count: c, main, share: weights[main] / total };
}

function dijkstra(g: Graph, sources: ArrayLike<number>, dist: Float64Array) {
  dist.fill(Infinity);
  const cap = g.adj.length + sources.length + 8;
  const hk = new Float64Array(cap);
  const hv = new Int32Array(cap);
  let size = 0;
  const push = (k: number, v: number) => {
    let i = size++;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (hk[p] <= k) break;
      hk[i] = hk[p];
      hv[i] = hv[p];
      i = p;
    }
    hk[i] = k;
    hv[i] = v;
  };
  for (let i = 0; i < sources.length; i++) {
    dist[sources[i]] = 0;
    push(0, sources[i]);
  }
  while (size > 0) {
    const d = hk[0];
    const u = hv[0];
    size--;
    if (size > 0) {
      const k = hk[size];
      const v = hv[size];
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= size) break;
        if (c + 1 < size && hk[c + 1] < hk[c]) c++;
        if (hk[c] >= k) break;
        hk[i] = hk[c];
        hv[i] = hv[c];
        i = c;
      }
      hk[i] = k;
      hv[i] = v;
    }
    if (d > dist[u]) continue;
    for (let e = g.off[u]; e < g.off[u + 1]; e++) {
      const v = g.adj[e];
      const nd = d + g.len[e];
      if (nd < dist[v]) {
        dist[v] = nd;
        push(nd, v);
      }
    }
  }
}

// ── Polyline helpers ────────────────────────────────────────────────────────

interface Poly {
  x: Float64Array;
  y: Float64Array;
  z: Float64Array;
  cum: Float64Array;
  length: number;
}

function makePoly(pts: number[][]): Poly {
  const n = pts.length;
  const x = new Float64Array(n), y = new Float64Array(n), z = new Float64Array(n), cum = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    x[i] = pts[i][0];
    y[i] = pts[i][1];
    z[i] = pts[i][2];
    if (i > 0) cum[i] = cum[i - 1] + Math.hypot(x[i] - x[i - 1], y[i] - y[i - 1], z[i] - z[i - 1]);
  }
  return { x, y, z, cum, length: cum[n - 1] };
}

/** Point on the polyline at arc length s (linear extrapolation past the ends). */
function polyAt(p: Poly, s: number): [number, number, number] {
  const n = p.x.length;
  let j: number;
  if (s <= 0) j = 0;
  else if (s >= p.length) j = n - 2;
  else {
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (p.cum[mid] <= s) lo = mid;
      else hi = mid;
    }
    j = lo;
  }
  const segLen = p.cum[j + 1] - p.cum[j] || 1e-12;
  const u = (s - p.cum[j]) / segLen;
  return [p.x[j] + (p.x[j + 1] - p.x[j]) * u, p.y[j] + (p.y[j + 1] - p.y[j]) * u, p.z[j] + (p.z[j + 1] - p.z[j]) * u];
}

function smoothPoints(pts: number[][], iterations: number): number[][] {
  let cur = pts.map((p) => [...p]);
  for (let it = 0; it < iterations; it++) {
    const next = cur.map((p) => [...p]);
    for (let i = 1; i < cur.length - 1; i++) {
      for (let d = 0; d < 3; d++) next[i][d] = 0.25 * cur[i - 1][d] + 0.5 * cur[i][d] + 0.25 * cur[i + 1][d];
    }
    cur = next;
  }
  return cur;
}

// ── Main ────────────────────────────────────────────────────────────────────

interface CenterlineFit {
  poly: Poly;
  /** Per graph node: estimated arc length on poly (NaN when unknown). */
  nodeS: Float64Array;
}

function binCentroids(g: Graph, f: Float64Array, mask: Uint8Array, K: number) {
  const sx = new Float64Array(K), sy = new Float64Array(K), sz = new Float64Array(K), sw = new Float64Array(K), sf = new Float64Array(K);
  for (let i = 0; i < g.n; i++) {
    if (!mask[i]) continue;
    const fi = f[i];
    if (!Number.isFinite(fi)) continue;
    const k = Math.min(K - 1, Math.max(0, Math.floor(fi * K)));
    const w = g.w[i];
    sx[k] += g.px[i] * w;
    sy[k] += g.py[i] * w;
    sz[k] += g.pz[i] * w;
    sf[k] += fi * w;
    sw[k] += w;
  }
  const pts: number[][] = [];
  const fs: number[] = [];
  for (let k = 0; k < K; k++) {
    if (sw[k] <= 0) continue;
    pts.push([sx[k] / sw[k], sy[k] / sw[k], sz[k] / sw[k]]);
    fs.push(sf[k] / sw[k]);
  }
  return { pts, fs };
}

function fitCurved(g: Graph, comp: Int32Array, main: number, progress: Progress): CenterlineFit | null {
  const n = g.n;
  const mask = new Uint8Array(n);
  let start = -1;
  for (let i = 0; i < n; i++) {
    if (comp[i] === main) {
      mask[i] = 1;
      if (start === -1) start = i;
    }
  }
  if (start === -1) return null;
  const argmax = (d: Float64Array) => {
    let best = -1, bv = -1;
    for (let i = 0; i < n; i++) if (mask[i] && Number.isFinite(d[i]) && d[i] > bv) {
      bv = d[i];
      best = i;
    }
    return best;
  };
  const d = new Float64Array(n);
  dijkstra(g, [start], d);
  const A = argmax(d);
  progress('Finding the vessel ends', 0.3);
  const dA = new Float64Array(n);
  dijkstra(g, [A], dA);
  const B = argmax(dA);
  if (B < 0 || !(dA[B] > 0)) return null;
  const dB = new Float64Array(n);
  dijkstra(g, [B], dB);
  progress('Tracing the centerline', 0.45);

  // Pass 1: rough centerline from geodesic level sets between the two ends.
  const f1 = new Float64Array(n);
  for (let i = 0; i < n; i++) f1[i] = mask[i] ? dA[i] / (dA[i] + dB[i] || 1) : NaN;
  const c1 = binCentroids(g, f1, mask, 40);
  if (c1.pts.length < 4) return null;
  const p1 = makePoly(smoothPoints(c1.pts, 2));
  // Radius estimate from the middle of the vessel.
  let rSum = 0, rW = 0;
  for (let i = 0; i < n; i++) {
    if (!mask[i] || f1[i] < 0.3 || f1[i] > 0.7) continue;
    const k = Math.min(c1.pts.length - 1, Math.max(0, Math.round(f1[i] * (c1.pts.length - 1))));
    const c = c1.pts[k];
    rSum += Math.hypot(g.px[i] - c[0], g.py[i] - c[1], g.pz[i] - c[2]) * g.w[i];
    rW += g.w[i];
  }
  const rEst = rW > 0 ? rSum / rW : p1.length / 20;

  // End regions: the rim/cap at each end. The end tangent is measured a few radii
  // into the vessel, where geodesic rings are no longer skewed by the start point.
  const nrm = (v: number[]) => {
    const l = Math.hypot(v[0], v[1], v[2]) || 1;
    return [v[0] / l, v[1] / l, v[2] / l];
  };
  const K2 = Math.max(24, Math.min(140, Math.round(p1.length / Math.max(1e-9, 0.6 * rEst))));
  let poly = p1;
  let f = f1;
  let c2 = c1;
  const d0 = new Float64Array(n);
  const d1 = new Float64Array(n);
  const s0 = new Float64Array(n);
  const s1 = new Float64Array(n);
  for (let pass = 0; pass < 2; pass++) {
    const L = poly.length;
    const sa = Math.min(0.2 * L, 2.5 * rEst);
    const sb = Math.min(0.35 * L, 5 * rEst);
    const a0 = polyAt(poly, sa), b0 = polyAt(poly, sb);
    const a1 = polyAt(poly, L - sa), b1 = polyAt(poly, L - sb);
    const t0 = nrm([b0[0] - a0[0], b0[1] - a0[1], b0[2] - a0[2]]);
    const t1 = nrm([a1[0] - b1[0], a1[1] - b1[1], a1[2] - b1[2]]);
    const delta = Math.max(0.01 * L, 0.3 * rEst);
    let minS = Infinity, maxS = -Infinity;
    for (let i = 0; i < n; i++) {
      if (!mask[i]) continue;
      if (f[i] < 0.25) {
        s0[i] = (g.px[i] - a0[0]) * t0[0] + (g.py[i] - a0[1]) * t0[1] + (g.pz[i] - a0[2]) * t0[2];
        if (s0[i] < minS) minS = s0[i];
      }
      if (f[i] > 0.75) {
        s1[i] = (g.px[i] - a1[0]) * t1[0] + (g.py[i] - a1[1]) * t1[1] + (g.pz[i] - a1[2]) * t1[2];
        if (s1[i] > maxS) maxS = s1[i];
      }
    }
    const prox: number[] = [];
    const dist: number[] = [];
    for (let i = 0; i < n; i++) {
      if (!mask[i]) continue;
      if (f[i] < 0.25 && s0[i] <= minS + delta) prox.push(i);
      if (f[i] > 0.75 && s1[i] >= maxS - delta) dist.push(i);
    }
    dijkstra(g, prox.length ? prox : [A], d0);
    progress('Tracing the centerline', 0.5 + pass * 0.12);
    dijkstra(g, dist.length ? dist : [B], d1);
    const fNext = new Float64Array(n);
    for (let i = 0; i < n; i++) fNext[i] = mask[i] ? d0[i] / (d0[i] + d1[i] || 1) : NaN;
    f = fNext;
    // Refined centerline from rings of equal f.
    c2 = binCentroids(g, f, mask, K2);
    if (c2.pts.length < 4) return null;
    poly = makePoly(smoothPoints(c2.pts, 4));
  }
  const f2 = f;
  // Map f → arc length along the polyline.
  const fs = c2.fs;
  const nodeS = new Float64Array(n).fill(NaN);
  for (let i = 0; i < n; i++) {
    if (!mask[i]) continue;
    const fi = f2[i];
    let lo = 0, hi = fs.length - 1;
    if (fi <= fs[0]) nodeS[i] = poly.cum[0] - (fs[0] - fi) * poly.length;
    else if (fi >= fs[hi]) nodeS[i] = poly.cum[hi] + (fi - fs[hi]) * poly.length;
    else {
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (fs[mid] <= fi) lo = mid;
        else hi = mid;
      }
      const u = (fi - fs[lo]) / (fs[hi] - fs[lo] || 1);
      nodeS[i] = poly.cum[lo] + u * (poly.cum[hi] - poly.cum[lo]);
    }
  }
  return { poly, nodeS };
}

function principalAxis(pos: Float32Array, area: Float64Array, V: number, keep: (v: number) => boolean) {
  let cx = 0, cy = 0, cz = 0, W = 0;
  for (let v = 0; v < V; v++) {
    if (!keep(v)) continue;
    const w = area[v] + 1e-12;
    cx += pos[3 * v] * w;
    cy += pos[3 * v + 1] * w;
    cz += pos[3 * v + 2] * w;
    W += w;
  }
  cx /= W;
  cy /= W;
  cz /= W;
  let xx = 0, xy = 0, xz = 0, yy = 0, yz = 0, zz = 0;
  for (let v = 0; v < V; v++) {
    if (!keep(v)) continue;
    const w = area[v] + 1e-12;
    const x = pos[3 * v] - cx, y = pos[3 * v + 1] - cy, z = pos[3 * v + 2] - cz;
    xx += w * x * x;
    xy += w * x * y;
    xz += w * x * z;
    yy += w * y * y;
    yz += w * y * z;
    zz += w * z * z;
  }
  let e = [1, 0.7, 0.3];
  for (let it = 0; it < 200; it++) {
    const nx = xx * e[0] + xy * e[1] + xz * e[2];
    const ny = xy * e[0] + yy * e[1] + yz * e[2];
    const nz = xz * e[0] + yz * e[1] + zz * e[2];
    const l = Math.hypot(nx, ny, nz) || 1;
    e = [nx / l, ny / l, nz / l];
  }
  return { c: [cx, cy, cz], e };
}

export function processGeometry(input: ProcessInput, progress: Progress = () => {}): ProcessResult {
  const timings: Record<string, number> = {};
  let t = now();
  const mark = (name: string) => {
    const t2 = now();
    timings[name] = Math.round(t2 - t);
    t = t2;
  };
  const warnings: string[] = [];
  progress('Preparing the mesh', 0.05);
  const { pos, tri, count: V } = weld(input.positions, input.index);
  if (V < 8 || tri.length < 9) throw new Error("The model doesn't contain a surface that can be analysed.");
  mark('weld');
  const { area, total } = vertexAreas(pos, tri, V);
  const { g, nodeOf } = buildGraph(pos, tri, V, area, total);
  const cc = components(g);
  mark('graph');
  if (cc.share < 0.9 && cc.count > 1) {
    warnings.push(
      `The model has ${cc.count} separate pieces. The largest piece (${Math.round(cc.share * 100)}% of the surface) was used to find the centerline.`,
    );
  }
  const inMainVertex = (v: number) => cc.comp[nodeOf[v]] === cc.main;

  // Per-vertex results
  const sArr = new Float64Array(V);
  const radial = new Float32Array(V * 3);
  const dist = new Float32Array(V);
  let method: 'curved' | 'straight' = input.mode === 'straight' ? 'straight' : 'curved';
  let fit: CenterlineFit | null = null;
  if (method === 'curved') {
    fit = fitCurved(g, cc.comp, cc.main, progress);
    if (!fit) {
      method = 'straight';
      warnings.push("A curved centerline couldn't be traced, so a straight axis was used instead.");
    }
  }
  mark('centerline');
  progress('Measuring every point along the vessel', 0.75);

  const pca = principalAxis(pos, area, V, inMainVertex);
  // Quality of a fit: share of the surface at a consistent distance from the centerline.
  const quality = (sampleOf: Int32Array, d: Float32Array) => {
    const M = CENTERLINE_SAMPLES;
    const sum = new Float64Array(M), w = new Float64Array(M);
    for (let v = 0; v < V; v++) {
      if (!inMainVertex(v)) continue;
      sum[sampleOf[v]] += d[v] * area[v];
      w[sampleOf[v]] += area[v];
    }
    let good = 0, all = 0;
    for (let v = 0; v < V; v++) {
      if (!inMainVertex(v)) continue;
      const k = sampleOf[v];
      const mean = w[k] > 0 ? sum[k] / w[k] : 0;
      all += area[v];
      if (mean > 0 && Math.abs(d[v] - mean) < 0.4 * mean) good += area[v];
    }
    return all > 0 ? good / all : 0;
  };

  let poly: Poly;
  if (method === 'curved' && fit) {
    poly = fit.poly;
    const P = poly;
    const segs = P.x.length - 1;
    const W = segs <= 30 ? segs : 14;
    for (let v = 0; v < V; v++) {
      const x = pos[3 * v], y = pos[3 * v + 1], z = pos[3 * v + 2];
      const ns = fit.nodeS[nodeOf[v]];
      let j0 = 0, j1 = segs - 1;
      if (Number.isFinite(ns)) {
        let lo = 0, hi = segs;
        const sc = Math.max(0, Math.min(P.length, ns));
        while (hi - lo > 1) {
          const mid = (lo + hi) >> 1;
          if (P.cum[mid] <= sc) lo = mid;
          else hi = mid;
        }
        j0 = Math.max(0, lo - W);
        j1 = Math.min(segs - 1, lo + W);
      }
      let best = Infinity, bs = 0, bfx = 0, bfy = 0, bfz = 0, btx = 1, bty = 0, btz = 0;
      for (let j = j0; j <= j1; j++) {
        const ax = P.x[j], ay = P.y[j], az = P.z[j];
        const dx = P.x[j + 1] - ax, dy = P.y[j + 1] - ay, dz = P.z[j + 1] - az;
        const l2 = dx * dx + dy * dy + dz * dz || 1e-24;
        let u = ((x - ax) * dx + (y - ay) * dy + (z - az) * dz) / l2;
        if (j > 0 && u < 0) u = 0;
        if (j < segs - 1 && u > 1) u = 1;
        const fx = ax + u * dx, fy = ay + u * dy, fz = az + u * dz;
        const dd = (x - fx) * (x - fx) + (y - fy) * (y - fy) + (z - fz) * (z - fz);
        if (dd < best) {
          best = dd;
          const l = Math.sqrt(l2);
          bs = P.cum[j] + u * l;
          bfx = fx;
          bfy = fy;
          bfz = fz;
          btx = dx / l;
          bty = dy / l;
          btz = dz / l;
        }
      }
      sArr[v] = bs;
      let rx = x - bfx, ry = y - bfy, rz = z - bfz;
      const along = rx * btx + ry * bty + rz * btz;
      rx -= along * btx;
      ry -= along * bty;
      rz -= along * btz;
      const rl = Math.hypot(rx, ry, rz);
      dist[v] = Math.sqrt(best);
      if (rl > 1e-12) {
        radial[3 * v] = rx / rl;
        radial[3 * v + 1] = ry / rl;
        radial[3 * v + 2] = rz / rl;
      }
    }
  } else {
    const { c, e } = pca;
    for (let v = 0; v < V; v++) {
      const x = pos[3 * v] - c[0], y = pos[3 * v + 1] - c[1], z = pos[3 * v + 2] - c[2];
      const s = x * e[0] + y * e[1] + z * e[2];
      sArr[v] = s;
      const rx = x - s * e[0], ry = y - s * e[1], rz = z - s * e[2];
      const rl = Math.hypot(rx, ry, rz);
      dist[v] = rl;
      if (rl > 1e-12) {
        radial[3 * v] = rx / rl;
        radial[3 * v + 1] = ry / rl;
        radial[3 * v + 2] = rz / rl;
      }
    }
    poly = makePoly([
      [c[0] - e[0], c[1] - e[1], c[2] - e[2]],
      [c[0] + e[0], c[1] + e[1], c[2] + e[2]],
    ]);
    // Arc length on this 2-point poly starts at -1 → shift s accordingly.
    for (let v = 0; v < V; v++) sArr[v] += 1;
  }
  mark('project');

  // Extent of the vessel along the centerline.
  let sMin = Infinity, sMax = -Infinity;
  for (let v = 0; v < V; v++) {
    if (!inMainVertex(v)) continue;
    if (sArr[v] < sMin) sMin = sArr[v];
    if (sArr[v] > sMax) sMax = sArr[v];
  }
  const L = sMax - sMin || 1;
  const M = CENTERLINE_SAMPLES;
  const centerline = new Float32Array(M * 3);
  for (let k = 0; k < M; k++) {
    const p = polyAt(poly, sMin + (L * k) / (M - 1));
    centerline[3 * k] = p[0];
    centerline[3 * k + 1] = p[1];
    centerline[3 * k + 2] = p[2];
  }
  const aT = new Float32Array(V);
  const sampleOf = new Int32Array(V);
  for (let v = 0; v < V; v++) {
    const a = Math.max(0, Math.min(1, (sArr[v] - sMin) / L));
    aT[v] = a;
    sampleOf[v] = Math.round(a * (M - 1));
  }

  // Orientation: put aT = 0 at the left end (smaller X), then Z, then Y.
  const first = [centerline[0], centerline[1], centerline[2]];
  const last = [centerline[3 * (M - 1)], centerline[3 * (M - 1) + 1], centerline[3 * (M - 1) + 2]];
  const dxe = last[0] - first[0], dze = last[2] - first[2], dye = last[1] - first[1];
  const thresh = 0.05 * L;
  const reverse = Math.abs(dxe) > thresh ? dxe < 0 : Math.abs(dze) > thresh ? dze < 0 : dye < 0;
  if (reverse) {
    for (let v = 0; v < V; v++) {
      aT[v] = 1 - aT[v];
      sampleOf[v] = M - 1 - sampleOf[v];
    }
    for (let k = 0; k < M / 2; k++) {
      const o = M - 1 - k;
      for (let d = 0; d < 3; d++) {
        const tmp = centerline[3 * k + d];
        centerline[3 * k + d] = centerline[3 * o + d];
        centerline[3 * o + d] = tmp;
      }
    }
  }

  // Tangents (central differences)
  const tangents = new Float32Array(M * 3);
  for (let k = 0; k < M; k++) {
    const a = Math.max(0, k - 2), b = Math.min(M - 1, k + 2);
    let tx = centerline[3 * b] - centerline[3 * a];
    let ty = centerline[3 * b + 1] - centerline[3 * a + 1];
    let tz = centerline[3 * b + 2] - centerline[3 * a + 2];
    const l = Math.hypot(tx, ty, tz) || 1;
    tx /= l;
    ty /= l;
    tz /= l;
    tangents[3 * k] = tx;
    tangents[3 * k + 1] = ty;
    tangents[3 * k + 2] = tz;
  }

  // Radius profile
  const radiusMax = new Float32Array(M);
  const radiusMean = new Float32Array(M);
  const rw = new Float64Array(M);
  for (let v = 0; v < V; v++) {
    if (!inMainVertex(v)) continue;
    const k = sampleOf[v];
    if (dist[v] > radiusMax[k]) radiusMax[k] = dist[v];
    radiusMean[k] += dist[v] * area[v];
    rw[k] += area[v];
  }
  let lastGood = -1;
  for (let k = 0; k < M; k++) {
    if (rw[k] > 0) {
      radiusMean[k] /= rw[k];
      if (lastGood >= 0 && k - lastGood > 1) {
        for (let j = lastGood + 1; j < k; j++) {
          const f = (j - lastGood) / (k - lastGood);
          radiusMean[j] = radiusMean[lastGood] + f * (radiusMean[k] - radiusMean[lastGood]);
          radiusMax[j] = radiusMax[lastGood] + f * (radiusMax[k] - radiusMax[lastGood]);
        }
      }
      lastGood = k;
    }
  }
  for (let k = 0; k < M; k++) if (rw[k] === 0 && lastGood >= 0) {
    if (k > lastGood) {
      radiusMean[k] = radiusMean[lastGood];
      radiusMax[k] = radiusMax[lastGood];
    }
  }
  const firstGood = rw.findIndex((x) => x > 0);
  for (let k = 0; k < firstGood; k++) {
    radiusMean[k] = radiusMean[firstGood];
    radiusMax[k] = radiusMax[firstGood];
  }

  let q = quality(sampleOf, dist);
  if (method === 'curved' && q < 0.55) {
    // Compare with a straight axis; keep the better fit.
    const sampleS = new Int32Array(V);
    const distS = new Float32Array(V);
    const { c, e } = pca;
    let lo = Infinity, hi = -Infinity;
    const sS = new Float64Array(V);
    for (let v = 0; v < V; v++) {
      const x = pos[3 * v] - c[0], y = pos[3 * v + 1] - c[1], z = pos[3 * v + 2] - c[2];
      const s = x * e[0] + y * e[1] + z * e[2];
      sS[v] = s;
      distS[v] = Math.hypot(x - s * e[0], y - s * e[1], z - s * e[2]);
      if (inMainVertex(v)) {
        lo = Math.min(lo, s);
        hi = Math.max(hi, s);
      }
    }
    for (let v = 0; v < V; v++) sampleS[v] = Math.round(Math.max(0, Math.min(1, (sS[v] - lo) / (hi - lo || 1))) * (M - 1));
    const qs = quality(sampleS, distS);
    if (qs > q + 0.1) {
      warnings.push('This model looks closer to a straight tube, so consider switching the centerline to "Straight".');
    }
  }
  if (q < 0.45) {
    warnings.push(
      "The surface doesn't follow a single tube very closely. Check the section boundaries, and try the straight axis or trimming the ends if they look wrong.",
    );
  }
  mark('finish');
  progress('Done', 1);
  q = Math.max(0, Math.min(1, q));
  return {
    positions: pos,
    index: tri,
    aT,
    radial,
    dist,
    centerline,
    tangents,
    radiusMax,
    radiusMean,
    length: L,
    method,
    quality: q,
    warnings,
    components: cc.count,
    mainShare: cc.share,
    vertexCount: V,
    triangleCount: tri.length / 3,
    timings,
  };
}
