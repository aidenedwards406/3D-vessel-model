/**
 * Opening the vessel lengthways, like a book.
 *
 * The vessel is cut along its length where the top and bottom halves meet. The
 * bottom half stays where it is. The top half swings up and over a hinge that
 * runs along one side of the vessel and follows its curve: at every point along
 * the centerline, the top half turns about a line parallel to the vessel's
 * direction there, through the hinge side of the wall. At 180° the two halves
 * lie side by side with their inner (luminal) surfaces facing up, like the pages
 * of an open book.
 *
 * Directions at each centerline sample (raw "top" frame, see frames.ts):
 *   top   e2 = cos φ · up + sin φ · bin     (φ = the top offset, mirrored when flipped)
 *   side  e1 = −sin φ · up + cos φ · bin    (where top meets bottom)
 *   hinge h  = centre + σ · R · (1 + gap) · e1,  σ = ±1 picks the side
 * The top half turns about the tangent t through h by σ·θ, which lifts it towards
 * the hinge side and over it.
 *
 * The same maths runs on the GPU (vertex shader in regionMaterial.ts) and here on
 * the CPU (markers, labels, cut rings, picking and camera framing), so what you
 * click is what is drawn.
 */
import type { Frames } from './frames';

/** Extra distance between the hinge and the wall, as a fraction of the radius. Opens a small gap between the halves. */
export const OPEN_GAP = 0.12;

export type HingeSide = 1 | -1;

export interface Spine {
  /** Number of centerline samples. */
  count: number;
  /** Hinge point per sample (model space, xyz). */
  hinge: Float32Array;
  /** Hinge axis per sample: the unit tangent of the centerline. */
  axis: Float32Array;
  /** Unit direction from the centerline to where top meets bottom (+e1). */
  side: Float32Array;
}

/** Moving average of a radius profile, so the hinge line is smooth on noisy scans. */
export function smoothProfile(values: Float32Array, half = 6): Float32Array {
  const n = values.length;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    let w = 0;
    for (let j = Math.max(0, i - half); j <= Math.min(n - 1, i + half); j++) {
      s += values[j];
      w++;
    }
    out[i] = w ? s / w : values[i];
  }
  return out;
}

export function computeSpine(opts: {
  centerline: Float32Array;
  tangents: Float32Array;
  frames: Frames;
  /** Wall radius per sample (outermost), already smoothed. */
  radius: Float32Array;
  /** Angle of "top" in the raw frame (radians): flip ? −topOffset : topOffset. */
  phi: number;
  side: HingeSide;
  gap?: number;
}): Spine {
  const { centerline, tangents, frames, radius, phi, side } = opts;
  const gap = opts.gap ?? OPEN_GAP;
  const M = centerline.length / 3;
  const hinge = new Float32Array(M * 3);
  const axis = new Float32Array(M * 3);
  const sideDir = new Float32Array(M * 3);
  const c = Math.cos(phi);
  const s = Math.sin(phi);
  for (let k = 0; k < M; k++) {
    let ex = -s * frames.up[3 * k] + c * frames.bin[3 * k];
    let ey = -s * frames.up[3 * k + 1] + c * frames.bin[3 * k + 1];
    let ez = -s * frames.up[3 * k + 2] + c * frames.bin[3 * k + 2];
    const el = Math.hypot(ex, ey, ez) || 1;
    ex /= el;
    ey /= el;
    ez /= el;
    sideDir[3 * k] = ex;
    sideDir[3 * k + 1] = ey;
    sideDir[3 * k + 2] = ez;
    const r = (radius[k] || radius[Math.max(0, k - 1)] || 1) * (1 + gap) * side;
    hinge[3 * k] = centerline[3 * k] + r * ex;
    hinge[3 * k + 1] = centerline[3 * k + 1] + r * ey;
    hinge[3 * k + 2] = centerline[3 * k + 2] + r * ez;
    const tl = Math.hypot(tangents[3 * k], tangents[3 * k + 1], tangents[3 * k + 2]) || 1;
    axis[3 * k] = tangents[3 * k] / tl;
    axis[3 * k + 1] = tangents[3 * k + 1] / tl;
    axis[3 * k + 2] = tangents[3 * k + 2] / tl;
  }
  return { count: M, hinge, axis, side: sideDir };
}

/** Signed opening angle (radians) for an opening amount 0…1 (1 = 180°). */
export function openAngle(amount: number, side: HingeSide): number {
  return side * Math.max(0, Math.min(1, amount)) * Math.PI;
}

// Scratch values for the interpolated hinge (kept outside to avoid allocations in loops).
const H = new Float64Array(3);
const K = new Float64Array(3);

/** Interpolated hinge point and axis at a position along the vessel (same as the shader). */
function sampleHinge(spine: Spine, aT: number) {
  const M = spine.count;
  const x = Math.max(0, Math.min(1, aT)) * (M - 1);
  const i0 = Math.min(M - 1, Math.floor(x));
  const i1 = Math.min(M - 1, i0 + 1);
  const f = x - i0;
  for (let d = 0; d < 3; d++) {
    H[d] = spine.hinge[3 * i0 + d] + (spine.hinge[3 * i1 + d] - spine.hinge[3 * i0 + d]) * f;
    K[d] = spine.axis[3 * i0 + d] + (spine.axis[3 * i1 + d] - spine.axis[3 * i0 + d]) * f;
  }
  const kl = Math.hypot(K[0], K[1], K[2]) || 1;
  K[0] /= kl;
  K[1] /= kl;
  K[2] /= kl;
}

