/**
 * VesselEngine – the 3D viewer.
 *
 *  - One WebGL canvas; any number of views drawn side by side (scissor), all
 *    sharing one camera so they rotate together.
 *  - Region shader for sections / heat map; BVH-accelerated picking.
 *  - Markers at each imaged location, section labels, cut rings, centerline.
 *  - Opening the vessel lengthways like a book (top half on a hinge), with
 *    markers, labels, rings and picking following the opened halves.
 *  - High-resolution image export and GLB export with baked colours.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';
import { MeshBVH } from 'three-mesh-bvh';
import type { ProcessResult } from '../geometry/process';
import { computeFrames, frameAt, vertexAngles, type Frames } from '../geometry/frames';
import {
  computeSpine,
  hingeAt,
  openAngle,
  openPoint,
  openPositions,
  preferredHingeSide,
  smoothProfile,
  type HingeSide,
  type Spine,
} from '../geometry/opening';
import {
  endT,
  locateRegion,
  MAX_SECTIONS,
  REGION_COUNT,
  regionCenter,
  sectionCenterT,
  topness,
  type Layout,
  type Region,
} from '../lib/regions';
import {
  createMarkerMaterial,
  createRegionMaterial,
  createRegionUniforms,
  HALF_ALL,
  HALF_BOTTOM,
  HALF_TOP,
  makeDataTexture,
  makeLutTexture,
  makeSpineTexture,
  type RegionUniforms,
} from './regionMaterial';

export type ViewMode = 'plain' | 'sections' | 'heat' | 'original';

export interface MarkerSpec {
  key: string;
  section: number;
  side: 'T' | 'B';
  slot: number;
  /** sRGB hex colour of the marker fill. */
  color: string;
}

export interface EngineView {
  key: string;
  /** Normalised values per region (NaN = no data). */
  values: Float32Array;
  markers: MarkerSpec[] | null;
  /** Optional colour map for this view only (e.g. a diverging scale for differences). */
  lut?: { data: Uint8Array; stepped: boolean } | null;
}

export interface PickInfo {
  viewIndex: number;
  region: Region | null;
  markerKey: string | null;
  clientX: number;
  clientY: number;
}

export interface CameraState {
  position: [number, number, number];
  target: [number, number, number];
  zoom?: number;
}

/** Viewport-independent camera: direction, zoom relative to a perfect fit, and pan target. */
export interface CameraView {
  dir: [number, number, number];
  ratio: number;
  target: [number, number, number];
}

export type CameraPreset = 'top' | 'bottom' | 'front' | 'back' | 'left' | 'right' | 'iso' | 'fit';

/** How the vessel moves to a new opening: see VesselEngine.setOpening. */
export type OpenMotion = 'instant' | 'animate' | 'drag';

/** Screen space (px) to keep clear at the right edge of the 3D view: the open/close slider plus half an end label. */
const SIDE_RESERVE_PX = 88;

export interface ViewRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Where an HTML label (section number, end) is pinned to the model. */
export interface LabelAnchor {
  id: string;
  text: string;
  kind: 'section' | 'end';
  /** World position with the vessel closed. */
  pos: THREE.Vector3;
  /** Model-space position with the vessel closed. */
  base: THREE.Vector3;
  /** Position along the centerline. */
  aT: number;
}

interface MarkerPlace {
  key: string;
  /** Position as drawn now (model space): follows the top half when the vessel is open. */
  pos: THREE.Vector3;
  /** Position with the vessel closed: just outside the outer wall. */
  base: THREE.Vector3;
  /** Just inside the inner (luminal) wall: the side that faces the viewer once the vessel is open. */
  inner: THREE.Vector3;
  aT: number;
  top: boolean;
}

interface ViewState {
  key: string;
  texture: THREE.DataTexture;
  lut: THREE.DataTexture | null;
  lutSig: string;
  markers: MarkerSpec[] | null;
  points: THREE.Points | null;
  markerWorld: MarkerPlace[];
}

const UP = new THREE.Vector3(0, 1, 0);

function lutHash(d: Uint8Array): string {
  let h = 2166136261;
  for (let i = 0; i < d.length; i++) h = Math.imul(h ^ d[i], 16777619);
  return `${d.length}:${(h >>> 0).toString(36)}`;
}

export class VesselEngine {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: OrbitControls;
  private container: HTMLElement;
  private uniforms: RegionUniforms;
  private material: THREE.MeshStandardMaterial;
  /** Draws the bottom half while the vessel is open (the main material then draws the top half). */
  private materialBottom: THREE.MeshStandardMaterial;
  private halfTop: THREE.IUniform<number> = { value: HALF_ALL };
  private markerMaterial: THREE.ShaderMaterial;
  private globalLut: THREE.DataTexture;
  private root = new THREE.Group(); // display transform (orientation + centring)
  private model = new THREE.Group(); // model space
  private mesh: THREE.Mesh | null = null;
  private meshBottom: THREE.Mesh | null = null;
  private original: THREE.Object3D | null = null;
  private bvh: MeshBVH | null = null;
  private result: ProcessResult | null = null;
  private renderToWelded: Uint32Array | null = null;
  private frames: Frames | null = null;
  private anglesWelded: Float32Array | null = null;
  private layout: Layout | null = null;
  private mode: ViewMode = 'plain';
  private views: ViewState[] = [];
  private columns = 1;
  private rects: ViewRect[] = [];
  private centerlineLine: THREE.Line | null = null;
  private cutRings = new THREE.Group();
  private ringArcs: { line: THREE.Line; base: Float32Array; aT: number; top: boolean }[] = [];
  // Opening the vessel (see geometry/opening.ts)
  private radius: Float32Array | null = null; // smoothed wall radius along the centerline
  private spine: Spine | null = null;
  private spineVersion = 0;
  private openAmount = 0; // as drawn now, 0 (closed) … 1 (180°)
  private openTarget = 0;
  private openSide: HingeSide = -1;
  private openTween: { from: number; to: number; start: number; duration: number } | null = null;
  /** Opening to continue with after closing, when the hinge moves to the other side. */
  private openNext: { amount: number; side: HingeSide } | null = null;
  /** The mesh turned as the top half, for clicking on the open vessel (built on first use). */
  private topPick: { geometry: THREE.BufferGeometry; bvh: MeshBVH; positions: Float32Array; angle: number; version: number } | null = null;
  private topWelded: Float32Array | null = null;
  private prewarmTimer: number | undefined;
  private needsRender = true;
  private raf = 0;
  private disposed = false;
  private resizeObserver: ResizeObserver;
  private tween: { from: CameraState; to: CameraState; start: number; duration: number } | null = null;
  private hover: { view: number; region: number } = { view: -1, region: -1 };
  private hoverMarker: string | null = null;
  private selectedMarker: string | null = null;
  private pointerDown: { x: number; y: number; t: number } | null = null;
  private pendingMove: PointerEvent | null = null;
  private orientation = new THREE.Quaternion();
  private showMarkers = true;
  private showCenterline = false;
  private xray = false;
  private pickingEnabled = true;
  private modelRadius = 1;
  private exporting = false;

  onHover: (info: PickInfo | null) => void = () => {};
  onClick: (info: PickInfo) => void = () => {};
  onFrame: () => void = () => {};
  onCameraChange: () => void = () => {};

