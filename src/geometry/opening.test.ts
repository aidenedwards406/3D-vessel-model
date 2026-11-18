import { describe, expect, it } from 'vitest';
import { computeFrames, vertexAngles } from './frames';
import { computeSpine, hingeAt, openAngle, openPoint, openPositions, openVector, preferredHingeSide, smoothProfile, type HingeSide } from './opening';
import { DEFAULT_SECTIONS, resolveLayout, topness } from '../lib/regions';

const M = 256;
const R = 3;

/** Straight vessel along +X with "up" = +Y, so top = +Y and the halves meet at ±Z. */
function straight(side: HingeSide = -1, gap = 0, phi = 0) {
  const centerline = new Float32Array(M * 3);
  const tangents = new Float32Array(M * 3);
  for (let k = 0; k < M; k++) {
    centerline[3 * k] = (100 * k) / (M - 1);
    tangents[3 * k] = 1;
  }
  const frames = computeFrames(tangents, [0, 1, 0]);
  const spine = computeSpine({ centerline, tangents, frames, radius: new Float32Array(M).fill(R), phi, side, gap });
  return { centerline, tangents, frames, spine };
}

/** Quarter circle of radius 40 in the XZ plane (a bend), "up" = +Y. */
function bend(side: HingeSide = -1) {
  const centerline = new Float32Array(M * 3);
  const tangents = new Float32Array(M * 3);
  for (let k = 0; k < M; k++) {
    const a = (k / (M - 1)) * (Math.PI / 2);
    centerline[3 * k] = 40 * Math.sin(a);
    centerline[3 * k + 2] = 40 - 40 * Math.cos(a);
    tangents[3 * k] = Math.cos(a);
    tangents[3 * k + 2] = Math.sin(a);
  }
  const frames = computeFrames(tangents, [0, 1, 0]);
  const spine = computeSpine({ centerline, tangents, frames, radius: new Float32Array(M).fill(R), phi: 0, side });
  return { centerline, tangents, frames, spine };
}

function open(spine: ReturnType<typeof straight>['spine'], aT: number, angle: number, p: number[]) {
  const out = [0, 0, 0];
  openPoint(spine, aT, angle, p[0], p[1], p[2], out);
  return out;
}

function close(a: number[], b: number[], eps = 1e-4) {
  for (let i = 0; i < 3; i++) expect(a[i]).toBeCloseTo(b[i], -Math.log10(eps));
}

