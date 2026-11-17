/**
 * Model loading. Supports the formats partners and phone-scanning apps export:
 *   STL (binary/ASCII), GLB, glTF (+ .bin + textures), OBJ (+ .mtl + textures), PLY,
 *   and .zip archives containing any of these (e.g. Polycam OBJ exports).
 * Files are read locally; nothing is uploaded.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { MTLLoader } from 'three/addons/loaders/MTLLoader.js';
import { PLYLoader } from 'three/addons/loaders/PLYLoader.js';
import { unzipSync } from 'fflate';

export type ModelFormat = 'stl' | 'glb' | 'gltf' | 'obj' | 'ply';

export type LoadedModel =
  | { format: 'stl'; name: string; size: number; buffer: ArrayBuffer }
  | {
      format: Exclude<ModelFormat, 'stl'>;
      name: string;
      size: number;
      positions: Float32Array;
      index: Uint32Array | null;
      object: THREE.Object3D;
      hasTexture: boolean;
    };

export const MODEL_EXTENSIONS = ['.stl', '.glb', '.gltf', '.obj', '.ply', '.zip'];
const MAIN_EXT = /\.(stl|glb|gltf|obj|ply)$/i;

export class ModelLoadError extends Error {}

interface VFile {
  name: string;
  data: ArrayBuffer;
}

async function toVirtualFiles(files: File[]): Promise<VFile[]> {
  const out: VFile[] = [];
  for (const f of files) {
    const data = await f.arrayBuffer();
    if (/\.zip$/i.test(f.name)) {
      let entries: Record<string, Uint8Array>;
      try {
        entries = unzipSync(new Uint8Array(data));
      } catch {
        throw new ModelLoadError(`"${f.name}" couldn't be unzipped.`);
      }
      for (const [path, bytes] of Object.entries(entries)) {
        if (path.endsWith('/') || /(^|\/)(__MACOSX|\.)/.test(path)) continue;
        out.push({ name: path, data: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer });
      }
    } else {
      out.push({ name: f.name, data });
    }
  }
  return out;
}

const baseName = (p: string) => p.split(/[\\/]/).pop() ?? p;

function mimeFor(name: string): string {
  const n = name.toLowerCase();
  if (n.endsWith('.png')) return 'image/png';
  if (n.endsWith('.jpg') || n.endsWith('.jpeg')) return 'image/jpeg';
  if (n.endsWith('.webp')) return 'image/webp';
  if (n.endsWith('.ktx2')) return 'image/ktx2';
  return 'application/octet-stream';
}

/** Collects world-space triangle positions from every mesh in an object. */
export function extractTriangles(root: THREE.Object3D): { positions: Float32Array; index: Uint32Array | null } {
  root.updateMatrixWorld(true);
  const parts: { pos: Float32Array; idx: Uint32Array | null }[] = [];
  let vTotal = 0;
  let iTotal = 0;
  let anyIndexed = false;
  const v = new THREE.Vector3();
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry) return;
    const g = mesh.geometry as THREE.BufferGeometry;
    const attr = g.getAttribute('position') as THREE.BufferAttribute | undefined;
    if (!attr) return;
    const pos = new Float32Array(attr.count * 3);
    for (let i = 0; i < attr.count; i++) {
      v.fromBufferAttribute(attr, i).applyMatrix4(mesh.matrixWorld);
      pos[3 * i] = v.x;
      pos[3 * i + 1] = v.y;
      pos[3 * i + 2] = v.z;
    }
    let idx: Uint32Array | null = null;
    if (g.index) {
      idx = new Uint32Array(g.index.count);
      for (let i = 0; i < g.index.count; i++) idx[i] = g.index.getX(i);
      anyIndexed = true;
    }
    parts.push({ pos, idx });
    vTotal += attr.count;
    iTotal += idx ? idx.length : attr.count;
  });
  if (parts.length === 0) throw new ModelLoadError("This file doesn't contain a 3D mesh.");
  const positions = new Float32Array(vTotal * 3);
  if (!anyIndexed) {
    let o = 0;
    for (const p of parts) {
      positions.set(p.pos, o);
      o += p.pos.length;
    }
    return { positions, index: null };
  }
  const index = new Uint32Array(iTotal);
  let vo = 0;
  let io = 0;
  for (const p of parts) {
    positions.set(p.pos, vo * 3);
    if (p.idx) for (let i = 0; i < p.idx.length; i++) index[io++] = p.idx[i] + vo;
    else for (let i = 0; i < p.pos.length / 3; i++) index[io++] = vo + i;
    vo += p.pos.length / 3;
  }
  return { positions, index };
}