  constructor(container: HTMLElement) {
    this.container = container;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.autoClear = false;
    const canvas = this.renderer.domElement;
    canvas.style.display = 'block';
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.touchAction = 'none';
    canvas.setAttribute('aria-label', '3D vessel model. Drag to rotate, scroll to zoom, right-drag to pan.');
    canvas.setAttribute('role', 'img');
    container.appendChild(canvas);

    this.camera = new THREE.PerspectiveCamera(35, 1, 0.01, 10000);
    this.camera.position.set(0, 60, 160);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    this.controls.rotateSpeed = 0.8;
    this.controls.zoomToCursor = true;
    this.controls.autoRotateSpeed = 1.2;
    this.controls.addEventListener('change', () => {
      this.needsRender = true;
      this.onCameraChange();
    });

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.55;
    pmrem.dispose();
    const hemi = new THREE.HemisphereLight(0xffffff, 0x8d8a83, 1.1);
    this.scene.add(hemi);
    const key = new THREE.DirectionalLight(0xffffff, 1.6);
    key.position.set(0.5, 1, 0.75);
    this.scene.add(key);
    const fill = new THREE.DirectionalLight(0xffffff, 0.5);
    fill.position.set(-0.7, -0.3, -0.6);
    this.scene.add(fill);
    // Lights follow the camera so the model is always well lit.
    this.camera.add(key.clone());
    this.scene.add(this.camera);
    key.intensity = 0.9;

    this.uniforms = createRegionUniforms();
    this.material = createRegionMaterial(this.uniforms, this.halfTop);
    this.materialBottom = createRegionMaterial(this.uniforms, { value: HALF_BOTTOM });
    this.markerMaterial = createMarkerMaterial();
    this.globalLut = this.uniforms.uColormap.value;
    this.root.add(this.model);
    this.model.add(this.cutRings);
    this.scene.add(this.root);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();

    canvas.addEventListener('pointermove', this.handlePointerMove);
    canvas.addEventListener('pointerdown', this.handlePointerDown);
    canvas.addEventListener('pointerup', this.handlePointerUp);
    canvas.addEventListener('pointerleave', this.handlePointerLeave);
    this.loop();
  }

