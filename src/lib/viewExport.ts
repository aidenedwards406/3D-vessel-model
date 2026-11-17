/** High-resolution images of the 3D views, batch exports and GLB export. */
import { Zip, ZipPassThrough } from 'fflate';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { colorForValue, NO_DATA_HEX, niceTicks, quantize, sampleHex, UNSECTIONED_HEX } from './colormaps';
import { assets } from '../state/assets';
import { getScale, getVessels, type Scale } from '../state/derived';
import { useStore, type AppState } from '../state/store';
import { computeViews, describeTarget, type ViewDescriptor } from '../state/views';
import type { ViewTarget } from './study';
import type { CameraPreset } from '../three/engine';
import { canvasBlob } from './exporters';
import { safeFileName } from './files';

export interface ImageOptions {
  width: number;
  height: number;
  background: 'white' | 'transparent' | 'dark';
  title: boolean;
  legend: boolean;
  markers: boolean;
}

const BG = { white: '#ffffff', dark: '#141413', transparent: null } as const;

function drawLegend(ctx: CanvasRenderingContext2D, scale: Scale, x: number, y: number, w: number, dark: boolean, title = 'Damage (%)', unit = 1) {
  const ink = dark ? '#f0efec' : '#0b0b0b';
  const ink2 = dark ? '#c3c2b7' : '#52514e';
  ctx.save();
  ctx.font = `600 ${13 * unit}px system-ui, sans-serif`;
  ctx.fillStyle = ink;
  ctx.fillText(title, x, y);
  const by = y + 10 * unit;
  const bh = 14 * unit;
  const g = ctx.createLinearGradient(x, 0, x + w, 0);
  if (scale.steps >= 2) {
    for (let i = 0; i < scale.steps; i++) {
      const c = sampleHex(scale.stops, quantize((i + 0.5) / scale.steps, scale.steps));
      g.addColorStop(i / scale.steps, c);
      g.addColorStop((i + 1) / scale.steps - 1e-4, c);
    }
  } else scale.stops.forEach((c, i) => g.addColorStop(i / (scale.stops.length - 1), c));
  ctx.fillStyle = g;
  ctx.fillRect(x, by, w, bh);
  ctx.font = `${11.5 * unit}px system-ui, sans-serif`;
  ctx.fillStyle = ink2;
  ctx.textAlign = 'center';
  for (const t of niceTicks(scale.min, scale.max, 5)) {
    const tx = x + ((t - scale.min) / (scale.max - scale.min || 1)) * w;
    ctx.fillText(String(+t.toFixed(2)), tx, by + bh + 14 * unit);
  }
  // No-data swatch with hatching
  const sx = x + w + 18 * unit;
  ctx.textAlign = 'left';
  ctx.fillStyle = NO_DATA_HEX;
  ctx.fillRect(sx, by, 22 * unit, bh);
  ctx.save();
  ctx.beginPath();
  ctx.rect(sx, by, 22 * unit, bh);
  ctx.clip();
  ctx.strokeStyle = 'rgba(255,255,255,0.6)';
  ctx.lineWidth = 2 * unit;
  for (let k = -bh; k < 22 * unit + bh; k += 6 * unit) {
    ctx.beginPath();
    ctx.moveTo(sx + k, by + bh);
    ctx.lineTo(sx + k + bh, by);
    ctx.stroke();
  }
  ctx.restore();
  ctx.fillStyle = ink2;
  ctx.fillText('No image', sx + 28 * unit, by + bh - 2 * unit);
  ctx.restore();
}

