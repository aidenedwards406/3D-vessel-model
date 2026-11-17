/**
 * Image display helpers: decoding (including microscopy TIFFs), object URLs
 * and thumbnails. All decoding happens locally in the browser.
 */
import { getImageBlob } from '../state/assets';

export const IMAGE_EXT = /\.(tiff?|jpe?g|jfif|png|bmp|gif|webp|avif)$/i;

export function isImageFile(name: string): boolean {
  return IMAGE_EXT.test(name);
}

async function isTiffBlob(blob: Blob, name: string): Promise<boolean> {
  if (/\.tiff?$/i.test(name) || blob.type === 'image/tiff') return true;
  const head = new Uint8Array(await blob.slice(0, 4).arrayBuffer());
  return (head[0] === 0x49 && head[1] === 0x49 && head[2] === 42) || (head[0] === 0x4d && head[1] === 0x4d && head[3] === 42);
}

interface UtifIfd {
  width: number;
  height: number;
  data: Uint8Array;
  isLE: boolean;
  [tag: string]: unknown;
}
interface UtifModule {
  decode(buf: ArrayBuffer): UtifIfd[];
  decodeImage(buf: ArrayBuffer, ifd: UtifIfd, ifds?: UtifIfd[]): void;
  toRGBA8(ifd: UtifIfd): Uint8Array;
}

let utifPromise: Promise<UtifModule> | null = null;
function loadUtif(): Promise<UtifModule> {
  utifPromise ??= import('utif').then((m) => ((m as unknown as { default?: UtifModule }).default ?? m) as UtifModule);
  return utifPromise;
}

/** Decodes a TIFF into a canvas. 16-bit grayscale is contrast-stretched (1st–99.8th percentile). */
export async function decodeTiff(buf: ArrayBuffer): Promise<HTMLCanvasElement> {
  const UTIF = await loadUtif();
  const ifds = UTIF.decode(buf);
  // Pick the largest image (skips thumbnails / reduced-resolution pages).
  let page = ifds[0];
  for (const ifd of ifds) {
    const a = (ifd.t256 as number[] | undefined)?.[0] ?? 0;
    const b = (ifd.t257 as number[] | undefined)?.[0] ?? 0;
    const pa = ((page.t256 as number[] | undefined)?.[0] ?? 0) * ((page.t257 as number[] | undefined)?.[0] ?? 0);
    if (a * b > pa) page = ifd;
  }
  UTIF.decodeImage(buf, page, ifds);
  const w = page.width;
  const h = page.height;
  const bps = (page.t258 as number[] | undefined) ?? [8];
  const photometric = (page.t262 as number[] | undefined)?.[0] ?? 2;
  let rgba: Uint8Array | Uint8ClampedArray;
  if (bps[0] === 16 && bps.length === 1 && (photometric === 1 || photometric === 0)) {
    const n = w * h;
    const dv = new DataView(page.data.buffer, page.data.byteOffset, page.data.byteLength);
    const vals = new Uint16Array(n);
    for (let i = 0; i < n; i++) vals[i] = dv.getUint16(2 * i, page.isLE);
    const hist = new Uint32Array(65536);
    for (let i = 0; i < n; i++) hist[vals[i]]++;
    const pick = (q: number) => {
      let acc = 0;
      const target = q * n;
      for (let v = 0; v < 65536; v++) {
        acc += hist[v];
        if (acc >= target) return v;
      }
      return 65535;
    };
    const lo = pick(0.01);
    const hi = Math.max(lo + 1, pick(0.998));
    rgba = new Uint8ClampedArray(n * 4);
    for (let i = 0; i < n; i++) {
      let g = ((vals[i] - lo) / (hi - lo)) * 255;
      if (photometric === 0) g = 255 - g;
      rgba[4 * i] = rgba[4 * i + 1] = rgba[4 * i + 2] = g;
      rgba[4 * i + 3] = 255;
    }
  } else {
    rgba = UTIF.toRGBA8(page);
  }
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(w, h);
  img.data.set(rgba.subarray(0, img.data.length));
  ctx.putImageData(img, 0, 0);
  return canvas;
}

function canvasToBlob(canvas: HTMLCanvasElement, type = 'image/png', quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Image encoding failed'))), type, quality),
  );
}

const displayCache = new Map<string, Promise<string | null>>();
const thumbCache = new Map<string, Promise<string | null>>();

/** A browser-displayable blob for an image (TIFFs are converted to PNG). */
export async function displayBlob(id: string, name: string): Promise<Blob | null> {
  const blob = await getImageBlob(id);
  if (!blob) return null;
  if (await isTiffBlob(blob, name)) {
    const canvas = await decodeTiff(await blob.arrayBuffer());
    return canvasToBlob(canvas);
  }
  return blob;
}

export function displayUrl(id: string, name: string): Promise<string | null> {
  let p = displayCache.get(id);
  if (!p) {
    p = displayBlob(id, name)
      .then((b) => (b ? URL.createObjectURL(b) : null))
      .catch(() => null);
    displayCache.set(id, p);
  }
  return p;
}

// Limit concurrent thumbnail work so large studies stay responsive.
let active = 0;
const queue: (() => void)[] = [];
function withSlot<T>(fn: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const run = () => {
      active++;
      fn()
        .then(resolve, reject)
        .finally(() => {
          active--;
          queue.shift()?.();
        });
    };
    if (active < 4) run();
    else queue.push(run);
  });
}

export function thumbUrl(id: string, name: string, size = 240): Promise<string | null> {
  let p = thumbCache.get(id);
  if (!p) {
    p = withSlot(async () => {
      const blob = await displayBlob(id, name);
      if (!blob) return null;
      const bmp = await createImageBitmap(blob);
      const scale = size / Math.max(bmp.width, bmp.height);
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(bmp.width * scale));
      c.height = Math.max(1, Math.round(bmp.height * scale));
      c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
      bmp.close();
      return URL.createObjectURL(await canvasToBlob(c, 'image/jpeg', 0.85));
    }).catch(() => null);
    thumbCache.set(id, p);
  }
  return p;
}

export function forgetImageUrls() {
  for (const p of [...displayCache.values(), ...thumbCache.values()]) {
    p.then((u) => u && URL.revokeObjectURL(u));
  }
  displayCache.clear();
  thumbCache.clear();
}

/** Loads an overlay (traced outline or mask) and returns a transparent-background version. */
export async function overlayUrl(id: string, name: string, mode: 'image' | 'mask', color = [255, 214, 0]): Promise<string | null> {
  const blob = await displayBlob(id, name);
  if (!blob) return null;
  if (mode === 'image') return URL.createObjectURL(blob);
  const bmp = await createImageBitmap(blob);
  const c = document.createElement('canvas');
  c.width = bmp.width;
  c.height = bmp.height;
  const ctx = c.getContext('2d')!;
  ctx.drawImage(bmp, 0, 0);
  const img = ctx.getImageData(0, 0, c.width, c.height);
  const d = img.data;
  // Bright pixels = traced damage; dark = transparent.
  for (let i = 0; i < d.length; i += 4) {
    const lum = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    const a = d[i + 3] < 250 ? d[i + 3] : lum > 127 ? 255 : 0;
    d[i] = color[0];
    d[i + 1] = color[1];
    d[i + 2] = color[2];
    d[i + 3] = a;
  }
  ctx.putImageData(img, 0, 0);
  bmp.close();
  return URL.createObjectURL(await canvasToBlob(c));
}
