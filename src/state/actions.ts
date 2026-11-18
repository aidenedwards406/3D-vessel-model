/** Study actions: loading models, images, spreadsheets, treatments, demo. */
import * as THREE from 'three';
import type { WorkerRequest, WorkerResponse } from '../geometry/geometry.worker';
import type { ProcessResult } from '../geometry/process';
import { writeBinaryStl } from '../geometry/tube';
import { buildDemoStudy, demoWorkbook, renderDemoImage } from '../lib/demo';
import { forgetImageUrls, isImageFile } from '../lib/images';
import {
  extractDamage,
  extractTreatmentKey,
  guessDamageMapping,
  guessRole,
  guessTreatmentKeyMapping,
  treatmentKeyFromDamageRows,
  type DamageMapping,
  type TreatmentKeyEntry,
} from '../lib/importers';
import { stripExtension, vesselKey, type Side } from '../lib/naming';
import { readSpreadsheet, SpreadsheetError } from '../lib/spreadsheet';
import { makeImageItem, uid, type ImageItem, type Placement, type Treatment, type TreatmentRole } from '../lib/study';
import { loadModelFiles, ModelLoadError } from '../three/loaders';
import type { CameraState, CameraView, OpenMotion } from '../three/engine';
import type { HingeSide } from '../geometry/opening';
import { assets, clearImageAssets } from './assets';
import { getDerived, getVessels } from './derived';
import { emptyModel, get, initialState, set, toast, update, type Scene, type StepId, type UpAxis } from './store';

// ── Geometry worker ─────────────────────────────────────────────────────────

let worker: Worker | null = null;
let reqId = 0;

function getWorker(): Worker {
  worker ??= new Worker(new URL('../geometry/geometry.worker.ts', import.meta.url), { type: 'module' });
  return worker;
}

type ProcessMessage =
  | { type: 'process'; kind: 'stl'; buffer: ArrayBuffer; mode: 'auto' | 'straight' }
  | { type: 'process'; kind: 'mesh'; positions: Float32Array; index: Uint32Array | null; mode: 'auto' | 'straight' };

function runWorker(msg: ProcessMessage, transfer: Transferable[]): Promise<ProcessResult> {
  const id = ++reqId;
  return new Promise((resolve, reject) => {
    const w = getWorker();
    const onMessage = (e: MessageEvent<WorkerResponse>) => {
      const d = e.data;
      if (d.id !== id) return;
      if (d.type === 'progress') {
        set((s) => ({ model: { ...s.model, progress: { stage: d.stage, fraction: d.fraction } } }));
        return;
      }
      w.removeEventListener('message', onMessage);
      w.removeEventListener('error', onError);
      if (d.type === 'done') resolve(d.result);
      else reject(new Error(d.message));
    };
    const onError = (e: ErrorEvent) => {
      w.removeEventListener('message', onMessage);
      w.removeEventListener('error', onError);
      worker?.terminate();
      worker = null;
      reject(new Error(e.message || 'The model is too large to analyse in this browser.'));
    };
    w.addEventListener('message', onMessage);
    w.addEventListener('error', onError);
    w.postMessage({ ...msg, id } as WorkerRequest, transfer);
  });
}

let lastInput:
  | { kind: 'stl'; buffer: ArrayBuffer }
  | { kind: 'mesh'; positions: Float32Array; index: Uint32Array | null }
  | null = null;

function average(a: Float32Array) {
  let s = 0;
  for (const x of a) s += x;
  return a.length ? s / a.length : 0;
}