/** Renders the views currently shown in the app (or a given set) into a PNG blob. */
export async function renderViewsPng(opts: ImageOptions, views?: { views: ViewDescriptor[]; columns: number; scale: Scale }): Promise<Blob> {
  const engine = assets.engine;
  if (!engine) throw new Error('The 3D view is not ready.');
  const s = useStore.getState();
  const dark = opts.background === 'dark';
  const set = views ?? computeViews(s, dark);
  const restore = views ? computeViews(s, document.documentElement.getAttribute('data-theme') === 'dark') : null;
  if (views) engine.setViews(set.views, set.columns);
  const unit = Math.max(1, Math.min(opts.width, opts.height) / 900);
  const headerH = opts.title ? Math.round(64 * unit) : 0;
  const legendH = opts.legend && s.viewMode === 'heat' ? Math.round(70 * unit) : 0;
  const img3d = engine.renderImage({
    width: opts.width,
    height: Math.max(64, opts.height - headerH - legendH),
    background: BG[opts.background],
    hideMarkers: !opts.markers,
  });
  if (restore) engine.setViews(restore.views, restore.columns);
  const out = document.createElement('canvas');
  out.width = opts.width;
  out.height = opts.height;
  const ctx = out.getContext('2d')!;
  if (BG[opts.background]) {
    ctx.fillStyle = BG[opts.background]!;
    ctx.fillRect(0, 0, out.width, out.height);
  }
  ctx.drawImage(img3d, 0, headerH, opts.width, img3d.height * (opts.width / img3d.width));
  const ink = dark ? '#f0efec' : '#0b0b0b';
  const ink2 = dark ? '#c3c2b7' : '#52514e';
  if (opts.title) {
    ctx.fillStyle = ink;
    ctx.font = `600 ${22 * unit}px system-ui, sans-serif`;
    ctx.fillText(s.presentation.title || s.study.name || 'Vessel damage', 28 * unit, 34 * unit);
    ctx.fillStyle = ink2;
    ctx.font = `${14 * unit}px system-ui, sans-serif`;
    const sub = set.views.length === 1 ? `${set.views[0].label}${set.views[0].sublabel ? ` · ${set.views[0].sublabel}` : ''}` : s.presentation.subtitle || s.study.partner;
    ctx.fillText(sub, 28 * unit, 56 * unit);
  }
  // Labels for each cell when several views are shown.
  if (set.views.length > 1) {
    const cols = set.columns;
    const rows = Math.ceil(set.views.length / cols);
    const cw = opts.width / cols;
    const ch = img3d.height / rows;
    set.views.forEach((v, i) => {
      const x = (i % cols) * cw + 14 * unit;
      const y = headerH + Math.floor(i / cols) * ch + 24 * unit;
      ctx.fillStyle = ink;
      ctx.font = `600 ${14 * unit}px system-ui, sans-serif`;
      if (v.color) {
        ctx.beginPath();
        ctx.fillStyle = v.color;
        ctx.arc(x + 5 * unit, y - 5 * unit, 5 * unit, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = ink;
      }
      ctx.fillText(v.label, x + (v.color ? 15 * unit : 0), y);
      ctx.fillStyle = ink2;
      ctx.font = `${12 * unit}px system-ui, sans-serif`;
      ctx.fillText(v.sublabel, x, y + 17 * unit);
    });
  }
  if (legendH) {
    drawLegend(ctx, set.scale, 28 * unit, opts.height - legendH + 22 * unit, Math.min(360 * unit, opts.width * 0.4), dark, 'Damage (%)', unit);
  }
  ctx.fillStyle = ink2;
  ctx.font = `${10.5 * unit}px system-ui, sans-serif`;
  ctx.textAlign = 'right';
  const footer = [s.presentation.footer, new Date().toLocaleDateString()].filter(Boolean).join(' · ');
  ctx.fillText(footer, opts.width - 20 * unit, opts.height - 14 * unit);
  return canvasBlob(out);
}

export function singleTargetViews(s: AppState, target: ViewTarget, withMarkers: boolean) {
  const scale = getScale(s, target);
  return { views: [describeTarget(s, target, scale, false, withMarkers)], columns: 1, scale };
}

/** One PNG per vessel (or per treatment average), zipped. */
export async function exportAllPng(kind: 'vessels' | 'groups', opts: ImageOptions, onProgress: (f: number) => void): Promise<Blob> {
  const s = useStore.getState();
  const targets: { name: string; target: ViewTarget }[] =
    kind === 'vessels'
      ? getVessels(s).map((v) => ({ name: v.name, target: { kind: 'vessel', key: v.vKey } }))
      : s.treatments.map((t) => ({ name: t.name, target: { kind: 'group', id: t.id } }));
  const chunks: Uint8Array[] = [];
  const zip = new Zip((err, c) => {
    if (err) throw err;
    chunks.push(c);
  });
  let i = 0;
  for (const t of targets) {
    const blob = await renderViewsPng(opts, singleTargetViews(s, t.target, opts.markers));
    const f = new ZipPassThrough(`${safeFileName(t.name)}.png`);
    zip.add(f);
    f.push(new Uint8Array(await blob.arrayBuffer()), true);
    onProgress(++i / targets.length);
    await new Promise((r) => setTimeout(r, 0));
  }
  zip.end();
  return new Blob(chunks as Uint8Array<ArrayBuffer>[], { type: 'application/zip' });
}

/** Renders a target from a camera preset (used by the PDF report). */
export async function renderTargetImage(target: ViewTarget, preset: CameraPreset, width: number, height: number): Promise<HTMLCanvasElement> {
  const engine = assets.engine!;
  const s = useStore.getState();
  const cam = engine.getCameraState();
  engine.setCameraPreset(preset, false, width / height);
  const set = singleTargetViews(s, target, false);
  engine.setViews(set.views, 1);
  const c = engine.renderImage({ width, height, background: '#ffffff', hideMarkers: true });
  const restore = computeViews(s, document.documentElement.getAttribute('data-theme') === 'dark');
  engine.setViews(restore.views, restore.columns);
  engine.setCameraState(cam, false);
  return c;
}

export async function exportGlb(): Promise<Blob> {
  const engine = assets.engine;
  if (!engine) throw new Error('The 3D view is not ready.');
  const s = useStore.getState();
  const scale = getScale(s);
  const mode = s.viewMode;
  const mesh = engine.bakedMesh(0, (norm, region) => {
    if (!region) return UNSECTIONED_HEX;
    if (mode !== 'heat') return '#d8cfc6';
    if (norm === null) return NO_DATA_HEX;
    return colorForValue(scale.min + norm * (scale.max - scale.min), scale);
  });
  if (!mesh) throw new Error('No model to export.');
  const exporter = new GLTFExporter();
  const result = await exporter.parseAsync(mesh, { binary: true });
  mesh.geometry.dispose();
  return new Blob([result as ArrayBuffer], { type: 'model/gltf-binary' });
}
