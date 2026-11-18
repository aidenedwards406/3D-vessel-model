/**
 * Region material: a standard PBR material whose base colour is computed per
 * pixel from the vessel coordinates (aT along the centerline, angle around it).
 *
 *   mode 0  plain        neutral surface
 *   mode 1  sections     sections in an ordinal blue ramp, bottom halves lighter
 *   mode 2  heat map     damage per region from a data texture + colour map;
 *                        regions without an image are hatched neutral gray
 *
 * Section boundaries, P/M/D boundaries and the top/bottom divide are drawn as
 * anti-aliased lines, so they stay crisp regardless of mesh resolution.
 *
 * Opening the vessel (see geometry/opening.ts): when open, the mesh is drawn
 * twice. The top pass turns every vertex about the hinge and keeps only the
 * pixels on the top side of the divide; the bottom pass draws the mesh in place
 * and keeps only the bottom side. Together they cut the surface exactly along
 * the divide, even through triangles that cross it, without changing the mesh.
 */
import * as THREE from 'three';
import { MAX_SECTIONS, MAX_SLOTS } from '../lib/regions';

export const ROWS = MAX_SECTIONS * 2;

export interface RegionUniforms {
  [key: string]: THREE.IUniform;
  uMode: THREE.IUniform<number>;
  uData: THREE.IUniform<THREE.DataTexture>;
  uColormap: THREE.IUniform<THREE.DataTexture>;
  uSectionColors: THREE.IUniform<THREE.DataTexture>;
  uCount: THREE.IUniform<number>;
  uBounds: THREE.IUniform<number[]>;
  /** Number of positions (slots) in each section. */
  uSlots: THREE.IUniform<number[]>;
  uFlip: THREE.IUniform<number>;
  uTop: THREE.IUniform<THREE.Vector2>;
  uTrim: THREE.IUniform<THREE.Vector2>;
  uHover: THREE.IUniform<number>;
  uSelected: THREE.IUniform<number>;
  uHighlightSection: THREE.IUniform<number>;
  uSmooth: THREE.IUniform<number>;
  uOutlines: THREE.IUniform<number>;
  uNoData: THREE.IUniform<THREE.Color>;
  uUnsectioned: THREE.IUniform<THREE.Color>;
  uPlain: THREE.IUniform<THREE.Color>;
  uLine: THREE.IUniform<THREE.Color>;
  uHatch: THREE.IUniform<number>;
  /** Hinge per centerline sample: row 0 = hinge point, row 1 = hinge axis (model space). */
  uSpine: THREE.IUniform<THREE.DataTexture>;
  uSpineN: THREE.IUniform<number>;
  /** Signed angle the top half is turned by (radians); 0 = closed. */
  uOpenAngle: THREE.IUniform<number>;
}

/** Which part of the vessel a material draws: the whole closed vessel, or one half of the open vessel. */
export const HALF_ALL = -1;
export const HALF_TOP = 0;
export const HALF_BOTTOM = 1;

/** Float texture holding the hinge (see opening.ts) for the vertex shader. */
export function makeSpineTexture(hinge: Float32Array, axis: Float32Array, count: number): THREE.DataTexture {
  const data = new Float32Array(Math.max(2, count) * 2 * 4);
  const w = Math.max(2, count);
  for (let k = 0; k < count; k++) {
    for (let d = 0; d < 3; d++) {
      data[4 * k + d] = hinge[3 * k + d];
      data[4 * (w + k) + d] = axis[3 * k + d];
    }
  }
  const tex = new THREE.DataTexture(data, w, 2, THREE.RGBAFormat, THREE.FloatType);
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.needsUpdate = true;
  return tex;
}

export function makeDataTexture(): THREE.DataTexture {
  const data = new Float32Array(MAX_SLOTS * ROWS * 4);
  const tex = new THREE.DataTexture(data, MAX_SLOTS, ROWS, THREE.RGBAFormat, THREE.FloatType);
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.needsUpdate = true;
  return tex;
}