  // ── Lifecycle ────────────────────────────────────────────────────────────

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.resizeObserver.disconnect();
    const canvas = this.renderer.domElement;
    canvas.removeEventListener('pointermove', this.handlePointerMove);
    canvas.removeEventListener('pointerdown', this.handlePointerDown);
    canvas.removeEventListener('pointerup', this.handlePointerUp);
    canvas.removeEventListener('pointerleave', this.handlePointerLeave);
    this.clearModel();
    this.controls.dispose();
    this.renderer.dispose();
    canvas.remove();
  }

  get canvas() {
    return this.renderer.domElement;
  }

  requestRender() {
    this.needsRender = true;
  }

  private loop = () => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    if (this.tween) {
      const { from, to, start, duration } = this.tween;
      const k = Math.min(1, (performance.now() - start) / duration);
      const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
      this.camera.position.set(
        from.position[0] + (to.position[0] - from.position[0]) * e,
        from.position[1] + (to.position[1] - from.position[1]) * e,
        from.position[2] + (to.position[2] - from.position[2]) * e,
      );
      this.controls.target.set(
        from.target[0] + (to.target[0] - from.target[0]) * e,
        from.target[1] + (to.target[1] - from.target[1]) * e,
        from.target[2] + (to.target[2] - from.target[2]) * e,
      );
      if (k >= 1) this.tween = null;
      this.needsRender = true;
    }
    if (this.openTween) {
      const { from, to, start, duration } = this.openTween;
      const k = Math.min(1, (performance.now() - start) / duration);
      const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
      this.openAmount = from + (to - from) * e;
      if (k >= 1) {
        this.openTween = null;
        this.openAmount = to;
        const next = this.openNext;
        this.openNext = null;
        if (next) {
          // Closed: move the hinge to the other side and open again.
          this.openSide = next.side;
          this.updateSpine();
          this.startOpenTween(next.amount);
        }
      }
      this.applyOpenState();
    }
    const changed = this.controls.update();
    // Hover waits while the vessel is opening or closing (picking follows the drawn halves).
    if (this.pendingMove && !this.openTween) {
      const e = this.pendingMove;
      this.pendingMove = null;
      this.updateHover(e);
    }
    if (this.needsRender || changed || this.controls.autoRotate) {
      this.needsRender = false;
      this.render();
    }
  };

  private resize() {
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    this.renderer.setSize(w, h, false);
    this.computeRects(w, h);
    this.markerMaterial.uniforms.uScale.value = this.renderer.getPixelRatio();
    this.needsRender = true;
  }

  private computeRects(w: number, h: number) {
    const n = Math.max(1, this.views.length);
    const cols = Math.min(n, Math.max(1, this.columns));
    const rows = Math.ceil(n / cols);
    const cw = w / cols;
    const ch = h / rows;
    this.rects = Array.from({ length: n }, (_v, i) => ({
      x: Math.round((i % cols) * cw),
      y: Math.round(Math.floor(i / cols) * ch),
      w: Math.round(cw),
      h: Math.round(ch),
    }));
  }

  getRects(): ViewRect[] {
    return this.rects;
  }

  // ── Model ───────────────────────────────────────────────────────────────

  clearModel() {
    if (this.meshBottom) {
      this.model.remove(this.meshBottom); // shares the main mesh's geometry
      this.meshBottom = null;
    }
    if (this.mesh) {
      this.model.remove(this.mesh);
      this.mesh.geometry.dispose();
      this.mesh = null;
    }
    this.disposeTopPick();
    this.spine = null;
    this.radius = null;
    if (this.original) {
      this.model.remove(this.original);
      this.original = null;
    }
    if (this.centerlineLine) {
      this.model.remove(this.centerlineLine);
      this.centerlineLine.geometry.dispose();
      this.centerlineLine = null;
    }
    for (const v of this.views) this.disposeViewPoints(v);
    this.clearCutRings();
    this.bvh = null;
    this.result = null;
    this.frames = null;
    this.needsRender = true;
  }

  hasModel() {
    return !!this.mesh;
  }

  setModel(result: ProcessResult, original: THREE.Object3D | null) {
    this.clearModel();
    this.result = result;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(result.positions, 3));
    g.setIndex(new THREE.BufferAttribute(result.index, 1));
    let geometry: THREE.BufferGeometry;
    if (result.triangleCount <= 700_000) {
      geometry = toCreasedNormals(g, (40 * Math.PI) / 180);
      this.renderToWelded = result.index;
      g.dispose();
    } else {
      g.computeVertexNormals();
      geometry = g;
      this.renderToWelded = null;
    }
    const n = geometry.getAttribute('position').count;
    const aT = new Float32Array(n);
    const map = this.renderToWelded;
    for (let i = 0; i < n; i++) aT[i] = result.aT[map ? map[i] : i];
    geometry.setAttribute('aT', new THREE.BufferAttribute(aT, 1));
    geometry.setAttribute('aAng', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
    geometry.computeBoundingSphere();
    this.bvh = new MeshBVH(geometry);
    const mesh = new THREE.Mesh(geometry, this.material);
    mesh.frustumCulled = false;
    this.mesh = mesh;
    this.model.add(mesh);
    // Same geometry drawn again for the bottom half when the vessel is open.
    const bottom = new THREE.Mesh(geometry, this.materialBottom);
    bottom.frustumCulled = false;
    bottom.visible = false;
    this.meshBottom = bottom;
    this.model.add(bottom);
    this.radius = smoothProfile(result.radiusMax);
    if (original) {
      this.original = original;
      original.visible = false;
      this.model.add(original);
    }
    // Centerline (for the Sections step and X-ray view)
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.BufferAttribute(result.centerline.slice(), 3));
    const line = new THREE.Line(lg, new THREE.LineBasicMaterial({ color: 0xd03b3b, depthTest: false, transparent: true }));
    line.renderOrder = 10;
    line.visible = this.showCenterline;
    this.centerlineLine = line;
    this.model.add(line);

    const box = new THREE.Box3().setFromBufferAttribute(geometry.getAttribute('position') as THREE.BufferAttribute);
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    this.modelRadius = sphere.radius || 1;
    let meanR = 0;
    for (const r of result.radiusMean) meanR += r;
    meanR /= result.radiusMean.length || 1;
    this.uniforms.uHatch.value = 1 / Math.max(1e-6, meanR * 0.32);
    this.applyOrientation();
    this.updateMode();
    this.rebuildMarkers();
    this.rebuildCutRings();
    this.setCameraPreset('iso', false);
  }

  /** Display rotation of the model (e.g. Z-up STL → Y-up viewer). */
  setOrientation(q: THREE.Quaternion) {
    this.orientation.copy(q);
    if (this.result) {
      this.applyOrientation();
      this.rebuildMarkers();
      this.rebuildCutRings();
    }
  }

  private applyOrientation() {
    if (!this.result || !this.mesh) return;
    this.model.quaternion.copy(this.orientation);
    this.model.position.set(0, 0, 0);
    this.root.updateMatrixWorld(true);
    // Centre the oriented model at the origin.
    const box = new THREE.Box3().setFromObject(this.mesh, true);
    const c = box.getCenter(new THREE.Vector3());
    this.model.position.sub(c);
    this.root.updateMatrixWorld(true);
    // "Up" in model space for the top/bottom frames.
    const upModel = UP.clone().applyQuaternion(this.orientation.clone().invert());
    this.frames = computeFrames(this.result.tangents, [upModel.x, upModel.y, upModel.z]);
    this.anglesWelded = vertexAngles(this.result.aT, this.result.radial, this.frames);
    const attr = this.mesh.geometry.getAttribute('aAng') as THREE.BufferAttribute;
    const arr = attr.array as Float32Array;
    const map = this.renderToWelded;
    for (let i = 0; i < attr.count; i++) {
      const w = map ? map[i] : i;
      arr[2 * i] = this.anglesWelded[2 * w];
      arr[2 * i + 1] = this.anglesWelded[2 * w + 1];
    }
    attr.needsUpdate = true;
    this.updateSpine();
    this.needsRender = true;
  }

  getModelInfo() {
    if (!this.result) return null;
    let meanR = 0;
    for (const r of this.result.radiusMean) meanR += r;
    return { length: this.result.length, meanRadius: meanR / this.result.radiusMean.length };
  }

  // ── Appearance ──────────────────────────────────────────────────────────

  setMode(mode: ViewMode) {
    this.mode = mode;
    this.updateMode();
  }

  private updateMode() {
    const u = this.uniforms;
    u.uMode.value = this.mode === 'sections' ? 1 : this.mode === 'heat' ? 2 : 0;
    if (this.mesh) this.mesh.visible = this.mode !== 'original' || !this.original;
    if (this.original) this.original.visible = this.mode === 'original';
    for (const m of [this.material, this.materialBottom]) {
      m.transparent = this.xray;
      m.opacity = this.xray ? 0.32 : 1;
      m.depthWrite = !this.xray;
      m.needsUpdate = true;
    }
    this.cutRings.visible = this.mode === 'sections';
    // The original scan can't be opened, so it is always shown closed.
    this.applyOpenState();
    this.needsRender = true;
  }

  setLayout(layout: Layout) {
    this.layout = layout;
    const u = this.uniforms;
    u.uCount.value = layout.count;
    const bounds = new Array(MAX_SECTIONS + 1).fill(1);
    layout.boundaries.forEach((b, i) => (bounds[i] = b));
    u.uBounds.value = bounds;
    const slots = new Array(MAX_SECTIONS).fill(1);
    layout.positions.forEach((p, i) => (slots[i] = Math.max(1, p.length)));
    u.uSlots.value = slots;
    u.uFlip.value = layout.flip ? 1 : 0;
    u.uTop.value.set(Math.cos(layout.topOffset), Math.sin(layout.topOffset));
    u.uTrim.value.set(layout.trimStart, layout.trimEnd);
    // Which side is "top" sets where the vessel is cut and hinged.
    this.updateSpine();
    this.rebuildMarkers();
    this.rebuildCutRings();
    this.needsRender = true;
  }

  // ── Opening the vessel ──────────────────────────────────────────────────

  /**
   * Opens the vessel lengthways like a book: 0 = closed, 1 = fully open (the top
   * half turned 180° beside the bottom half). `side` is the side of the hinge.
   *   instant  jump there (loading a study)
   *   animate  ease there (buttons, keys, presentation scenes)
   *   drag     follow a slider: jump, or steer an animation that is still running
   */
  setOpening(amount: number, side: HingeSide, motion: OpenMotion = 'instant') {
    const a = Math.max(0, Math.min(1, Number.isFinite(amount) ? amount : 0));
    const reduce = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const anim = motion === 'animate' && !reduce && !!this.mesh;
    if (side !== this.openSide) {
      if (anim && this.openAmount > 0.001) {
        // Close, then open again with the hinge on the other side.
        this.openNext = { amount: a, side };
        this.startOpenTween(0);
        return;
      }
      this.openTween = null;
      this.openSide = side;
      this.updateSpine();
    }
    this.openNext = null;
    if (anim) this.startOpenTween(a);
    else if (motion === 'drag' && this.openTween) {
      this.openTween.to = a;
      this.openTarget = a;
    } else {
      this.openTween = null;
      this.openAmount = a;
      this.openTarget = a;
      this.applyOpenState();
    }
  }

  getOpening(): { amount: number; target: number; side: HingeSide } {
    return { amount: this.openAmount, target: this.openNext?.amount ?? this.openTarget, side: this.openNext?.side ?? this.openSide };
  }

  /** Hinge side that lifts the top half away from the camera, so its inside turns towards the viewer. */
  preferredHingeSide(): HingeSide {
    if (!this.spine) return -1;
    const cam = this.tween ? this.tween.to : this.getCameraState();
    const toCam = new THREE.Vector3(...cam.position).sub(new THREE.Vector3(...cam.target)).normalize();
    this.root.updateMatrixWorld(true);
    toCam.applyQuaternion(this.model.getWorldQuaternion(new THREE.Quaternion()).invert());
    return preferredHingeSide(this.spine, [toCam.x, toCam.y, toCam.z]);
  }

  /** Draws the vessel closed while `fn` runs (standard report views), then restores the opening. */
  withClosedVessel<T>(fn: () => T): T {
    const saved = { amount: this.openAmount, target: this.openTarget, tween: this.openTween, next: this.openNext };
    this.openAmount = 0;
    this.openTarget = 0;
    this.openTween = null;
    this.openNext = null;
    this.applyOpenState();
    try {
      return fn();
    } finally {
      this.openAmount = saved.amount;
      this.openTarget = saved.target;
      this.openTween = saved.tween;
      this.openNext = saved.next;
      this.applyOpenState();
    }
  }

  private startOpenTween(to: number) {
    const from = this.openAmount;
    this.openTarget = to;
    if (Math.abs(to - from) < 1e-4) {
      this.openTween = null;
      this.openAmount = to;
      this.applyOpenState();
      return;
    }
    this.openTween = { from, to, start: performance.now(), duration: 260 + 640 * Math.abs(to - from) };
    if (this.hover.region !== -1 || this.hoverMarker) this.clearHover();
    this.needsRender = true;
  }

  /** Signed angle the top half is turned by, as drawn now (0 while closed or showing the original scan). */
  private shownAngle(): number {
    if (!this.spine || this.mode === 'original') return 0;
    return openAngle(this.openAmount, this.openSide);
  }

  /** Angle the opening is heading to: used to frame the camera on the finished shape. */
  private targetAngle(): number {
    if (!this.spine || this.mode === 'original') return 0;
    return openAngle(this.openNext?.amount ?? this.openTarget, this.openSide);
  }

  /** Recomputes the hinge from the centerline, the "top" side and the hinge side. */
  private updateSpine() {
    if (!this.result || !this.frames || !this.layout || !this.radius) {
      this.spine = null;
      return;
    }
    const L = this.layout;
    const spine = computeSpine({
      centerline: this.result.centerline,
      tangents: this.result.tangents,
      frames: this.frames,
      radius: this.radius,
      phi: L.flip ? -L.topOffset : L.topOffset,
      side: this.openSide,
    });
    this.spine = spine;
    const tex = this.uniforms.uSpine.value;
    if (tex.image.width === spine.count && tex.image.height === 2) {
      const data = tex.image.data as Float32Array;
      for (let k = 0; k < spine.count; k++) {
        for (let d = 0; d < 3; d++) {
          data[4 * k + d] = spine.hinge[3 * k + d];
          data[4 * (spine.count + k) + d] = spine.axis[3 * k + d];
        }
      }
      tex.needsUpdate = true;
    } else {
      tex.dispose();
      this.uniforms.uSpine.value = makeSpineTexture(spine.hinge, spine.axis, spine.count);
    }
    this.uniforms.uSpineN.value = spine.count;
    this.spineVersion++;
    this.applyOpenState();
  }

  /** Pushes the current opening to the shader, markers and cut rings. */
  private applyOpenState() {
    const angle = this.shownAngle();
    this.uniforms.uOpenAngle.value = angle;
    this.halfTop.value = angle !== 0 ? HALF_TOP : HALF_ALL;
    if (this.meshBottom) this.meshBottom.visible = !!this.mesh?.visible && angle !== 0;
    for (const v of this.views) this.placeViewMarkers(v);
    this.placeCutRings();
    this.schedulePickPrewarm();
    this.needsRender = true;
  }

  setSectionColors(hexes: string[]) {
    const data = new Uint8Array(MAX_SECTIONS * 4);
    for (let i = 0; i < MAX_SECTIONS; i++) {
      const c = new THREE.Color(hexes[i] ?? '#cccccc');
      const s = c.clone().convertLinearToSRGB();
      data[4 * i] = Math.round(s.r * 255);
      data[4 * i + 1] = Math.round(s.g * 255);
      data[4 * i + 2] = Math.round(s.b * 255);
      data[4 * i + 3] = 255;
    }
    this.uniforms.uSectionColors.value.dispose();
    this.uniforms.uSectionColors.value = makeLutTexture(data, true);
    this.needsRender = true;
  }

  setColormap(lut: Uint8Array, stepped: boolean) {
    this.globalLut.dispose();
    this.globalLut = makeLutTexture(lut, stepped);
    this.uniforms.uColormap.value = this.globalLut;
    this.needsRender = true;
  }

  setOptions(o: {
    outlines?: boolean;
    smooth?: boolean;
    showMarkers?: boolean;
    showCenterline?: boolean;
    xray?: boolean;
    autoRotate?: boolean;
    picking?: boolean;
    plainColor?: string;
    lineColor?: string;
  }) {
    if (o.outlines !== undefined) this.uniforms.uOutlines.value = o.outlines ? 1 : 0;
    if (o.smooth !== undefined) this.uniforms.uSmooth.value = o.smooth ? 1 : 0;
    if (o.showMarkers !== undefined) {
      this.showMarkers = o.showMarkers;
      for (const v of this.views) if (v.points) v.points.visible = false;
    }
    if (o.showCenterline !== undefined) {
      this.showCenterline = o.showCenterline;
      if (this.centerlineLine) this.centerlineLine.visible = o.showCenterline;
    }
    if (o.xray !== undefined) {
      this.xray = o.xray;
      this.updateMode();
    }
    if (o.autoRotate !== undefined) this.controls.autoRotate = o.autoRotate;
    if (o.picking !== undefined) this.pickingEnabled = o.picking;
    if (o.plainColor) this.uniforms.uPlain.value.set(o.plainColor);
    if (o.lineColor) this.uniforms.uLine.value.set(o.lineColor);
    this.needsRender = true;
  }

  /** Highlights a region from outside the 3D view (e.g. hovering the region map). */
  setExternalHover(regionIndex: number | null, viewIndex = 0) {
    this.hover = { view: regionIndex === null ? -1 : viewIndex, region: regionIndex ?? -1 };
    this.needsRender = true;
  }

  setHighlightSection(section: number | null) {
    this.uniforms.uHighlightSection.value = section === null ? -1 : section - 1;
    this.needsRender = true;
  }

  setSelected(regionIndex: number | null, markerKey: string | null) {
    this.uniforms.uSelected.value = regionIndex ?? -1;
    this.selectedMarker = markerKey;
    this.updateMarkerStates();
    this.needsRender = true;
  }

  // ── Views and data ──────────────────────────────────────────────────────

  setViews(views: EngineView[], columns: number) {
    const old = new Map(this.views.map((v) => [v.key, v]));
    const next: ViewState[] = [];
    for (const v of views) {
      let st = old.get(v.key);
      if (st) old.delete(v.key);
      else st = { key: v.key, texture: makeDataTexture(), lut: null, lutSig: '', markers: null, points: null, markerWorld: [] };
      const sig = v.lut ? `${v.lut.stepped}:${lutHash(v.lut.data)}` : '';
      if (sig !== st.lutSig) {
        st.lut?.dispose();
        st.lut = v.lut ? makeLutTexture(v.lut.data, v.lut.stepped) : null;
        st.lutSig = sig;
      }
      const data = st.texture.image.data as Float32Array;
      for (let i = 0; i < REGION_COUNT; i++) {
        const x = v.values[i];
        const valid = Number.isFinite(x);
        data[4 * i] = valid ? x : 0;
        data[4 * i + 1] = valid ? 1 : 0;
        data[4 * i + 2] = 0;
        data[4 * i + 3] = 1;
      }
      st.texture.needsUpdate = true;
      const markersChanged = JSON.stringify(st.markers) !== JSON.stringify(v.markers);
      st.markers = v.markers;
      next.push(st);
      if (markersChanged) this.buildViewMarkers(st);
    }
    for (const st of old.values()) {
      st.texture.dispose();
      st.lut?.dispose();
      this.disposeViewPoints(st);
    }
    const layoutChanged = next.length !== this.views.length || Math.max(1, columns) !== this.columns;
    this.views = next;
    this.columns = Math.max(1, columns);
    this.computeRects(Math.max(1, this.container.clientWidth), Math.max(1, this.container.clientHeight));
    if (layoutChanged && this.mesh) this.setCameraPreset('fit', false);
    this.needsRender = true;
  }

  // ── Markers ─────────────────────────────────────────────────────────────

  private disposeViewPoints(st: ViewState) {
    if (st.points) {
      this.model.remove(st.points);
      st.points.geometry.dispose();
      st.points = null;
    }
    st.markerWorld = [];
  }

  private rebuildMarkers() {
    for (const v of this.views) this.buildViewMarkers(v);
    this.needsRender = true;
  }

  /**
   * Surface point (model space) at the centre of a region, just outside the outer wall, and
   * `inner`: just inside the inner (luminal) wall, where markers go while the vessel is open.
   */
  regionSurfacePoint(section: number, side: 'T' | 'B', slot: number): { point: THREE.Vector3; inner: THREE.Vector3; normal: THREE.Vector3 } | null {
    if (!this.result || !this.frames || !this.layout || !this.bvh) return null;
    const { aT, angle } = regionCenter(section, side, slot, this.layout);
    const f = frameAt(aT, this.result.centerline, this.result.tangents, this.frames);
    const dir = new THREE.Vector3(
      f.up[0] * Math.cos(angle) + f.bin[0] * Math.sin(angle),
      f.up[1] * Math.cos(angle) + f.bin[1] * Math.sin(angle),
      f.up[2] * Math.cos(angle) + f.bin[2] * Math.sin(angle),
    ).normalize();
    const M = this.result.radiusMax.length;
    const k = Math.round(Math.max(0, Math.min(1, aT)) * (M - 1));
    const rMax = this.result.radiusMax[k] || this.result.radiusMean[k] || 1;
    const origin = new THREE.Vector3(f.p[0], f.p[1], f.p[2]);
    const ray = new THREE.Ray(origin.clone(), dir);
    const hits = this.bvh.raycast(ray, THREE.DoubleSide, 0, rMax * 1.6);
    let best: THREE.Intersection | null = null;
    let first: THREE.Intersection | null = null;
    for (const h of hits) {
      if (!best || h.distance > best.distance) best = h;
      if (!first || h.distance < first.distance) first = h;
    }
    if (best && first) {
      const normal = dir.clone();
      return {
        point: best.point.clone().addScaledVector(dir, rMax * 0.02),
        inner: first.point.clone().addScaledVector(dir, -rMax * 0.02),
        normal,
      };
    }
    const point = origin.addScaledVector(dir, rMax);
    return { point, inner: point.clone(), normal: dir };
  }

  private buildViewMarkers(st: ViewState) {
    this.disposeViewPoints(st);
    if (!st.markers || st.markers.length === 0 || !this.result || !this.layout) return;
    const pos: number[] = [];
    const col: number[] = [];
    const state: number[] = [];
    const world: MarkerPlace[] = [];
    const c = new THREE.Color();
    for (const m of st.markers) {
      const sp = this.regionSurfacePoint(m.section, m.side, m.slot);
      if (!sp) continue;
      pos.push(sp.point.x, sp.point.y, sp.point.z);
      c.set(m.color);
      col.push(c.r, c.g, c.b);
      state.push(0);
      const { aT } = regionCenter(m.section, m.side, m.slot, this.layout);
      world.push({ key: m.key, pos: sp.point.clone(), base: sp.point.clone(), inner: sp.inner.clone(), aT, top: m.side === 'T' });
    }
    if (pos.length === 0) return;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setAttribute('state', new THREE.Float32BufferAttribute(state, 1));
    const pts = new THREE.Points(g, this.markerMaterial);
    pts.frustumCulled = false;
    pts.renderOrder = 5;
    pts.visible = false;
    st.points = pts;
    st.markerWorld = world;
    this.model.add(pts);
    this.placeViewMarkers(st);
    this.updateMarkerStates();
  }

  /**
   * Places markers for the current opening: as the vessel opens they move from the outer wall to
   * the inner (luminal) wall, which then faces the viewer, and the top half's markers turn with it.
   */
  private placeViewMarkers(st: ViewState) {
    if (!st.points) return;
    const attr = st.points.geometry.getAttribute('position') as THREE.BufferAttribute;
    const arr = attr.array as Float32Array;
    const angle = this.shownAngle();
    const x = angle === 0 ? 0 : Math.min(1, this.openAmount / 0.2);
    const k = x * x * (3 - 2 * x);
    const p = new THREE.Vector3();
    st.markerWorld.forEach((m, i) => {
      p.copy(m.base).lerp(m.inner, k);
      if (m.top && angle !== 0 && this.spine) openPoint(this.spine, m.aT, angle, p.x, p.y, p.z, arr, 3 * i);
      else {
        arr[3 * i] = p.x;
        arr[3 * i + 1] = p.y;
        arr[3 * i + 2] = p.z;
      }
      m.pos.set(arr[3 * i], arr[3 * i + 1], arr[3 * i + 2]);
    });
    attr.needsUpdate = true;
  }

  private updateMarkerStates() {
    for (const v of this.views) {
      if (!v.points) continue;
      const attr = v.points.geometry.getAttribute('state') as THREE.BufferAttribute;
      v.markerWorld.forEach((m, i) => {
        attr.setX(i, m.key === this.selectedMarker ? 2 : m.key === this.hoverMarker ? 1 : 0);
      });
      attr.needsUpdate = true;
    }
    this.needsRender = true;
  }

  // ── Cut rings & labels ──────────────────────────────────────────────────

  private clearCutRings() {
    const materials = new Set<THREE.Material>();
    for (const c of [...this.cutRings.children]) {
      this.cutRings.remove(c);
      (c as THREE.Line).geometry.dispose();
      materials.add((c as THREE.Line).material as THREE.Material);
    }
    for (const m of materials) m.dispose();
    this.ringArcs = [];
  }

  private rebuildCutRings() {
    this.clearCutRings();
    if (!this.result || !this.frames || !this.layout) return;
    const L = this.layout;
    const mat = new THREE.LineBasicMaterial({ color: 0x0d366b, transparent: true, opacity: 0.75 });
    const M = this.result.radiusMax.length;
    const phi = L.flip ? -L.topOffset : L.topOffset;
    const N = 32;
    for (let i = 0; i <= L.count; i++) {
      const u = L.boundaries[i];
      const u0 = L.trimStart + u * (L.trimEnd - L.trimStart);
      const aT = L.flip ? 1 - u0 : u0;
      const f = frameAt(aT, this.result.centerline, this.result.tangents, this.frames);
      const r = (this.result.radiusMax[Math.round(aT * (M - 1))] || 1) * 1.18;
      // Each ring is a top arc and a bottom arc, so it splits cleanly when the vessel opens.
      for (const top of [true, false]) {
        const start = phi + (top ? -Math.PI / 2 : Math.PI / 2);
        const base = new Float32Array((N + 1) * 3);
        for (let k = 0; k <= N; k++) {
          const a = start + (k / N) * Math.PI;
          for (let d = 0; d < 3; d++) base[3 * k + d] = f.p[d] + r * (Math.cos(a) * f.up[d] + Math.sin(a) * f.bin[d]);
        }
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(base.slice(), 3));
        const line = new THREE.Line(g, mat);
        this.cutRings.add(line);
        this.ringArcs.push({ line, base, aT, top });
      }
    }
    this.placeCutRings();
    this.needsRender = true;
  }

  private placeCutRings() {
    const angle = this.shownAngle();
    for (const arc of this.ringArcs) {
      const attr = arc.line.geometry.getAttribute('position') as THREE.BufferAttribute;
      const arr = attr.array as Float32Array;
      const b = arc.base;
      for (let k = 0; k < b.length; k += 3) {
        if (arc.top && angle !== 0 && this.spine) openPoint(this.spine, arc.aT, angle, b[k], b[k + 1], b[k + 2], arr, k);
        else {
          arr[k] = b[k];
          arr[k + 1] = b[k + 1];
          arr[k + 2] = b[k + 2];
        }
      }
      attr.needsUpdate = true;
    }
  }

  /** Anchors for HTML labels (section numbers, ends), with the vessel closed. Place them with anchorPosition. */
  labelAnchors(): LabelAnchor[] {
    if (!this.result || !this.frames || !this.layout) return [];
    const out: LabelAnchor[] = [];
    const L = this.layout;
    const M = this.result.radiusMax.length;
    const anchor = (id: string, text: string, kind: LabelAnchor['kind'], aT: number, p: number[]): LabelAnchor => {
      const base = new THREE.Vector3(p[0], p[1], p[2]);
      return { id, text, kind, aT, base, pos: base.clone().applyMatrix4(this.model.matrixWorld) };
    };
    const phi = L.flip ? -L.topOffset : L.topOffset;
    for (let s = 1; s <= L.count; s++) {
      const aT = sectionCenterT(s, L);
      const f = frameAt(aT, this.result.centerline, this.result.tangents, this.frames);
      const r = (this.result.radiusMax[Math.round(aT * (M - 1))] || 1) * 1.9;
      const d = [0, 1, 2].map((i) => f.up[i] * Math.cos(phi) + f.bin[i] * Math.sin(phi));
      out.push(anchor(`s${s}`, String(s), 'section', aT, [f.p[0] + d[0] * r, f.p[1] + d[1] * r, f.p[2] + d[2] * r]));
    }
    for (const which of ['proximal', 'distal'] as const) {
      const aT = endT(which, L);
      const f = frameAt(aT, this.result.centerline, this.result.tangents, this.frames);
      const r = (this.result.radiusMax[Math.round(aT * (M - 1))] || 1) * 2.4;
      const sign = (which === 'proximal') !== L.flip ? -1 : 1;
      out.push(
        anchor(which, which === 'proximal' ? 'Proximal' : 'Distal', 'end', aT, [
          f.p[0] + sign * f.t[0] * r,
          f.p[1] + sign * f.t[1] * r,
          f.p[2] + sign * f.t[2] * r,
        ]),
      );
    }
    return out;
  }

  /**
   * World position of a label for the current opening (or the one being animated to). As the
   * vessel opens, labels glide to the hinge line between the two halves, like a book's spine.
   */
  anchorPosition(a: LabelAnchor, target = false): THREE.Vector3 {
    const amount = !this.spine || !this.result || !this.frames || this.mode === 'original' ? 0 : target ? (this.openNext?.amount ?? this.openTarget) : this.openAmount;
    if (amount <= 0) return a.pos;
    const h = hingeAt(this.spine!, a.aT);
    const k = amount * amount * (3 - 2 * amount);
    const p = a.base.clone();
    if (a.kind === 'section') p.lerp(new THREE.Vector3(h[0], h[1], h[2]), k);
    else {
      const c = frameAt(a.aT, this.result!.centerline, this.result!.tangents, this.frames!).p;
      p.add(new THREE.Vector3(h[0] - c[0], h[1] - c[1], h[2] - c[2]).multiplyScalar(k));
    }
    return p.applyMatrix4(this.model.matrixWorld);
  }

  /** Projects a world point into CSS pixels within a view. */
  project(world: THREE.Vector3, viewIndex = 0): { x: number; y: number; behind: boolean } {
    const rect = this.rects[viewIndex] ?? this.rects[0];
    const cam = this.camera;
    cam.aspect = rect.w / rect.h;
    cam.updateProjectionMatrix();
    const p = world.clone().project(cam);
    return { x: rect.x + ((p.x + 1) / 2) * rect.w, y: rect.y + ((1 - p.y) / 2) * rect.h, behind: p.z > 1 };
  }

  // ── Camera ──────────────────────────────────────────────────────────────

  private fitDistance(): number {
    const fov = (this.camera.fov * Math.PI) / 180;
    const rect = this.rects[0] ?? { w: 1, h: 1 };
    const aspect = rect.w / rect.h;
    const fitH = (this.modelRadius * 1.08) / Math.sin(fov / 2);
    const fitW = fitH / Math.min(1, aspect);
    return Math.max(fitH, fitW) * 0.8;
  }

  /** Camera state that frames the whole model (and its end labels) from a direction. */
  private framedState(dir: THREE.Vector3, aspect: number, onScreen = true): CameraState {
    if (!this.mesh) {
      const d = this.fitDistance();
      return { position: [dir.x * d, dir.y * d, dir.z * d], target: [0, 0, 0] };
    }
    const cam = new THREE.PerspectiveCamera(this.camera.fov, aspect, 0.01, 10000);
    cam.position.copy(dir).multiplyScalar(this.modelRadius * 4);
    cam.lookAt(0, 0, 0);
    cam.updateMatrixWorld();
    const right = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 0);
    const up = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 1);
    const tanV = Math.tan((cam.fov * Math.PI) / 360);
    const tanH = tanV * aspect;
    // Frame the shape the vessel is opening to, so a saved view looks the same when replayed.
    const angle = this.targetAngle();
    // On screen, keep the open vessel clear of the open/close slider at the right edge (and, to
    // stay centred, the same margin on the left). Only matters when the fit would reach under it;
    // the closed vessel is framed exactly as before.
    const viewW = onScreen && angle !== 0 ? (this.rects[0]?.w ?? 0) : 0;
    const tanSides = viewW > 4 * SIDE_RESERVE_PX ? tanH * (1 - (2 * SIDE_RESERVE_PX) / viewW) : 0;
    let dist = 0;
    let distSides = 0;
    const consider = (p: THREE.Vector3) => {
      const along = p.dot(dir);
      dist = Math.max(dist, Math.abs(p.dot(right)) / tanH + along, Math.abs(p.dot(up)) / tanV + along);
      if (tanSides) distSides = Math.max(distSides, Math.abs(p.dot(right)) / tanSides + along);
    };
    const geo = this.mesh.geometry;
    const pos = geo.getAttribute('position') as THREE.BufferAttribute;
    const aT = geo.getAttribute('aT') as THREE.BufferAttribute;
    const ang = geo.getAttribute('aAng') as THREE.BufferAttribute;
    const step = Math.max(1, Math.floor(pos.count / 20000));
    const v = new THREE.Vector3();
    const moved = [0, 0, 0];
    this.root.updateMatrixWorld(true);
    for (let i = 0; i < pos.count; i += step) {
      v.fromBufferAttribute(pos, i);
      if (angle !== 0 && this.spine && this.layout && topness(ang.getX(i), ang.getY(i), this.layout) >= 0) {
        openPoint(this.spine, aT.getX(i), angle, v.x, v.y, v.z, moved);
        v.set(moved[0], moved[1], moved[2]);
      }
      consider(v.applyMatrix4(this.mesh.matrixWorld));
    }
    for (const a of this.labelAnchors()) if (a.kind === 'end') consider(this.anchorPosition(a, true));
    dist = Math.max(dist * 1.06, distSides, this.modelRadius * 0.5);
    return { position: [dir.x * dist, dir.y * dist, dir.z * dist], target: [0, 0, 0] };
  }

  private viewAspect(): number {
    const r = this.rects[0];
    return r && r.h > 0 ? r.w / r.h : 1.6;
  }

  setCameraPreset(preset: CameraPreset, animate = true, aspect?: number) {
    const dirs: Record<CameraPreset, [number, number, number]> = {
      top: [0, 1, 0.0008],
      bottom: [0, -1, 0.0008],
      front: [0, 0.0001, 1],
      back: [0, 0.0001, -1],
      left: [-1, 0.0001, 0],
      right: [1, 0.0001, 0],
      iso: [0.35, 0.75, 0.9],
      fit: [0, 0, 0],
    };
    let dir = new THREE.Vector3(...dirs[preset]);
    if (preset === 'fit') dir = this.camera.position.clone().sub(this.controls.target).normalize();
    dir.normalize();
    // An explicit aspect means an off-screen render (exports): no slider to keep clear of.
    this.setCameraState(this.framedState(dir, aspect ?? this.viewAspect(), aspect === undefined), animate);
  }

  getCameraView(): CameraView {
    const target = this.controls.target.clone();
    const offset = this.camera.position.clone().sub(target);
    const dist = offset.length() || 1;
    const dir = offset.normalize();
    const fit = new THREE.Vector3(...this.framedState(dir, this.viewAspect()).position).length() || 1;
    return { dir: dir.toArray() as [number, number, number], ratio: dist / fit, target: target.toArray() as [number, number, number] };
  }

  /** Restores a view saved with getCameraView, adapted to the current layout and screen. */
  setCameraView(view: CameraView, animate = true) {
    const dir = new THREE.Vector3(...view.dir).normalize();
    const fit = new THREE.Vector3(...this.framedState(dir, this.viewAspect()).position).length();
    const d = fit * Math.max(0.05, view.ratio);
    const t = new THREE.Vector3(...view.target);
    this.setCameraState(
      { position: [t.x + dir.x * d, t.y + dir.y * d, t.z + dir.z * d], target: view.target },
      animate,
    );
  }

  getCameraState(): CameraState {
    return {
      position: this.camera.position.toArray() as [number, number, number],
      target: this.controls.target.toArray() as [number, number, number],
    };
  }

  setCameraState(s: CameraState, animate = true) {
    if (animate && !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      this.tween = { from: this.getCameraState(), to: s, start: performance.now(), duration: 650 };
    } else {
      this.tween = null;
      this.camera.position.set(...s.position);
      this.controls.target.set(...s.target);
      // Apply the orientation now, so a synchronous render (exports) sees the new view.
      this.camera.lookAt(this.controls.target);
      this.camera.updateMatrixWorld();
    }
    this.needsRender = true;
  }

  zoomBy(factor: number) {
    const dir = this.camera.position.clone().sub(this.controls.target);
    this.setCameraState(
      {
        position: this.controls.target.clone().add(dir.multiplyScalar(factor)).toArray() as [number, number, number],
        target: this.controls.target.toArray() as [number, number, number],
      },
      true,
    );
  }

  // ── Rendering ───────────────────────────────────────────────────────────

  private render(target?: { width: number; height: number }) {
    const r = this.renderer;
    const W = target?.width ?? Math.max(1, this.container.clientWidth);
    const H = target?.height ?? Math.max(1, this.container.clientHeight);
    const rects = target ? this.layoutRects(W, H) : this.rects;
    r.setScissorTest(false);
    r.clear();
    r.setScissorTest(true);
    const views = this.views.length ? this.views : [null];
    views.forEach((v, i) => {
      const rect = rects[i];
      if (!rect) return;
      r.setViewport(rect.x, H - rect.y - rect.h, rect.w, rect.h);
      r.setScissor(rect.x, H - rect.y - rect.h, rect.w, rect.h);
      this.camera.aspect = rect.w / rect.h;
      this.camera.updateProjectionMatrix();
      if (v) this.uniforms.uData.value = v.texture;
      this.uniforms.uColormap.value = v?.lut ?? this.globalLut;
      this.uniforms.uHover.value = this.hover.view === i && !this.exporting ? this.hover.region : -1;
      for (const o of this.views) if (o.points) o.points.visible = false;
      if (v?.points && this.showMarkers && (this.mode === 'heat' || this.mode === 'sections' || this.mode === 'plain')) {
        v.points.visible = true;
      }
      r.render(this.scene, this.camera);
    });
    r.setScissorTest(false);
    if (!target) this.onFrame();
  }

  private layoutRects(w: number, h: number): ViewRect[] {
    const n = Math.max(1, this.views.length);
    const cols = Math.min(n, this.columns);
    const rows = Math.ceil(n / cols);
    return Array.from({ length: n }, (_v, i) => ({
      x: Math.round((i % cols) * (w / cols)),
      y: Math.round(Math.floor(i / cols) * (h / rows)),
      w: Math.round(w / cols),
      h: Math.round(h / rows),
    }));
  }

  /** Renders the current views at a given pixel size into a 2D canvas. */
  renderImage(opts: { width: number; height: number; background: string | null; hideMarkers?: boolean }): HTMLCanvasElement {
    const r = this.renderer;
    const prevSize = r.getSize(new THREE.Vector2());
    const prevRatio = r.getPixelRatio();
    const prevMarkers = this.showMarkers;
    const prevScale = this.markerMaterial.uniforms.uScale.value;
    this.exporting = true;
    if (opts.hideMarkers) this.showMarkers = false;
    const max = r.capabilities.maxTextureSize || 8192;
    const scale = Math.min(1, max / Math.max(opts.width, opts.height));
    const w = Math.floor(opts.width * scale);
    const h = Math.floor(opts.height * scale);
    r.setPixelRatio(1);
    r.setSize(w, h, false);
    this.markerMaterial.uniforms.uScale.value = Math.max(1, Math.min(w, h) / 700);
    if (opts.background) r.setClearColor(opts.background, 1);
    else r.setClearColor(0x000000, 0);
    this.render({ width: w, height: h });
    const out = document.createElement('canvas');
    out.width = w;
    out.height = h;
    const ctx = out.getContext('2d')!;
    ctx.drawImage(r.domElement, 0, 0);
    // Restore
    r.setClearColor(0x000000, 0);
    r.setPixelRatio(prevRatio);
    r.setSize(prevSize.x, prevSize.y, false);
    this.markerMaterial.uniforms.uScale.value = prevScale;
    this.showMarkers = prevMarkers;
    this.exporting = false;
    this.needsRender = true;
    return out;
  }

  // ── Picking ─────────────────────────────────────────────────────────────

  private viewAt(clientX: number, clientY: number): { index: number; ndc: THREE.Vector2 } | null {
    const bounds = this.renderer.domElement.getBoundingClientRect();
    const x = clientX - bounds.left;
    const y = clientY - bounds.top;
    for (let i = 0; i < this.rects.length; i++) {
      const r = this.rects[i];
      if (x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h) {
        return { index: i, ndc: new THREE.Vector2(((x - r.x) / r.w) * 2 - 1, -((y - r.y) / r.h) * 2 + 1) };
      }
    }
    return null;
  }

  pick(clientX: number, clientY: number): PickInfo | null {
    if (!this.mesh || !this.bvh || !this.layout || !this.anglesWelded) return null;
    const v = this.viewAt(clientX, clientY);
    if (!v) return null;
    const rect = this.rects[v.index];
    this.camera.aspect = rect.w / rect.h;
    this.camera.updateProjectionMatrix();
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(v.ndc, this.camera);
    const inv = this.mesh.matrixWorld.clone().invert();
    const local = raycaster.ray.clone().applyMatrix4(inv);
    const surface = this.surfaceHit(local);
    const hit = surface?.hit ?? null;
    let region: Region | null = null;
    if (surface) {
      const at = this.surfaceCoords(surface.hit, surface.positions);
      if (at) region = locateRegion(at.t, at.cs, at.sn, this.layout);
    }
    // Markers first (screen-space proximity, must not be hidden behind the surface, unless the
    // surface in front is the marker's own location, e.g. its own wall on a thick-walled vessel).
    // Markers are drawn over the model, so on the open vessel, where the halves can hide each
    // other's markers, a hidden marker under the cursor still wins when no visible one is near.
    let markerKey: string | null = null;
    const st = this.views[v.index];
    if (st?.points && this.showMarkers && this.mode !== 'original') {
      const bounds = this.renderer.domElement.getBoundingClientRect();
      let best = 14 * 14;
      let bestHidden = 14 * 14;
      let hiddenKey: string | null = null;
      const camPos = this.camera.position;
      const hitDist = hit ? hit.point.clone().applyMatrix4(this.mesh.matrixWorld).distanceTo(camPos) : Infinity;
      const here = region ? `|${region.section}|${region.side}|${region.position}` : null;
      for (const m of st.markerWorld) {
        const wp = m.pos.clone().applyMatrix4(this.model.matrixWorld);
        const p = this.project(wp, v.index);
        const dx = p.x - (clientX - bounds.left);
        const dy = p.y - (clientY - bounds.top);
        const d2 = dx * dx + dy * dy;
        if (d2 >= best && d2 >= bestHidden) continue;
        if (wp.distanceTo(camPos) <= hitDist + this.modelRadius * 0.03 || (here !== null && m.key.endsWith(here))) {
          if (d2 < best) {
            best = d2;
            markerKey = m.key;
          }
        } else if (d2 < bestHidden) {
          bestHidden = d2;
          hiddenKey = m.key;
        }
      }
      if (!markerKey && this.shownAngle() !== 0) markerKey = hiddenKey;
    }
    if (!region && !markerKey) return { viewIndex: v.index, region: null, markerKey: null, clientX, clientY };
    return { viewIndex: v.index, region, markerKey, clientX, clientY };
  }

  /** Vessel coordinates (aT, cos θ, sin θ) at a ray hit, interpolated over the hit triangle. */
  private surfaceCoords(hit: THREE.Intersection, positions: ArrayLike<number>): { t: number; cs: number; sn: number } | null {
    if (!this.mesh || !hit.face) return null;
    const geo = this.mesh.geometry;
    const aT = geo.getAttribute('aT') as THREE.BufferAttribute;
    const ang = geo.getAttribute('aAng') as THREE.BufferAttribute;
    const { a, b, c } = hit.face;
    const A = new THREE.Vector3().fromArray(positions, 3 * a);
    const B = new THREE.Vector3().fromArray(positions, 3 * b);
    const C = new THREE.Vector3().fromArray(positions, 3 * c);
    const bary = THREE.Triangle.getBarycoord(hit.point, A, B, C, new THREE.Vector3());
    if (!bary) return null;
    return {
      t: aT.getX(a) * bary.x + aT.getX(b) * bary.y + aT.getX(c) * bary.z,
      cs: ang.getX(a) * bary.x + ang.getX(b) * bary.y + ang.getX(c) * bary.z,
      sn: ang.getY(a) * bary.x + ang.getY(b) * bary.y + ang.getY(c) * bary.z,
    };
  }

  /**
   * First point of the drawn surface along a ray (model space). While the vessel is open this
   * matches the two drawing passes: the bottom half where it is, the top half turned about the
   * hinge, each clipped at the top/bottom divide.
   */
  private surfaceHit(local: THREE.Ray): { hit: THREE.Intersection; positions: ArrayLike<number> } | null {
    if (!this.mesh || !this.bvh) return null;
    const base = (this.mesh.geometry.getAttribute('position') as THREE.BufferAttribute).array as Float32Array;
    const angle = this.shownAngle();
    const layout = this.layout;
    if (angle === 0 || !layout || !this.spine) {
      const hit = this.bvh.raycastFirst(local, THREE.DoubleSide);
      return hit ? { hit, positions: base } : null;
    }
    const nearest = (hits: THREE.Intersection[], positions: ArrayLike<number>, top: boolean) => {
      let best: THREE.Intersection | null = null;
      for (const h of hits) {
        if (best && h.distance >= best.distance) continue;
        const at = this.surfaceCoords(h, positions);
        if (at && (topness(at.cs, at.sn, layout) >= 0) === top) best = h;
      }
      return best;
    };
    const bottom = nearest(this.bvh.raycast(local, THREE.DoubleSide), base, false);
    const tp = this.ensureTopPick(angle);
    const top = nearest(tp.bvh.raycast(local, THREE.DoubleSide), tp.positions, true);
    if (top && (!bottom || top.distance < bottom.distance)) return { hit: top, positions: tp.positions };
    return bottom ? { hit: bottom, positions: base } : null;
  }

  /**
   * The whole mesh turned as the top half, for picking on the open vessel. Its BVH reuses the
   * main tree (same triangles) and is refitted when the opening changes, which is much faster
   * than building a new one.
   */
  private ensureTopPick(angle: number) {
    const geo = this.mesh!.geometry;
    const src = (geo.getAttribute('position') as THREE.BufferAttribute).array as Float32Array;
    if (!this.topPick) {
      const positions = new Float32Array(src.length);
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      const bvh = MeshBVH.deserialize(MeshBVH.serialize(this.bvh!, { cloneBuffers: true }), geometry, { setIndex: true });
      this.topPick = { geometry, bvh, positions, angle: NaN, version: -1 };
    }
    const tp = this.topPick;
    if (tp.angle !== angle || tp.version !== this.spineVersion) {
      const map = this.renderToWelded;
      const res = this.result;
      if (map && res) {
        // The drawn mesh repeats each shared corner; turn each welded vertex once, then copy.
        const welded = (this.topWelded ??= new Float32Array(res.positions.length));
        openPositions(this.spine!, res.aT, angle, res.positions, welded);
        const dst = tp.positions;
        for (let i = 0, n = map.length; i < n; i++) {
          const w = 3 * map[i];
          dst[3 * i] = welded[w];
          dst[3 * i + 1] = welded[w + 1];
          dst[3 * i + 2] = welded[w + 2];
        }
      } else openPositions(this.spine!, (geo.getAttribute('aT') as THREE.BufferAttribute).array as Float32Array, angle, src, tp.positions);
      tp.bvh.refit();
      tp.angle = angle;
      tp.version = this.spineVersion;
    }
    return tp;
  }

  private disposeTopPick() {
    window.clearTimeout(this.prewarmTimer);
    this.topWelded = null;
    if (!this.topPick) return;
    this.topPick.geometry.dispose();
    this.topPick = null;
  }

  /** Once the opening settles, gets clicking ready for it, so the first hover doesn't wait (large scans). */
  private schedulePickPrewarm() {
    window.clearTimeout(this.prewarmTimer);
    if (this.shownAngle() === 0) return;
    this.prewarmTimer = window.setTimeout(() => {
      const angle = this.shownAngle();
      if (this.openTween) this.schedulePickPrewarm();
      else if (angle !== 0 && this.mesh && this.bvh && this.spine && !this.disposed) this.ensureTopPick(angle);
    }, 250);
  }

  private handlePointerMove = (e: PointerEvent) => {
    if (!this.pickingEnabled) return;
    if (e.buttons !== 0) {
      if (this.hover.region !== -1 || this.hoverMarker) this.clearHover();
      return;
    }
    this.pendingMove = e;
  };

  private updateHover(e: PointerEvent) {
    const info = this.pick(e.clientX, e.clientY);
    const regionIdx = this.mode === 'original' ? -1 : (info?.region?.index ?? -1);
    const view = info?.viewIndex ?? -1;
    if (regionIdx !== this.hover.region || view !== this.hover.view || (info?.markerKey ?? null) !== this.hoverMarker) {
      this.hover = { view, region: regionIdx };
      this.hoverMarker = info?.markerKey ?? null;
      this.updateMarkerStates();
      this.needsRender = true;
    }
    this.renderer.domElement.style.cursor = info?.region || info?.markerKey ? 'pointer' : 'grab';
    this.onHover(info && (info.region || info.markerKey) ? info : null);
  }

  private clearHover() {
    this.hover = { view: -1, region: -1 };
    this.hoverMarker = null;
    this.updateMarkerStates();
    this.onHover(null);
    this.needsRender = true;
  }

  private handlePointerDown = (e: PointerEvent) => {
    this.pointerDown = { x: e.clientX, y: e.clientY, t: performance.now() };
    this.tween = null;
  };

  private handlePointerUp = (e: PointerEvent) => {
    const d = this.pointerDown;
    this.pointerDown = null;
    if (!d || !this.pickingEnabled) return;
    if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 5 || performance.now() - d.t > 600) return;
    const info = this.pick(e.clientX, e.clientY);
    if (info) this.onClick(info);
  };

  private handlePointerLeave = () => {
    this.clearHover();
  };

  // ── Export helpers ──────────────────────────────────────────────────────

  /** Vertex-coloured copy of the model (display orientation baked in) for GLB export. */
  bakedMesh(viewIndex: number, colorFor: (normalised: number | null, region: Region | null) => string): THREE.Mesh | null {
    if (!this.result || !this.layout || !this.anglesWelded) return null;
    const st = this.views[viewIndex];
    const data = st ? (st.texture.image.data as Float32Array) : null;
    const res = this.result;
    const g = new THREE.BufferGeometry();
    const V = res.aT.length;
    const colors = new Float32Array(V * 3);
    const c = new THREE.Color();
    for (let v = 0; v < V; v++) {
      const reg = this.mode === 'plain' ? null : locateRegion(res.aT[v], this.anglesWelded[2 * v], this.anglesWelded[2 * v + 1], this.layout);
      let hex: string;
      if (!reg) hex = colorFor(null, null);
      else {
        const valid = data && data[4 * reg.index + 1] > 0.5;
        hex = colorFor(valid ? data![4 * reg.index] : null, reg);
      }
      c.set(hex);
      colors[3 * v] = c.r;
      colors[3 * v + 1] = c.g;
      colors[3 * v + 2] = c.b;
    }
    g.setAttribute('position', new THREE.BufferAttribute(res.positions.slice(), 3));
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    g.setIndex(new THREE.BufferAttribute(res.index.slice(), 1));
    g.applyMatrix4(this.model.matrixWorld);
    g.computeVertexNormals();
    return new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0 }));
  }

}