async function processCurrent(mode: 'auto' | 'straight') {
  if (!lastInput) return;
  set((s) => ({
    model: { ...s.model, status: 'processing', progress: { stage: 'Analysing the vessel shape', fraction: 0.05 }, error: null },
  }));
  const msg: ProcessMessage =
    lastInput.kind === 'stl'
      ? { type: 'process', kind: 'stl', buffer: lastInput.buffer.slice(0), mode }
      : {
          type: 'process',
          kind: 'mesh',
          positions: lastInput.positions.slice(),
          index: lastInput.index ? lastInput.index.slice() : null,
          mode,
        };
  const transfer: Transferable[] =
    msg.kind === 'stl' ? [msg.buffer] : [msg.positions.buffer, ...(msg.index ? [msg.index.buffer] : [])];
  try {
    const result = await runWorker(msg, transfer);
    assets.model.result = result;
    const box = new THREE.Box3().setFromArray(result.positions);
    const diag = box.getSize(new THREE.Vector3()).length();
    set((s) => ({
      model: {
        ...s.model,
        status: 'ready',
        progress: null,
        vertexCount: result.vertexCount,
        triangleCount: result.triangleCount,
        length: result.length,
        meanRadius: average(result.radiusMean),
        method: result.method,
        quality: result.quality,
        warnings: result.warnings,
        centerlineMode: mode,
        units: s.model.revision === 0 || s.model.units === 'mm' ? (diag < 1.5 ? 'm' : 'mm') : s.model.units,
        revision: s.model.revision + 1,
      },
      dirty: true,
    }));
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    set((s) => ({ model: { ...s.model, status: 'error', progress: null, error: message } }));
    toast(`The model couldn't be analysed: ${message}`, 'error', 7000);
  }
}

export async function loadModel(files: File[]) {
  if (files.length === 0) return;
  const prev = get().model;
  set({
    model: {
      ...emptyModel,
      status: 'loading',
      name: files[0].name,
      revision: prev.revision,
      progress: { stage: 'Reading the file', fraction: 0.02 },
    },
  });
  try {
    const loaded = await loadModelFiles(files);
    if (loaded.format === 'stl') {
      lastInput = { kind: 'stl', buffer: loaded.buffer };
      assets.model.original = null;
    } else {
      lastInput = { kind: 'mesh', positions: loaded.positions, index: loaded.index };
      assets.model.original = loaded.object;
    }
    assets.model.sources = files.map((f) => ({ name: f.name, blob: f }));
    set((s) => ({
      model: {
        ...s.model,
        name: loaded.name,
        format: loaded.format,
        size: loaded.size,
        hasTexture: loaded.format !== 'stl' && loaded.hasTexture,
        upAxis: 'y',
        rotation: null,
        isDemo: false,
      },
    }));
    await processCurrent('auto');
    if (get().model.status === 'ready') {
      toast(`Loaded ${loaded.name}.`, 'success');
      // glTF is Y-up by definition. Other formats: if the model clearly lies flat in
      // another plane (e.g. a Z-up CAD export), use that plane's normal as "up".
      const r = assets.model.result;
      if (r && loaded.format !== 'glb' && loaded.format !== 'gltf') {
        const size = new THREE.Box3().setFromArray(r.positions).getSize(new THREE.Vector3());
        const ext = [size.x, size.y, size.z];
        const order = [0, 1, 2].sort((a, b) => ext[a] - ext[b]);
        const thin = order[0];
        if (thin !== 1 && ext[thin] < 0.5 * ext[order[1]]) {
          const axis: UpAxis = thin === 2 ? 'z' : 'x';
          update((st) => ({ model: { ...st.model, upAxis: axis, rotation: null } }));
          toast(
            `The model lies flat with +${axis.toUpperCase()} pointing up, so top and bottom are measured from +${axis.toUpperCase()}. Change it in step 1 if needed.`,
            'info',
            8000,
          );
        }
      }
      if (get().viewMode === 'original' && !get().model.hasTexture) set({ viewMode: 'sections' });
    }
  } catch (e) {
    const message =
      e instanceof ModelLoadError ? e.message : `The file couldn't be opened${e instanceof Error ? `: ${e.message}` : '.'}`;
    set((s) => ({ model: { ...s.model, status: 'error', progress: null, error: message } }));
    toast(message, 'error', 7000);
  }
}

export function setCenterlineMode(mode: 'auto' | 'straight') {
  if (get().model.centerlineMode === mode && get().model.status === 'ready') return;
  void processCurrent(mode);
}

export function setUpAxis(upAxis: UpAxis) {
  update((s) => ({ model: { ...s.model, upAxis, rotation: null } }));
}