export function makeLutTexture(lut: Uint8Array, nearest: boolean): THREE.DataTexture {
  const tex = new THREE.DataTexture(lut, lut.length / 4, 1, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = nearest ? THREE.NearestFilter : THREE.LinearFilter;
  tex.magFilter = nearest ? THREE.NearestFilter : THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

export function createRegionUniforms(): RegionUniforms {
  return {
    uMode: { value: 0 },
    uData: { value: makeDataTexture() },
    uColormap: { value: makeLutTexture(new Uint8Array([255, 255, 255, 255, 0, 0, 0, 255]), false) },
    uSectionColors: { value: makeLutTexture(new Uint8Array(MAX_SECTIONS * 4).fill(200), true) },
    uCount: { value: 4 },
    uBounds: { value: new Array(MAX_SECTIONS + 1).fill(1) },
    uSlots: { value: new Array(MAX_SECTIONS).fill(3) },
    uFlip: { value: 0 },
    uTop: { value: new THREE.Vector2(1, 0) },
    uTrim: { value: new THREE.Vector2(0, 1) },
    uHover: { value: -1 },
    uSelected: { value: -1 },
    uHighlightSection: { value: -1 },
    uSmooth: { value: 0 },
    uOutlines: { value: 1 },
    uNoData: { value: new THREE.Color('#a9a8a2') },
    uUnsectioned: { value: new THREE.Color('#d9d8d2') },
    uPlain: { value: new THREE.Color('#d8cfc6') },
    uLine: { value: new THREE.Color('#1a1a19') },
    uHatch: { value: 1 },
    uSpine: { value: makeSpineTexture(new Float32Array(6), new Float32Array([1, 0, 0, 1, 0, 0]), 2) },
    uSpineN: { value: 2 },
    uOpenAngle: { value: 0 },
  };
}

const VERT_DECL = /* glsl */ `
attribute float aT;
attribute vec2 aAng;
uniform sampler2D uSpine;
uniform float uSpineN;
uniform float uOpenAngle;
uniform float uHalf;
varying float vT;
varying vec2 vAng;
varying vec3 vObj;
`;

// Top half of an open vessel: turn about the hinge at this point along the vessel
// (Rodrigues' rotation; the same maths as openPoint in geometry/opening.ts).
const VERT_OPEN_NORMAL = /* glsl */ `
vec3 vsHinge = vec3(0.0);
vec3 vsAxis = vec3(1.0, 0.0, 0.0);
float vsCos = 1.0;
float vsSin = 0.0;
bool vsOpen = uHalf > -0.5 && uHalf < 0.5 && uOpenAngle != 0.0;
if (vsOpen) {
  float sx = clamp(aT, 0.0, 1.0) * (uSpineN - 1.0);
  int i0 = int(min(floor(sx), uSpineN - 1.0));
  int i1 = min(i0 + 1, int(uSpineN) - 1);
  float sf = sx - float(i0);
  vsHinge = mix(texelFetch(uSpine, ivec2(i0, 0), 0).xyz, texelFetch(uSpine, ivec2(i1, 0), 0).xyz, sf);
  vsAxis = normalize(mix(texelFetch(uSpine, ivec2(i0, 1), 0).xyz, texelFetch(uSpine, ivec2(i1, 1), 0).xyz, sf));
  vsCos = cos(uOpenAngle);
  vsSin = sin(uOpenAngle);
  objectNormal = objectNormal * vsCos + cross(vsAxis, objectNormal) * vsSin + vsAxis * dot(vsAxis, objectNormal) * (1.0 - vsCos);
}
`;

const VERT_OPEN_POSITION = /* glsl */ `
vT = aT;
vAng = aAng;
vObj = position;
if (vsOpen) {
  vec3 vsP = transformed - vsHinge;
  transformed = vsHinge + vsP * vsCos + cross(vsAxis, vsP) * vsSin + vsAxis * dot(vsAxis, vsP) * (1.0 - vsCos);
}
`;

// Each pass keeps only its own side of the top/bottom divide (same test as regionColor).
const FRAG_OPEN_CLIP = /* glsl */ `
if (uHalf > -0.5) {
  float hsSin = uFlip > 0.5 ? -vAng.y : vAng.y;
  float hsTop = vAng.x * uTop.x + hsSin * uTop.y;
  if ((hsTop >= 0.0) != (uHalf < 0.5)) discard;
}
`;

const FRAG_DECL = /* glsl */ `
uniform int uMode;
uniform sampler2D uData;
uniform sampler2D uColormap;
uniform sampler2D uSectionColors;
uniform int uCount;
uniform float uBounds[${MAX_SECTIONS + 1}];
uniform float uSlots[${MAX_SECTIONS}];
uniform float uFlip;
uniform vec2 uTop;
uniform vec2 uTrim;
uniform float uHover;
uniform float uSelected;
uniform float uHighlightSection;
uniform float uSmooth;
uniform float uOutlines;
uniform vec3 uNoData;
uniform vec3 uUnsectioned;
uniform vec3 uPlain;
uniform vec3 uLine;
uniform float uHatch;
uniform float uHalf;
varying float vT;
varying vec2 vAng;
varying vec3 vObj;

vec4 cellAt(int s, float side, float slot) {
  return texelFetch(uData, ivec2(int(slot), s * 2 + int(side)), 0);
}

// Value of a neighbouring slot, crossing into the adjacent section when needed.
vec4 neighbour(int s, float side, float slot) {
  float slots = uSlots[s];
  if (slot < 0.0) {
    if (s == 0) return vec4(0.0);
    return cellAt(s - 1, side, uSlots[s - 1] - 1.0);
  }
  if (slot >= slots) {
    if (s + 1 >= uCount) return vec4(0.0);
    return cellAt(s + 1, side, 0.0);
  }
  return cellAt(s, side, slot);
}

vec3 lut(float v) {
  return texture(uColormap, vec2(clamp(v, 0.0, 1.0) * (255.0 / 256.0) + 0.5 / 256.0, 0.5)).rgb;
}

vec3 regionColor() {
  if (uMode == 0) return uPlain;
  float u0 = uFlip > 0.5 ? 1.0 - vT : vT;
  float u = (u0 - uTrim.x) / max(1e-5, uTrim.y - uTrim.x);
  if (u < 0.0 || u > 1.0) return uUnsectioned;
  int s = 0;
  for (int i = 1; i < ${MAX_SECTIONS}; i++) {
    if (i >= uCount) break;
    if (u >= uBounds[i]) s = i;
  }
  float b0 = uBounds[s];
  float b1 = uBounds[s + 1];
  float w = clamp((u - b0) / max(1e-6, b1 - b0), 0.0, 0.99999);
  float slots = max(1.0, uSlots[s]);
  float slotF = w * slots;
  float slot = min(slots - 1.0, floor(slotF));
  float sinA = uFlip > 0.5 ? -vAng.y : vAng.y;
  float topness = vAng.x * uTop.x + sinA * uTop.y;
  float side = topness >= 0.0 ? 0.0 : 1.0;

  vec3 base;
  if (uMode == 1) {
    base = texelFetch(uSectionColors, ivec2(s, 0), 0).rgb;
    if (side > 0.5) base = mix(base, vec3(0.80), 0.55);
  } else {
    vec4 cell = cellAt(s, side, slot);
    if (cell.g > 0.5) {
      float v = cell.r;
      if (uSmooth > 0.5) {
        float c = slotF - 0.5;
        float k0 = floor(c);
        float fr = c - k0;
        vec4 a = k0 == slot ? cell : neighbour(s, side, k0);
        vec4 b = k0 + 1.0 == slot ? cell : neighbour(s, side, k0 + 1.0);
        float va = a.g > 0.5 ? a.r : v;
        float vb = b.g > 0.5 ? b.r : v;
        v = mix(va, vb, smoothstep(0.0, 1.0, fr));
        // Soften the top/bottom divide when both sides have data.
        vec4 other = cellAt(s, 1.0 - side, slot);
        if (other.g > 0.5) {
          float t = smoothstep(0.0, 0.35, abs(topness));
          v = mix(mix(v, other.r, 0.5), v, t);
        }
      }
      base = lut(v);
    } else {
      float h = step(0.55, fract(dot(vObj, vec3(0.57735)) * uHatch));
      base = mix(uNoData, uNoData * 0.72, h);
    }
  }

  float idx = (float(s) * 2.0 + side) * ${MAX_SLOTS}.0 + slot;
  if (uHighlightSection >= 0.0 && abs(float(s) - uHighlightSection) > 0.5) base *= 0.45;
  if (abs(idx - uSelected) < 0.5) base = mix(base, vec3(1.0), 0.22);
  if (abs(idx - uHover) < 0.5) base = mix(base, vec3(1.0), 0.32);

  if (uOutlines > 0.5) {
    float du = max(fwidth(u), 1e-6);
    float dSec = min(u - b0, b1 - u);
    float lineSec = s == 0 ? 0.0 : 1.0 - smoothstep(0.6 * du, 1.6 * du, u - b0);
    lineSec = max(lineSec, s + 1 >= uCount ? 0.0 : 1.0 - smoothstep(0.6 * du, 1.6 * du, b1 - u));
    float fs = fract(slotF);
    float dSlot = min(fs, 1.0 - fs) * (b1 - b0) / slots;
    float lineSlot = 1.0 - smoothstep(0.4 * du, 1.1 * du, dSlot);
    if (dSec < 2.0 * du) lineSlot = 0.0;
    float dt = max(fwidth(topness), 1e-6);
    float lineSide = 1.0 - smoothstep(0.5 * dt, 1.4 * dt, abs(topness));
    float a = max(lineSec * 0.9, max(lineSlot * 0.32, lineSide * 0.5));
    base = mix(base, uLine, a);
  }
  return base;
}
`;

/**
 * The vessel material. Uniforms are shared between materials; `half` is this
 * material's own (HALF_ALL, HALF_TOP or HALF_BOTTOM), so the two halves of an
 * open vessel can be drawn with the same shader program.
 */
export function createRegionMaterial(uniforms: RegionUniforms, half: THREE.IUniform<number> = { value: HALF_ALL }): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.62,
    metalness: 0.0,
    side: THREE.DoubleSide,
  });
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms, { uHalf: half });
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${VERT_DECL}`)
      .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>\n${VERT_OPEN_NORMAL}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${VERT_OPEN_POSITION}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${FRAG_DECL}`)
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>\n${FRAG_OPEN_CLIP}`)
      .replace('#include <color_fragment>', '#include <color_fragment>\n  diffuseColor.rgb = regionColor();');
  };
  mat.customProgramCacheKey = () => 'vessel-region-v2';
  return mat;
}

// ── Markers ─────────────────────────────────────────────────────────────────

export function createMarkerMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { uScale: { value: 1 } },
    vertexShader: /* glsl */ `
      attribute vec3 color;
      attribute float state;
      uniform float uScale;
      varying vec3 vColor;
      varying float vState;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_Position.z -= 0.0015 * gl_Position.w;
        gl_PointSize = (state > 0.5 ? 19.0 : 13.0) * uScale;
        vColor = color;
        vState = state;
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vColor;
      varying float vState;
      void main() {
        vec2 p = gl_PointCoord * 2.0 - 1.0;
        float r = length(p);
        if (r > 1.0) discard;
        float aa = fwidth(r) * 1.2;
        vec3 ring = vState > 1.5 ? vec3(0.04) : vec3(1.0);
        vec3 col = mix(vColor, ring, smoothstep(0.58 - aa, 0.58 + aa, r));
        col = mix(col, vec3(0.05), smoothstep(0.86 - aa, 0.86 + aa, r) * 0.85);
        float alpha = 1.0 - smoothstep(1.0 - aa, 1.0, r);
        gl_FragColor = vec4(col, alpha);
        #include <colorspace_fragment>
      }
    `,
    transparent: true,
    depthTest: true,
    depthWrite: false,
  });
}
