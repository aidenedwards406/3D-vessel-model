/**
 * "Top" reference frames along the centerline.
 *
 * At each centerline sample, top = the chosen up direction projected onto the
 * plane perpendicular to the vessel. Where the vessel runs parallel to up (so
 * "top" is undefined) the frame is carried over smoothly (parallel transport).
 */

export interface Frames {
  up: Float32Array;
  bin: Float32Array;
}

export function computeFrames(tangents: Float32Array, upDir: [number, number, number]): Frames {
  const M = tangents.length / 3;
  const up = new Float32Array(M * 3);
  const bin = new Float32Array(M * 3);
  const valid = new Uint8Array(M);
  for (let k = 0; k < M; k++) {
    const tx = tangents[3 * k], ty = tangents[3 * k + 1], tz = tangents[3 * k + 2];
    const d = upDir[0] * tx + upDir[1] * ty + upDir[2] * tz;
    const ux = upDir[0] - d * tx, uy = upDir[1] - d * ty, uz = upDir[2] - d * tz;
    const l = Math.hypot(ux, uy, uz);
    if (l > 0.25) {
      up[3 * k] = ux / l;
      up[3 * k + 1] = uy / l;
      up[3 * k + 2] = uz / l;
      valid[k] = 1;
    }
  }
  const transport = (from: number, to: number) => {
    const tx = tangents[3 * to], ty = tangents[3 * to + 1], tz = tangents[3 * to + 2];
    let ux = up[3 * from], uy = up[3 * from + 1], uz = up[3 * from + 2];
    const d = ux * tx + uy * ty + uz * tz;
    ux -= d * tx;
    uy -= d * ty;
    uz -= d * tz;
    const l = Math.hypot(ux, uy, uz) || 1;
    up[3 * to] = ux / l;
    up[3 * to + 1] = uy / l;
    up[3 * to + 2] = uz / l;
  };
  let firstValid = valid.indexOf(1);
  if (firstValid === -1) {
    // Vessel parallel to "up" everywhere: pick any perpendicular to start.
    const tx = tangents[0], ty = tangents[1], tz = tangents[2];
    const ref = Math.abs(tx) < 0.9 ? [1, 0, 0] : [0, 0, 1];
    const d = ref[0] * tx + ref[1] * ty + ref[2] * tz;
    const ux = ref[0] - d * tx, uy = ref[1] - d * ty, uz = ref[2] - d * tz;
    const l = Math.hypot(ux, uy, uz) || 1;
    up[0] = ux / l;
    up[1] = uy / l;
    up[2] = uz / l;
    valid[0] = 1;
    firstValid = 0;
  }
  for (let k = firstValid + 1; k < M; k++) if (!valid[k]) transport(k - 1, k);
  for (let k = firstValid - 1; k >= 0; k--) if (!valid[k]) transport(k + 1, k);
  for (let k = 0; k < M; k++) {
    const tx = tangents[3 * k], ty = tangents[3 * k + 1], tz = tangents[3 * k + 2];
    const ux = up[3 * k], uy = up[3 * k + 1], uz = up[3 * k + 2];
    bin[3 * k] = ty * uz - tz * uy;
    bin[3 * k + 1] = tz * ux - tx * uz;
    bin[3 * k + 2] = tx * uy - ty * ux;
  }
  return { up, bin };
}

/** Per-vertex (cos θ, sin θ) of the radial direction in the local top frame. */
export function vertexAngles(aT: Float32Array, radial: Float32Array, frames: Frames, out?: Float32Array): Float32Array {
  const V = aT.length;
  const M = frames.up.length / 3;
  const res = out ?? new Float32Array(V * 2);
  for (let v = 0; v < V; v++) {
    const k = Math.round(aT[v] * (M - 1));
    const rx = radial[3 * v], ry = radial[3 * v + 1], rz = radial[3 * v + 2];
    res[2 * v] = rx * frames.up[3 * k] + ry * frames.up[3 * k + 1] + rz * frames.up[3 * k + 2];
    res[2 * v + 1] = rx * frames.bin[3 * k] + ry * frames.bin[3 * k + 1] + rz * frames.bin[3 * k + 2];
  }
  return res;
}

/** Interpolated centerline point, tangent and frame at a given aT. */
export function frameAt(
  aT: number,
  centerline: Float32Array,
  tangents: Float32Array,
  frames: Frames,
): { p: [number, number, number]; t: [number, number, number]; up: [number, number, number]; bin: [number, number, number] } {
  const M = centerline.length / 3;
  const x = Math.max(0, Math.min(1, aT)) * (M - 1);
  const i = Math.min(M - 2, Math.floor(x));
  const f = x - i;
  const lerp = (arr: Float32Array, d: number) => arr[3 * i + d] + (arr[3 * (i + 1) + d] - arr[3 * i + d]) * f;
  const norm = (v: [number, number, number]): [number, number, number] => {
    const l = Math.hypot(v[0], v[1], v[2]) || 1;
    return [v[0] / l, v[1] / l, v[2] / l];
  };
  return {
    p: [lerp(centerline, 0), lerp(centerline, 1), lerp(centerline, 2)],
    t: norm([lerp(tangents, 0), lerp(tangents, 1), lerp(tangents, 2)]),
    up: norm([lerp(frames.up, 0), lerp(frames.up, 1), lerp(frames.up, 2)]),
    bin: norm([lerp(frames.bin, 0), lerp(frames.bin, 1), lerp(frames.bin, 2)]),
  };
}