export function orientationQuaternion(upAxis: UpAxis, rotation: [number, number, number, number] | null): THREE.Quaternion {
  if (rotation) return new THREE.Quaternion(...rotation);
  const q = new THREE.Quaternion();
  const X = new THREE.Vector3(1, 0, 0);
  const Z = new THREE.Vector3(0, 0, 1);
  switch (upAxis) {
    case 'z':
      return q.setFromAxisAngle(X, -Math.PI / 2);
    case '-z':
      return q.setFromAxisAngle(X, Math.PI / 2);
    case 'x':
      return q.setFromAxisAngle(Z, Math.PI / 2);
    case '-x':
      return q.setFromAxisAngle(Z, -Math.PI / 2);
    case '-y':
      return q.setFromAxisAngle(X, Math.PI);
    default:
      return q;
  }
}

/** Rotates the model so it lies flat: length along X, plane of the curve horizontal. */
export function layFlat() {
  const r = assets.model.result;
  if (!r) return;
  const M = r.centerline.length / 3;
  const c = new THREE.Vector3();
  for (let k = 0; k < M; k++) c.add(new THREE.Vector3(r.centerline[3 * k], r.centerline[3 * k + 1], r.centerline[3 * k + 2]));
  c.divideScalar(M);
  const cov = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  for (let k = 0; k < M; k++) {
    const d = [r.centerline[3 * k] - c.x, r.centerline[3 * k + 1] - c.y, r.centerline[3 * k + 2] - c.z];
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) cov[3 * i + j] += d[i] * d[j];
  }
  const mat = (v: THREE.Vector3) =>
    new THREE.Vector3(
      cov[0] * v.x + cov[1] * v.y + cov[2] * v.z,
      cov[3] * v.x + cov[4] * v.y + cov[5] * v.z,
      cov[6] * v.x + cov[7] * v.y + cov[8] * v.z,
    );
  const power = (start: THREE.Vector3, deflate: THREE.Vector3[]) => {
    let v = start.clone().normalize();
    for (let i = 0; i < 100; i++) {
      v = mat(v);
      for (const d of deflate) v.addScaledVector(d, -v.dot(d));
      if (v.lengthSq() < 1e-20) break;
      v.normalize();
    }
    return v;
  };
  const e1 = power(new THREE.Vector3(1, 0.3, 0.2), []);
  const e2 = power(new THREE.Vector3(0.2, 1, 0.4), [e1]);
  const l1 = mat(e1).length();
  const l2 = mat(e2).length();
  const cur = orientationQuaternion(get().model.upAxis, get().model.rotation);
  const currentUp = new THREE.Vector3(0, 1, 0).applyQuaternion(cur.clone().invert());
  let up: THREE.Vector3;
  if (l2 > l1 * 0.02) {
    // Curved in a plane: its normal becomes "up".
    up = new THREE.Vector3().crossVectors(e1, e2).normalize();
    if (up.dot(currentUp) < 0) up.negate();
  } else {
    // Essentially straight: keep the current up as far as possible.
    up = currentUp.clone().addScaledVector(e1, -currentUp.dot(e1)).normalize();
  }
  let x = e1.clone();
  const xWorld = x.clone().applyQuaternion(cur);
  if (xWorld.x < 0) x.negate();
  x = x.addScaledVector(up, -x.dot(up)).normalize();
  const z = new THREE.Vector3().crossVectors(x, up).normalize();
  const m = new THREE.Matrix4().makeBasis(x, up, z).transpose();
  const q = new THREE.Quaternion().setFromRotationMatrix(m);
  update((s) => ({ model: { ...s.model, rotation: [q.x, q.y, q.z, q.w] } }));
  toast('Model laid flat. Check that "top" is still the side you expect.', 'info');
}

// ── Images ──────────────────────────────────────────────────────────────────

