/**
 * Non-serialisable study assets kept outside the reactive store: the processed
 * mesh, original scan object, source files and image blobs. Everything stays in
 * this browser tab's memory; nothing is uploaded or written to browser storage.
 */
import type * as THREE from 'three';
import type { ProcessResult } from '../geometry/process';
import type { Sheet } from '../lib/spreadsheet';
import type { VesselEngine } from '../three/engine';

export type BlobSource = Blob | (() => Promise<Blob>);

export const assets = {
  model: {
    result: null as ProcessResult | null,
    original: null as THREE.Object3D | null,
    sources: [] as { name: string; blob: Blob }[],
  },
  images: new Map<string, BlobSource>(),
  resolvedImages: new Map<string, Blob>(),
  damageSheets: null as Sheet[] | null,
  damageFile: null as { name: string; blob: Blob } | null,
  engine: null as VesselEngine | null,
};

export async function getImageBlob(id: string): Promise<Blob | null> {
  const cached = assets.resolvedImages.get(id);
  if (cached) return cached;
  const src = assets.images.get(id);
  if (!src) return null;
  const blob = typeof src === 'function' ? await src() : src;
  assets.resolvedImages.set(id, blob);
  return blob;
}

export function clearImageAssets() {
  assets.images.clear();
  assets.resolvedImages.clear();
}
