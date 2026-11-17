import { describe, expect, it } from 'vitest';
import { computeFrames, vertexAngles } from './frames';
import { processGeometry } from './process';
import { demoVesselCurve, makeDemoVessel, makeTube, type Vec3 } from './tube';
import { locateRegion, resolveLayout, DEFAULT_SECTIONS } from '../lib/regions';

/** Max |aT − true t| over vertices, allowing either orientation. */
function tError(aT: Float32Array, trueT: Float32Array, positionsIn: Float32Array, positionsOut: Float32Array) {
  // processGeometry welds vertices, so map output vertices back to input by position.
  const key = (p: Float32Array, i: number) => `${p[3 * i].toFixed(4)},${p[3 * i + 1].toFixed(4)},${p[3 * i + 2].toFixed(4)}`;
  const truth = new Map<string, number>();
  for (let i = 0; i < trueT.length; i++) truth.set(key(positionsIn, i), trueT[i]);
  let e1 = 0;
  let e2 = 0;
  let sum1 = 0;
  for (let v = 0; v < aT.length; v++) {
    const t = truth.get(key(positionsOut, v));
    if (t === undefined) continue;
    e1 = Math.max(e1, Math.abs(aT[v] - t));
    e2 = Math.max(e2, Math.abs(aT[v] - (1 - t)));
    sum1 += Math.abs(aT[v] - t);
  }
  return { max: Math.min(e1, e2), forward: e1 <= e2, mean: sum1 / aT.length };
}

function run(curve: (t: number) => Vec3, opts: Partial<Parameters<typeof makeTube>[0]> = {}, mode: 'auto' | 'straight' = 'auto') {
  const tube = makeTube({ curve, ...opts });
  const res = processGeometry({ positions: tube.positions, index: tube.index, mode });
  return { tube, res, err: tError(res.aT, tube.trueT, tube.positions, res.positions) };
}

describe('centerline and sectioning', () => {
  it('straight tube (both methods)', () => {
    const curve = (t: number): Vec3 => [-50 + 100 * t, 0, 0];
    for (const mode of ['auto', 'straight'] as const) {
      const { res, err } = run(curve, {}, mode);
      expect(err.max).toBeLessThan(0.01);
      expect(err.forward).toBe(true); // proximal (aT = 0) is on the left
      expect(res.length).toBeGreaterThan(99);
      expect(res.length).toBeLessThan(101);
      expect(res.quality).toBeGreaterThan(0.9);
    }
  });

  it('S-shaped tortuous demo vessel', () => {
    const tube = makeDemoVessel();
    const res = processGeometry({ positions: tube.positions, index: tube.index, mode: 'auto' });
    const err = tError(res.aT, tube.trueT, tube.positions, res.positions);
    expect(res.method).toBe('curved');
    expect(err.max).toBeLessThan(0.025);
    expect(Math.abs(res.length - tube.length) / tube.length).toBeLessThan(0.03);

    // Top/bottom: with up = +Y, a vertex above the centerline must be "top".
    const frames = computeFrames(res.tangents, [0, 1, 0]);
    const ang = vertexAngles(res.aT, res.radial, frames);
    let agree = 0;
    let total = 0;
    for (let v = 0; v < res.aT.length; v++) {
      const k = Math.round(res.aT[v] * 255);
      const dy = res.positions[3 * v + 1] - res.centerline[3 * k + 1];
      if (Math.abs(dy) < 1) continue;
      total++;
      if (Math.sign(dy) === Math.sign(ang[2 * v])) agree++;
    }
    expect(agree / total).toBeGreaterThan(0.98);

    // Four equal sections should hold roughly equal shares of the (uniformly meshed) surface.
    const layout = resolveLayout(DEFAULT_SECTIONS, []);
    const counts = [0, 0, 0, 0];
    for (let v = 0; v < res.aT.length; v++) {
      const r = locateRegion(res.aT[v], ang[2 * v], ang[2 * v + 1], layout);
      if (r) counts[r.section - 1]++;
    }
    const total4 = counts.reduce((a, b) => a + b, 0);
    for (const c of counts) expect(Math.abs(c / total4 - 0.25)).toBeLessThan(0.02);
  });

  it('helical vessel with 3D tortuosity', () => {
    const helix = (t: number): Vec3 => {
      const a = t * Math.PI * 4;
      return [25 * Math.cos(a), 30 * t, 25 * Math.sin(a)];
    };
    const { res, err } = run(helix, { rings: 320, radial: 32, outerRadius: 2.5, innerRadius: 1.9 });
    expect(res.method).toBe('curved');
    expect(err.max).toBeLessThan(0.03);
  });

  it('capped tube and noisy scan with a stray fragment', () => {
    const curve = (t: number): Vec3 => [80 * t, 10 * Math.sin(Math.PI * t), 0];
    const capped = run(curve, { capped: true, outerRadius: 4 });
    expect(capped.err.max).toBeLessThan(0.03);

    const noisy = makeTube({ curve, outerRadius: 4, innerRadius: 0, capped: true, noise: 0.15, seed: 3 });
    // Add a small separate fragment (scan debris).
    const debris = makeTube({ curve: (t) => [40 + 3 * t, 20, 20], rings: 6, radial: 8, outerRadius: 0.5, capped: true });
    const positions = new Float32Array(noisy.positions.length + debris.positions.length);
    positions.set(noisy.positions);
    positions.set(debris.positions, noisy.positions.length);
    const index = new Uint32Array(noisy.index.length + debris.index.length);
    index.set(noisy.index);
    const off = noisy.positions.length / 3;
    for (let i = 0; i < debris.index.length; i++) index[noisy.index.length + i] = debris.index[i] + off;
    const res = processGeometry({ positions, index, mode: 'auto' });
    expect(res.components).toBe(2);
    const err = tError(res.aT, noisy.trueT, noisy.positions, res.positions);
    expect(err.max).toBeLessThan(0.04);
  });

  it('handles non-indexed triangle soup like a binary STL', () => {
    const tube = makeTube({ curve: demoVesselCurve, rings: 120, radial: 24 });
    const soup = new Float32Array(tube.index.length * 3);
    for (let i = 0; i < tube.index.length; i++) {
      const v = tube.index[i];
      soup.set(tube.positions.subarray(3 * v, 3 * v + 3), 3 * i);
    }
    const res = processGeometry({ positions: soup, index: null, mode: 'auto' });
    expect(res.vertexCount).toBe(tube.positions.length / 3);
    expect(res.triangleCount).toBe(tube.index.length / 3);
  });
});