export function addImageFiles(files: File[]) {
  const imgs = files.filter((f) => isImageFile(f.name));
  if (imgs.length === 0) {
    toast('No image files were found. Supported: TIFF, JPEG, PNG, BMP, GIF, WebP.', 'warning');
    return;
  }
  const existing = new Set(get().images.map((i) => i.key));
  const added: ImageItem[] = [];
  let dup = 0;
  for (const f of imgs) {
    const item = makeImageItem(f.name, f.size);
    if (existing.has(item.key)) {
      dup++;
      continue;
    }
    existing.add(item.key);
    assets.images.set(item.id, f);
    added.push(item);
  }
  update((s) => ({ images: [...s.images, ...added] }));
  afterDataChange();
  const unplaced = added.filter((i) => !i.parsed).length;
  const overlays = added.filter((i) => i.parsed?.overlay).length;
  const parts = [`Added ${added.length} image${added.length === 1 ? '' : 's'}`];
  if (overlays) parts.push(`${overlays} traced outline${overlays === 1 ? '' : 's'}`);
  if (unplaced) parts.push(`${unplaced} need${unplaced === 1 ? 's' : ''} placing by hand`);
  if (dup) parts.push(`${dup} duplicate${dup === 1 ? '' : 's'} skipped`);
  toast(`${parts.join(' · ')}.`, unplaced ? 'warning' : 'success', 6000);
}

/** Keeps the section count and current vessel consistent with the data. */
function afterDataChange() {
  const s = get();
  const d = getDerived(s);
  if (d.maxSection > s.sections.count) {
    const count = Math.min(24, d.maxSection);
    update((st) => ({ sections: { ...st.sections, count, boundaries: null } }));
    toast(`The data uses ${count} sections, so the model is now split into ${count}.`, 'info', 6000);
  }
  const vessels = getVessels(get());
  if (vessels.length && !vessels.some((v) => v.vKey === get().vessel)) set({ vessel: vessels[0].vKey });
}

export function placeImage(id: string, placement: Placement | null) {
  update((s) => ({ images: s.images.map((i) => (i.id === id ? { ...i, manual: placement, excluded: false } : i)) }));
  afterDataChange();
}

export function setImageExcluded(id: string, excluded: boolean) {
  update((s) => ({ images: s.images.map((i) => (i.id === id ? { ...i, excluded } : i)) }));
}

export function removeAllImages() {
  clearImageAssets();
  forgetImageUrls();
  update({ images: [], selection: null });
}

// ── Damage spreadsheet ──────────────────────────────────────────────────────

export async function loadDamageFile(file: File) {
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const sheets = readSpreadsheet(file.name, bytes);
    assets.damageSheets = sheets;
    assets.damageFile = { name: file.name, blob: file };
    const mapping = guessDamageMapping(sheets);
    applyDamageMapping(mapping, file.name);
    const rows = get().damage.rows;
    // A treatment key sheet in the same workbook, or a treatment column.
    let entries: TreatmentKeyEntry[] = [];
    const vessels = getVessels(get()).map((v) => v.name);
    const keyIdx = sheets.findIndex((s, i) => i !== mapping.sheetIndex && /treat|key|group|condition/i.test(s.name));
    if (keyIdx >= 0) {
      const m = guessTreatmentKeyMapping([sheets[keyIdx]], vessels);
      entries = extractTreatmentKey([sheets[keyIdx]], m);
    }
    if (entries.length === 0) entries = treatmentKeyFromDamageRows(rows);
    if (entries.length) applyTreatmentEntries(entries);
    if (rows.length) set({ viewMode: 'heat' });
    const skipped = get().damage.skipped.length;
    const unparsed = getDerived(get()).unparsedRows.length;
    toast(
      `Read ${rows.length} damage value${rows.length === 1 ? '' : 's'} from ${file.name}` +
        (skipped ? ` · ${skipped} row${skipped === 1 ? '' : 's'} skipped` : '') +
        (unparsed ? ` · ${unparsed} name${unparsed === 1 ? '' : 's'} not recognised` : '') +
        (entries.length ? ` · treatments for ${entries.length} vessel${entries.length === 1 ? '' : 's'}` : '') +
        '.',
      skipped || unparsed ? 'warning' : 'success',
      7000,
    );
  } catch (e) {
    toast(e instanceof SpreadsheetError ? e.message : `The spreadsheet couldn't be read: ${String(e)}`, 'error', 8000);
  }
}