describe('opening the vessel like a book', () => {
  it('leaves the vessel unchanged when closed', () => {
    const { spine } = straight();
    close(open(spine, 0.4, 0, [40, R, 0]), [40, R, 0]);
    close(open(spine, 0.4, openAngle(0, -1), [40, 1, 2]), [40, 1, 2]);
  });

  it('turns the top half about a fixed hinge on the far side', () => {
    const { spine } = straight(-1);
    // The hinge runs along the back (−Z) where the halves meet, and doesn't move.
    close(hingeAt(spine, 0.5), [50, 0, -R]);
    for (const amount of [0.25, 0.5, 1]) close(open(spine, 0.5, openAngle(amount, -1), [50, 0, -R]), [50, 0, -R]);
    // Half open (90°): the front edge of the top half stands straight above the hinge.
    close(open(spine, 0.5, openAngle(0.5, -1), [50, 0, R]), [50, 2 * R, -R]);
    // Fully open (180°): the top of the vessel now lies behind, below the cut, facing up.
    close(open(spine, 0.5, openAngle(1, -1), [50, R, 0]), [50, -R, -2 * R]);
  });

  it('lays both halves side by side at 180°, with a gap between them', () => {
    const gap = 0.12;
    const { spine } = straight(-1, gap);
    for (let i = 0; i <= 32; i++) {
      // Every point of the top half (angle −90°…90° from top).
      const a = -Math.PI / 2 + (i / 32) * Math.PI;
      const p = open(spine, 0.3, openAngle(1, -1), [30, R * Math.cos(a), R * Math.sin(a)]);
      expect(p[1]).toBeLessThanOrEqual(1e-6); // a trough, opening upwards
      expect(p[2]).toBeLessThanOrEqual(-R * (1 + 2 * gap) + 1e-6); // beside the bottom half (z ≥ −R)
    }
  });

  it('opens towards the other side when the hinge is on the other side', () => {
    const { spine } = straight(1);
    close(hingeAt(spine, 0.5), [50, 0, R]);
    close(open(spine, 0.5, openAngle(1, 1), [50, R, 0]), [50, -R, 2 * R]);
  });

  it('turns normals with the surface, so the inside faces up when open', () => {
    const { spine } = straight(-1);
    const n = [0, 0, 0];
    openVector(spine, 0.5, openAngle(1, -1), 0, 1, 0, n);
    close(n, [0, -1, 0]);
    // Half open, the top half stands at the back: its outside faces away, its inside faces the front.
    openVector(spine, 0.5, openAngle(0.5, -1), 0, 1, 0, n);
    close(n, [0, 0, -1]);
  });

  it('keeps each slice rigid and the hinge fixed on a curved vessel', () => {
    const { centerline, frames, spine } = bend(-1);
    for (const aT of [0, 0.2, 0.5, 0.77, 1]) {
      const k = Math.round(aT * (M - 1));
      const c = [centerline[3 * k], centerline[3 * k + 1], centerline[3 * k + 2]];
      const up = [frames.up[3 * k], frames.up[3 * k + 1], frames.up[3 * k + 2]];
      const bin = [frames.bin[3 * k], frames.bin[3 * k + 1], frames.bin[3 * k + 2]];
      const pts = [0.3, 0.9, 1.6, 2.4].map((a) => c.map((x, d) => x + R * (Math.cos(a) * up[d] + Math.sin(a) * bin[d])));
      const h = hingeAt(spine, aT);
      for (const amount of [0.3, 0.7, 1]) {
        const moved = pts.map((p) => open(spine, aT, openAngle(amount, -1), p));
        close(open(spine, aT, openAngle(amount, -1), h), h);
        for (let i = 0; i < pts.length; i++) {
          for (let j = i + 1; j < pts.length; j++) {
            expect(Math.hypot(...moved[i].map((x, d) => x - moved[j][d]))).toBeCloseTo(Math.hypot(...pts[i].map((x, d) => x - pts[j][d])), 4);
          }
          expect(Math.hypot(...moved[i].map((x, d) => x - h[d]))).toBeCloseTo(Math.hypot(...pts[i].map((x, d) => x - h[d])), 4);
        }
      }
    }
  });

  it('cuts exactly where the heat map divides top from bottom', () => {
    for (const flip of [false, true]) {
      for (const deg of [0, 30, -75, 180]) {
        const layout = resolveLayout({ ...DEFAULT_SECTIONS, flip, topOffsetDeg: deg });
        const phi = flip ? -layout.topOffset : layout.topOffset;
        const { frames, spine } = straight(-1, 0, phi);
        const k = 100;
        const e1 = [spine.side[3 * k], spine.side[3 * k + 1], spine.side[3 * k + 2]];
        const t = [spine.axis[3 * k], spine.axis[3 * k + 1], spine.axis[3 * k + 2]];
        const e2 = [e1[1] * t[2] - e1[2] * t[1], e1[2] * t[0] - e1[0] * t[2], e1[0] * t[1] - e1[1] * t[0]];
        const aT = new Float32Array(3).fill(k / (M - 1));
        const radial = new Float32Array([...e1, ...e1.map((x) => -x), ...e2]);
        const ang = vertexAngles(aT, radial, frames);
        // Where the halves meet (both sides) has zero "topness"; the opening lifts the true top.
        expect(Math.abs(topness(ang[0], ang[1], layout))).toBeLessThan(1e-5);
        expect(Math.abs(topness(ang[2], ang[3], layout))).toBeLessThan(1e-5);
        expect(topness(ang[4], ang[5], layout)).toBeCloseTo(1, 5);
      }
    }
  });

  it('moves many points at once exactly like one at a time', () => {
    const { spine } = bend(1);
    const n = 200;
    const aT = new Float32Array(n);
    const src = new Float32Array(3 * n);
    for (let i = 0; i < n; i++) {
      aT[i] = i / (n - 1);
      src[3 * i] = 40 * Math.sin(i * 0.37);
      src[3 * i + 1] = 3 * Math.cos(i * 1.3);
      src[3 * i + 2] = 20 * Math.cos(i * 0.11);
    }
    const dst = new Float32Array(3 * n);
    const angle = openAngle(0.63, 1);
    openPositions(spine, aT, angle, src, dst);
    const one = [0, 0, 0];
    for (let i = 0; i < n; i++) {
      openPoint(spine, aT[i], angle, src[3 * i], src[3 * i + 1], src[3 * i + 2], one);
      close([dst[3 * i], dst[3 * i + 1], dst[3 * i + 2]], one, 1e-3);
    }
  });

  it('opens away from the camera', () => {
    const { spine } = straight(-1);
    expect(preferredHingeSide(spine, [0.3, 0.6, 0.8])).toBe(-1); // camera in front: hinge at the back
    expect(preferredHingeSide(spine, [0.3, 0.6, -0.8])).toBe(1); // camera behind: hinge at the front
    expect(preferredHingeSide(spine, [0, 1, 0.0008])).toBe(-1); // straight down: the default
  });

  it('smooths the radius profile without shrinking it', () => {
    const flat = smoothProfile(new Float32Array(50).fill(2.5));
    expect(Math.max(...flat)).toBeCloseTo(2.5, 6);
    expect(Math.min(...flat)).toBeCloseTo(2.5, 6);
    const spike = new Float32Array(50).fill(2);
    spike[25] = 20;
    expect(smoothProfile(spike)[25]).toBeLessThan(4);
  });
});