/** Hinge point at a position along the vessel (model space). */
export function hingeAt(spine: Spine, aT: number): [number, number, number] {
  sampleHinge(spine, aT);
  return [H[0], H[1], H[2]];
}

/**
 * Where a point of the top half is drawn when the vessel is open by `angle` (radians, from
 * openAngle). `aT` is the point's position along the centerline. Writes x, y, z to out[o…o+2].
 */
export function openPoint(
  spine: Spine,
  aT: number,
  angle: number,
  x: number,
  y: number,
  z: number,
  out: { [i: number]: number },
  o = 0,
): void {
  if (angle === 0) {
    out[o] = x;
    out[o + 1] = y;
    out[o + 2] = z;
    return;
  }
  sampleHinge(spine, aT);
  rotate(angle, x - H[0], y - H[1], z - H[2], out, o);
  out[o] += H[0];
  out[o + 1] += H[1];
  out[o + 2] += H[2];
}

/** openPoint for many points at once (xyz triples in `src`, one aT each), written to `dst`. */
export function openPositions(spine: Spine, aT: ArrayLike<number>, angle: number, src: ArrayLike<number>, dst: Float32Array): void {
  const n = aT.length;
  if (angle === 0) {
    for (let i = 0; i < 3 * n; i++) dst[i] = src[i];
    return;
  }
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const M = spine.count;
  const hinge = spine.hinge;
  const axis = spine.axis;
  for (let i = 0; i < n; i++) {
    const x = Math.max(0, Math.min(1, aT[i])) * (M - 1);
    const i0 = Math.min(M - 1, Math.floor(x));
    const i1 = Math.min(M - 1, i0 + 1);
    const f = x - i0;
    const hx = hinge[3 * i0] + (hinge[3 * i1] - hinge[3 * i0]) * f;
    const hy = hinge[3 * i0 + 1] + (hinge[3 * i1 + 1] - hinge[3 * i0 + 1]) * f;
    const hz = hinge[3 * i0 + 2] + (hinge[3 * i1 + 2] - hinge[3 * i0 + 2]) * f;
    let kx = axis[3 * i0] + (axis[3 * i1] - axis[3 * i0]) * f;
    let ky = axis[3 * i0 + 1] + (axis[3 * i1 + 1] - axis[3 * i0 + 1]) * f;
    let kz = axis[3 * i0 + 2] + (axis[3 * i1 + 2] - axis[3 * i0 + 2]) * f;
    const kl = Math.hypot(kx, ky, kz) || 1;
    kx /= kl;
    ky /= kl;
    kz /= kl;
    const vx = src[3 * i] - hx;
    const vy = src[3 * i + 1] - hy;
    const vz = src[3 * i + 2] - hz;
    const kd = (kx * vx + ky * vy + kz * vz) * (1 - c);
    dst[3 * i] = hx + vx * c + (ky * vz - kz * vy) * s + kx * kd;
    dst[3 * i + 1] = hy + vy * c + (kz * vx - kx * vz) * s + ky * kd;
    dst[3 * i + 2] = hz + vz * c + (kx * vy - ky * vx) * s + kz * kd;
  }
}

/** Turns a direction (e.g. a normal) of the top half the same way as openPoint. */
export function openVector(
  spine: Spine,
  aT: number,
  angle: number,
  x: number,
  y: number,
  z: number,
  out: { [i: number]: number },
  o = 0,
): void {
  if (angle === 0) {
    out[o] = x;
    out[o + 1] = y;
    out[o + 2] = z;
    return;
  }
  sampleHinge(spine, aT);
  rotate(angle, x, y, z, out, o);
}

/** Rodrigues rotation of (x, y, z) about the unit axis K by `angle`. */
function rotate(angle: number, x: number, y: number, z: number, out: { [i: number]: number }, o: number) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const kx = K[0], ky = K[1], kz = K[2];
  const kd = (kx * x + ky * y + kz * z) * (1 - c);
  out[o] = x * c + (ky * z - kz * y) * s + kx * kd;
  out[o + 1] = y * c + (kz * x - kx * z) * s + ky * kd;
  out[o + 2] = z * c + (kx * y - ky * x) * s + kz * kd;
}

/**
 * Hinge side that lifts the top half away from the viewer, so its inner surface turns
 * towards the camera as it opens. `toCamera` is the direction from the model to the
 * camera, in model space. Looking straight down (or along the vessel) gives −1.
 */
export function preferredHingeSide(spine: Spine, toCamera: [number, number, number]): HingeSide {
  const M = spine.count;
  let s = 0;
  for (let k = 0; k < M; k++) {
    s += spine.side[3 * k] * toCamera[0] + spine.side[3 * k + 1] * toCamera[1] + spine.side[3 * k + 2] * toCamera[2];
  }
  const mean = s / Math.max(1, M);
  // Camera on the +side: hinge on the far (−) side, and the other way round.
  return mean < -0.05 ? 1 : -1;
}