export function applyDamageMapping(mapping: DamageMapping, fileName?: string) {
  const sheets = assets.damageSheets;
  if (!sheets) return;
  const res = extractDamage(sheets, mapping);
  update((s) => ({
    damage: {
      fileName: fileName ?? s.damage.fileName,
      mapping,
      rows: res.rows,
      skipped: res.skipped,
      ambiguousUnits: res.ambiguousUnits,
      percentFormatted: res.percentFormatted,
      sheetNames: sheets.map((x) => x.name),
    },
  }));
  afterDataChange();
}

export function clearDamage() {
  assets.damageSheets = null;
  assets.damageFile = null;
  update((s) => ({
    damage: { ...initialState().damage },
    viewMode: s.viewMode === 'heat' ? 'sections' : s.viewMode,
  }));
}

// ── Treatments ──────────────────────────────────────────────────────────────

const ROLE_ORDER: Record<TreatmentRole, number> = { control: 0, investigational: 1, standard: 2, other: 3 };

function nextFreeSlot(ts: Treatment[]): number {
  const used = new Set(ts.map((t) => t.slot));
  for (let i = 0; i < 8; i++) if (!used.has(i)) return i;
  return ts.length % 8;
}

export function applyTreatmentEntries(entries: TreatmentKeyEntry[]) {
  const s = get();
  const treatments = [...s.treatments];
  const byName = new Map(treatments.map((t) => [t.name.toLowerCase(), t]));
  const newNames: string[] = [];
  for (const e of entries) {
    const n = e.treatment.trim();
    if (n && !byName.has(n.toLowerCase()) && !newNames.some((x) => x.toLowerCase() === n.toLowerCase())) newNames.push(n);
  }
  newNames.sort((a, b) => ROLE_ORDER[guessRole(a)] - ROLE_ORDER[guessRole(b)]);
  for (const name of newNames) {
    const t: Treatment = { id: uid('t'), name, slot: nextFreeSlot(treatments), role: guessRole(name) };
    treatments.push(t);
    byName.set(name.toLowerCase(), t);
  }
  const vt = { ...s.vesselTreatment };
  for (const e of entries) {
    const t = byName.get(e.treatment.trim().toLowerCase());
    if (t) vt[vesselKey(e.vessel)] = t.id;
  }
  treatments.sort((a, b) => ROLE_ORDER[a.role] - ROLE_ORDER[b.role]);
  update({ treatments, vesselTreatment: vt });
}

export async function loadTreatmentKeyFile(file: File) {
  try {
    const sheets = readSpreadsheet(file.name, new Uint8Array(await file.arrayBuffer()));
    const vessels = getVessels(get()).map((v) => v.name);
    const m = guessTreatmentKeyMapping(sheets, vessels);
    const entries = extractTreatmentKey(sheets, m);
    if (entries.length === 0) {
      toast("No bioreactor → treatment pairs were found. Use two columns: bioreactor ID and treatment.", 'warning', 7000);
      return;
    }
    applyTreatmentEntries(entries);
    const known = new Set(vessels.map(vesselKey));
    const unknown = entries.filter((e) => known.size && !known.has(vesselKey(e.vessel))).length;
    toast(
      `Assigned treatments to ${entries.length} vessel${entries.length === 1 ? '' : 's'}` +
        (unknown ? ` (${unknown} ID${unknown === 1 ? '' : 's'} not in the data yet)` : '') +
        '.',
      'success',
    );
  } catch (e) {
    toast(e instanceof SpreadsheetError ? e.message : `The treatment key couldn't be read: ${String(e)}`, 'error', 7000);
  }
}

export function addTreatment(name: string): Treatment | null {
  const n = name.trim();
  if (!n) return null;
  const s = get();
  const existing = s.treatments.find((t) => t.name.toLowerCase() === n.toLowerCase());
  if (existing) return existing;
  const t: Treatment = { id: uid('t'), name: n, slot: nextFreeSlot(s.treatments), role: guessRole(n) };
  update({ treatments: [...s.treatments, t] });
  return t;
}

export function updateTreatment(id: string, patch: Partial<Treatment>) {
  update((s) => ({ treatments: s.treatments.map((t) => (t.id === id ? { ...t, ...patch } : t)) }));
}

