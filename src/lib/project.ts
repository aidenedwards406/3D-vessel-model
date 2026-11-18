/**
 * Save / open studies (.vessel files).
 *
 * A .vessel file is a ZIP archive:
 *   study.json        settings, section setup, placements, damage rows, treatment key, scenes
 *   model/…           the original model file(s)
 *   data/…            the original damage spreadsheet
 *   images/<id>/…     the original image files (optional)
 *
 * It is written to and read from the user's computer only.
 */
import { strFromU8, strToU8, Zip, ZipDeflate, ZipPassThrough } from 'fflate';
import { assets, getImageBlob } from '../state/assets';
import { restoreModelFromFiles, confirmDiscard, resetAll } from '../state/actions';
import { get, set, toast, type AppState } from '../state/store';
import { readSpreadsheet } from './spreadsheet';
import { downloadBlob, safeFileName } from './files';
import { forgetImageUrls } from './images';
import { openZip, ZipFormatError } from './zip';
import { makeImageItem, type ImageItem } from './study';

export const PROJECT_EXT = '.vessel';
const FORMAT = 'vessel-study';
const VERSION = 1;

interface ProjectJson {
  format: typeof FORMAT;
  version: number;
  savedAt: string;
  app: string;
  state: Pick<
    AppState,
    | 'study'
    | 'sections'
    | 'heat'
    | 'stats'
    | 'presentation'
    | 'compare'
    | 'viewMode'
    | 'opening'
    | 'vessel'
    | 'step'
    | 'treatments'
    | 'vesselTreatment'
  >;
  model: (Pick<AppState['model'], 'name' | 'format' | 'units' | 'upAxis' | 'rotation' | 'centerlineMode' | 'isDemo'> & { files: string[] }) | null;
  images: (Pick<ImageItem, 'id' | 'fileName' | 'size' | 'manual' | 'excluded'> & { path: string | null })[];
  damage: Omit<AppState['damage'], never> & { path: string | null };
  camera: unknown;
}

type FsHandle = {
  createWritable(): Promise<{ write(data: Blob): Promise<void>; close(): Promise<void> }>;
  name: string;
};
let fileHandle: FsHandle | null = null;