function hasTextures(root: THREE.Object3D): boolean {
  let found = false;
  root.traverse((o) => {
    const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
    const mats = Array.isArray(m) ? m : m ? [m] : [];
    for (const mat of mats) if ((mat as THREE.MeshStandardMaterial).map) found = true;
    const g = (o as THREE.Mesh).geometry as THREE.BufferGeometry | undefined;
    if (g?.getAttribute?.('color')) found = true;
  });
  return found;
}

export async function loadModelFiles(fileList: File[]): Promise<LoadedModel> {
  const files = await toVirtualFiles(fileList);
  const main =
    files.find((f) => /\.glb$/i.test(f.name)) ??
    files.find((f) => /\.gltf$/i.test(f.name)) ??
    files.find((f) => /\.obj$/i.test(f.name)) ??
    files.find((f) => /\.stl$/i.test(f.name)) ??
    files.find((f) => /\.ply$/i.test(f.name));
  if (!main) {
    throw new ModelLoadError('Choose an STL, GLB, glTF, OBJ or PLY file (or a .zip that contains one).');
  }
  const ext = (MAIN_EXT.exec(main.name)?.[1] ?? '').toLowerCase() as ModelFormat;
  const name = baseName(main.name);
  const size = main.data.byteLength;
  if (ext === 'stl') return { format: 'stl', name, size, buffer: main.data };

  // Resolve external resources (textures, .bin, .mtl) from the selected files.
  const urls = new Map<string, string>();
  for (const f of files) {
    if (f === main) continue;
    const url = URL.createObjectURL(new Blob([f.data], { type: mimeFor(f.name) }));
    urls.set(baseName(f.name).toLowerCase(), url);
  }
  const manager = new THREE.LoadingManager();
  manager.setURLModifier((url) => {
    if (url.startsWith('blob:') || url.startsWith('data:')) return url;
    const key = baseName(decodeURIComponent(url)).toLowerCase();
    return urls.get(key) ?? url;
  });

  let object: THREE.Object3D;
  try {
    if (ext === 'glb' || ext === 'gltf') {
      const loader = new GLTFLoader(manager);
      const data = ext === 'gltf' ? new TextDecoder().decode(main.data) : main.data;
      const gltf = await new Promise<{ scene: THREE.Object3D }>((resolve, reject) =>
        loader.parse(data, '', (g) => resolve(g), (e) => reject(e)),
      );
      object = gltf.scene;
    } else if (ext === 'obj') {
      const loader = new OBJLoader(manager);
      const mtl = files.find((f) => /\.mtl$/i.test(f.name));
      if (mtl) {
        const materials = new MTLLoader(manager).parse(new TextDecoder().decode(mtl.data), '');
        materials.preload();
        loader.setMaterials(materials);
      }
      object = loader.parse(new TextDecoder().decode(main.data));
    } else {
      const geom = new PLYLoader(manager).parse(main.data);
      const hasColor = !!geom.getAttribute('color');
      if (!geom.getAttribute('normal')) geom.computeVertexNormals();
      object = new THREE.Mesh(
        geom,
        new THREE.MeshStandardMaterial({ vertexColors: hasColor, roughness: 0.75, metalness: 0 }),
      );
    }
  } catch (e) {
    throw new ModelLoadError(`"${name}" couldn't be read${e instanceof Error && e.message ? `: ${e.message}` : '.'}`);
  }
  // Give textures a moment to decode so "Original appearance" looks right.
  await new Promise((r) => setTimeout(r, 30));
  const { positions, index } = extractTriangles(object);
  return { format: ext, name, size, positions, index, object, hasTexture: hasTextures(object) };
}