export function removeTreatment(id: string) {
  update((s) => {
    const vt = { ...s.vesselTreatment };
    for (const k of Object.keys(vt)) if (vt[k] === id) delete vt[k];
    return { treatments: s.treatments.filter((t) => t.id !== id), vesselTreatment: vt };
  });
}

export function moveTreatment(id: string, dir: -1 | 1) {
  update((s) => {
    const arr = [...s.treatments];
    const i = arr.findIndex((t) => t.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= arr.length) return {};
    [arr[i], arr[j]] = [arr[j], arr[i]];
    return { treatments: arr };
  });
}

export function setVesselTreatment(vKeys: string[], treatmentId: string | null) {
  update((s) => {
    const vt = { ...s.vesselTreatment };
    for (const k of vKeys) {
      if (treatmentId) vt[k] = treatmentId;
      else delete vt[k];
    }
    return { vesselTreatment: vt };
  });
}

// ── Navigation & selection ──────────────────────────────────────────────────

export function goToStep(step: StepId) {
  const s = get();
  const patch: Partial<ReturnType<typeof get>> = { step, placing: null };
  if (step === 'sections' && s.viewMode !== 'original') patch.viewMode = 'sections';
  if ((step === 'explore' || step === 'damage') && s.damage.rows.length) patch.viewMode = 'heat';
  if (step === 'compare' && s.damage.rows.length) patch.viewMode = 'heat';
  set(patch);
}

export function selectLocation(vKey: string | null, section: number, side: Side, position: string, groupId: string | null = null) {
  set((s) => ({ selection: { vKey, groupId, section, side, position }, vessel: vKey ?? s.vessel }));
}

export function clearSelection() {
  set({ selection: null });
}

export function stepVessel(dir: -1 | 1) {
  const s = get();
  const vessels = getVessels(s);
  if (!vessels.length) return;
  const i = Math.max(0, vessels.findIndex((v) => v.vKey === s.vessel));
  const next = vessels[(i + dir + vessels.length) % vessels.length];
  set({
    vessel: next.vKey,
    selection: s.selection && s.selection.vKey ? { ...s.selection, vKey: next.vKey } : s.selection,
  });
}

// ── Opening the vessel ──────────────────────────────────────────────────────

/**
 * Opens the vessel lengthways like a book (0 = closed, 1 = fully open). When it starts
 * to open, the hinge goes on the side facing away from the camera, so the top half lifts
 * away and its inside turns towards the viewer.
 */
export function setOpening(amount: number, opts: { motion?: OpenMotion; side?: HingeSide } = {}) {
  const s = get();
  const a = Math.max(0, Math.min(1, Number.isFinite(amount) ? amount : 0));
  let side = opts.side ?? s.opening.side;
  if (!opts.side && s.opening.amount <= 0 && a > 0) side = assets.engine?.preferredHingeSide() ?? side;
  if (a !== s.opening.amount || side !== s.opening.side) set({ opening: { amount: a, side } });
  assets.engine?.setOpening(a, side, opts.motion ?? 'instant');
}

/** Closes an open vessel, or opens a closed one fully. */
export function toggleOpening() {
  setOpening(get().opening.amount > 0 ? 0 : 1, { motion: 'animate' });
}

// ── Presentation scenes ─────────────────────────────────────────────────────

export function addScene(camera: CameraState, title?: string, view?: CameraView) {
  const s = get();
  const vessel = getVessels(s).find((v) => v.vKey === s.vessel);
  const scene: Scene = {
    id: uid('scene'),
    title:
      title ??
      (s.step === 'compare'
        ? s.compare.layout === 'all'
          ? 'All vessels'
          : s.compare.layout === 'groups'
            ? 'Treatment averages'
            : 'Side-by-side comparison'
        : (vessel?.name ?? 'View')),
    step: s.step === 'compare' ? 'compare' : 'explore',
    mode: s.viewMode,
    vessel: s.vessel,
    compare: s.compare,
    camera,
    view: view ?? assets.engine?.getCameraView(),
    opening: { ...s.opening },
  };
  update((st) => ({ presentation: { ...st.presentation, scenes: [...st.presentation.scenes, scene] } }));
  toast(`Added "${scene.title}" to the presentation.`, 'success');
}