function supportsFsAccess(): boolean {
  return typeof (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker === 'function';
}

export async function saveProject(opts: { includeImages: boolean; saveAs?: boolean }) {
  const s = get();
  if (s.model.status !== 'ready' && s.images.length === 0 && s.damage.rows.length === 0) {
    toast('There is nothing to save yet. Load a model or data first.', 'warning');
    return;
  }
  const suggested = `${safeFileName(s.study.name || 'Untitled study')}${PROJECT_EXT}`;
  // Ask for the destination first (the browser requires a user gesture).
  let handle: FsHandle | null = opts.saveAs ? null : fileHandle;
  if (!handle && supportsFsAccess()) {
    try {
      handle = await (window as unknown as { showSaveFilePicker: (o: unknown) => Promise<FsHandle> }).showSaveFilePicker({
        suggestedName: suggested,
        types: [{ description: 'Vessel study', accept: { 'application/zip': [PROJECT_EXT] } }],
      });
    } catch (e) {
      if ((e as DOMException)?.name === 'AbortError') return;
      handle = null;
    }
  }

  set({ busy: { text: 'Saving the study…', fraction: 0 } });
  try {
    const chunks: Uint8Array[] = [];
    const zip = new Zip((err, chunk) => {
      if (err) throw err;
      chunks.push(chunk);
    });
    const addFile = (path: string, data: Uint8Array, compress: boolean) => {
      const f = compress ? new ZipDeflate(path, { level: 6 }) : new ZipPassThrough(path);
      zip.add(f);
      f.push(data, true);
    };
    const used = new Set<string>();
    const unique = (path: string) => {
      let p = path;
      let k = 2;
      while (used.has(p)) p = path.replace(/(\.[^.]*)?$/, (m) => `-${k++}${m}`);
      used.add(p);
      return p;
    };

    const modelFiles: string[] = [];
    for (const src of assets.model.sources) {
      const path = unique(`model/${safeFileName(src.name, 'model')}`);
      addFile(path, new Uint8Array(await src.blob.arrayBuffer()), true);
      modelFiles.push(path);
    }
    let damagePath: string | null = null;
    if (assets.damageFile) {
      damagePath = unique(`data/${safeFileName(assets.damageFile.name, 'damage.xlsx')}`);
      addFile(damagePath, new Uint8Array(await assets.damageFile.blob.arrayBuffer()), true);
    }
    const imageEntries: ProjectJson['images'] = [];
    const total = s.images.length;
    let done = 0;
    for (const img of s.images) {
      let path: string | null = null;
      if (opts.includeImages) {
        const blob = await getImageBlob(img.id);
        if (blob) {
          path = unique(`images/${img.id}/${safeFileName(img.fileName, 'image')}`);
          const compress = /\.(tiff?|bmp)$/i.test(img.fileName);
          addFile(path, new Uint8Array(await blob.arrayBuffer()), compress);
        }
      }
      imageEntries.push({ id: img.id, fileName: img.fileName, size: img.size, manual: img.manual, excluded: img.excluded, path });
      done++;
      if (done % 20 === 0) {
        set({ busy: { text: `Saving images (${done} of ${total})…`, fraction: done / Math.max(1, total) } });
        await new Promise((r) => setTimeout(r, 0));
      }
    }
    const json: ProjectJson = {
      format: FORMAT,
      version: VERSION,
      savedAt: new Date().toISOString(),
      app: '3D Vessel Model',
      state: {
        study: s.study,
        sections: s.sections,
        heat: s.heat,
        stats: s.stats,
        presentation: s.presentation,
        compare: s.compare,
        viewMode: s.viewMode,
        opening: s.opening,
        vessel: s.vessel,
        step: s.step,
        treatments: s.treatments,
        vesselTreatment: s.vesselTreatment,
      },
      model:
        modelFiles.length > 0
          ? {
              name: s.model.name,
              format: s.model.format,
              units: s.model.units,
              upAxis: s.model.upAxis,
              rotation: s.model.rotation,
              centerlineMode: s.model.centerlineMode,
              isDemo: s.model.isDemo,
              files: modelFiles,
            }
          : null,
      images: imageEntries,
      damage: { ...s.damage, path: damagePath },
      camera: assets.engine?.getCameraState() ?? null,
    };
    addFile('study.json', strToU8(JSON.stringify(json, null, 1)), true);
    zip.end();
    const blob = new Blob(chunks as Uint8Array<ArrayBuffer>[], { type: 'application/zip' });
    if (handle) {
      const w = await handle.createWritable();
      await w.write(blob);
      await w.close();
      fileHandle = handle;
    } else {
      downloadBlob(blob, suggested);
    }
    set({ dirty: false, busy: null });
    toast(`Saved ${handle?.name ?? suggested}${opts.includeImages ? '' : ' (without images)'}.`, 'success');
  } catch (e) {
    set({ busy: null });
    toast(`The study couldn't be saved: ${e instanceof Error ? e.message : String(e)}`, 'error', 8000);
  }
}

function mimeFor(name: string): string {
  const n = name.toLowerCase();
  if (/\.tiff?$/.test(n)) return 'image/tiff';
  if (/\.jpe?g$/.test(n)) return 'image/jpeg';
  if (n.endsWith('.png')) return 'image/png';
  if (n.endsWith('.webp')) return 'image/webp';
  if (n.endsWith('.gif')) return 'image/gif';
  if (n.endsWith('.bmp')) return 'image/bmp';
  return '';
}

export async function openProject(file: File) {
  if (!confirmDiscard()) return;
  set({ busy: { text: `Opening ${file.name}…`, fraction: null } });
  try {
    const zip = await openZip(file);
    if (!zip.has('study.json')) throw new ZipFormatError("This file isn't a 3D Vessel Model study.");
    const json = JSON.parse(strFromU8(await zip.bytes('study.json'))) as ProjectJson;
    if (json.format !== FORMAT) throw new ZipFormatError("This file isn't a 3D Vessel Model study.");
    if (json.version > VERSION) throw new ZipFormatError('This study was saved by a newer version of the app.');
    resetAll();
    forgetImageUrls();
    fileHandle = null;
    let missing = 0;
    const images: ImageItem[] = json.images.map((im) => {
      if (im.path && zip.has(im.path)) {
        const path = im.path;
        assets.images.set(im.id, () => zip.blob(path, mimeFor(im.fileName)));
      } else missing++;
      // Re-derive parsed fields from the file name.
      const parsedItem = { ...im };
      delete (parsedItem as { path?: unknown }).path;
      return reparse(parsedItem);
    });
    if (json.damage.path && zip.has(json.damage.path)) {
      const bytes = await zip.bytes(json.damage.path);
      const name = json.damage.fileName ?? 'damage.xlsx';
      assets.damageFile = { name, blob: new Blob([bytes as Uint8Array<ArrayBuffer>]) };
      try {
        assets.damageSheets = readSpreadsheet(name, bytes);
      } catch {
        assets.damageSheets = null;
      }
    }
    const { path: _damagePath, ...damage } = json.damage;
    // Studies saved before the open/close slider open closed.
    const op = json.state.opening;
    const opening = {
      amount: typeof op?.amount === 'number' && Number.isFinite(op.amount) ? Math.max(0, Math.min(1, op.amount)) : 0,
      side: op?.side === 1 ? (1 as const) : (-1 as const),
    };
    set({
      ...json.state,
      opening,
      images,
      damage,
      dirty: false,
      busy: { text: 'Rebuilding the 3D model…', fraction: null },
    });
    if (json.model && json.model.files.length) {
      const files: File[] = [];
      for (const path of json.model.files) {
        const blob = await zip.blob(path);
        files.push(new File([blob], path.split('/').pop() ?? 'model', { type: blob.type }));
      }
      const { files: _modelFiles, ...meta } = json.model;
      await restoreModelFromFiles(files, meta);
      if (json.camera) window.setTimeout(() => assets.engine?.setCameraState(json.camera as never, false), 50);
    }
    set({ dirty: false, busy: null });
    toast(
      `Opened ${file.name}.` + (missing ? ` ${missing} image${missing === 1 ? ' was' : 's were'} not included; relink them in step 3.` : ''),
      missing ? 'warning' : 'success',
      7000,
    );
  } catch (e) {
    set({ busy: null });
    toast(e instanceof Error ? e.message : `The study couldn't be opened: ${String(e)}`, 'error', 8000);
  }
}

function reparse(im: Pick<ImageItem, 'id' | 'fileName' | 'size' | 'manual' | 'excluded'>): ImageItem {
  const base = makeImageItem(im.fileName, im.size, im.id);
  return { ...base, manual: im.manual, excluded: im.excluded };
}