export function applyScene(scene: Scene) {
  set({
    step: scene.step,
    viewMode: scene.mode,
    vessel: scene.vessel,
    compare: scene.compare,
    selection: null,
  });
  // Open or close the vessel as it was when the scene was saved (older scenes leave it as it is).
  if (scene.opening) setOpening(scene.opening.amount, { side: scene.opening.side === 1 ? 1 : -1, motion: 'animate' });
  // Wait for the layout to update, then frame the saved view for this screen.
  window.setTimeout(() => {
    const eng = assets.engine;
    if (!eng) return;
    if (scene.view) eng.setCameraView(scene.view, true);
    else eng.setCameraState(scene.camera, true);
  }, 60);
}

// ── Study lifecycle ─────────────────────────────────────────────────────────

export function resetAll() {
  lastInput = null;
  assets.model.result = null;
  assets.model.original = null;
  assets.model.sources = [];
  assets.damageSheets = null;
  assets.damageFile = null;
  clearImageAssets();
  forgetImageUrls();
  const theme = get().theme;
  const revision = get().model.revision + 1;
  set({ ...initialState(), theme, model: { ...emptyModel, revision } });
}

export function confirmDiscard(): boolean {
  return !get().dirty || window.confirm('Discard the current study? Unsaved changes will be lost.');
}

export function newStudy() {
  if (!confirmDiscard()) return;
  resetAll();
}

/** Restores processed geometry after opening a saved project. */
export async function restoreModelFromFiles(files: File[], meta: Partial<ReturnType<typeof get>['model']>) {
  await loadModel(files);
  update((s) => ({ model: { ...s.model, ...meta, status: s.model.status, revision: s.model.revision } }));
  if (meta.centerlineMode === 'straight') await processCurrent('straight');
}

export async function loadDemo() {
  if (!confirmDiscard()) return;
  resetAll();
  set({ busy: { text: 'Building the demo study…', fraction: null } });
  try {
    const demo = buildDemoStudy();
    const stl = writeBinaryStl(demo.mesh.positions, demo.mesh.index, 'Synthetic demo vessel mimic');
    lastInput = { kind: 'stl', buffer: stl };
    assets.model.sources = [{ name: 'demo-vessel.stl', blob: new Blob([stl], { type: 'model/stl' }) }];
    set((s) => ({
      model: { ...s.model, name: 'demo-vessel.stl', format: 'stl', size: stl.byteLength, isDemo: true, units: 'mm' },
      study: { name: 'Demo study (synthetic data)', partner: 'Example partner', notes: '' },
      presentation: {
        ...s.presentation,
        title: 'Catheter navigation study',
        subtitle: 'Wall damage by treatment · synthetic demo data',
        footer: 'Synthetic demo data · not for distribution',
      },
    }));
    const processing = processCurrent('auto');
    const items = demo.images.map((spec) => {
      const item = makeImageItem(spec.fileName, 0);
      const label = stripExtension(spec.fileName);
      assets.images.set(item.id, () => renderDemoImage(spec, label));
      return item;
    });
    set({ images: items });
    const wb = demoWorkbook(demo);
    await loadDamageFile(new File([wb], 'demo-damage.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
    await processing;
    const vessels = getVessels(get());
    const showcase = [...vessels].sort((a, b) => (b.mean ?? 0) - (a.mean ?? 0))[0] ?? vessels[0];
    set({ step: 'explore', viewMode: 'heat', vessel: showcase?.vKey ?? null, dirty: false, busy: null, toasts: [] });
    toast('Demo study loaded. Everything in it is synthetic.', 'success', 5000);
  } catch (e) {
    set({ busy: null });
    toast(`The demo couldn't be built: ${String(e)}`, 'error', 8000);
  }
}

export function downloadDemoFiles(): { stl: Blob; xlsx: Blob } {
  const demo = buildDemoStudy();
  return {
    stl: new Blob([writeBinaryStl(demo.mesh.positions, demo.mesh.index, 'Synthetic demo vessel mimic')], { type: 'model/stl' }),
    xlsx: new Blob([demoWorkbook(demo)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
  };
}

export { processCurrent };
