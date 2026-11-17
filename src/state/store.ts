import { create } from 'zustand';
import type { PaletteId } from '../lib/colormaps';
import type { DamageMapping, DamageRow, SkippedRow } from '../lib/importers';
import type { Side } from '../lib/naming';
import { DEFAULT_SECTIONS, type SectionSettings } from '../lib/regions';
import type { PAdjust, TestChoice } from '../lib/stats/tests';
import type { Aggregation, ImageItem, Treatment, ViewTarget } from '../lib/study';
import type { CameraState, CameraView, ViewMode } from '../three/engine';

export type StepId = 'model' | 'sections' | 'images' | 'damage' | 'treatments' | 'explore' | 'compare' | 'stats';
export type Theme = 'system' | 'light' | 'dark';
export type UpAxis = 'y' | '-y' | 'z' | '-z' | 'x' | '-x';
export type Units = 'mm' | 'cm' | 'm' | 'in';

export interface ModelInfo {
  status: 'empty' | 'loading' | 'processing' | 'ready' | 'error';
  name: string;
  format: string;
  size: number;
  progress: { stage: string; fraction: number } | null;
  error: string | null;
  vertexCount: number;
  triangleCount: number;
  length: number;
  meanRadius: number;
  method: 'curved' | 'straight';
  quality: number;
  warnings: string[];
  hasTexture: boolean;
  units: Units;
  upAxis: UpAxis;
  /** Extra display rotation (quaternion xyzw) from "Lay flat". */
  rotation: [number, number, number, number] | null;
  centerlineMode: 'auto' | 'straight';
  revision: number;
  isDemo: boolean;
}

export interface Selection {
  /** Vessel, or null when a treatment-average location is selected. */
  vKey: string | null;
  /** Treatment id when the location was picked on a treatment-average view. */
  groupId?: string | null;
  section: number;
  side: Side;
  position: string;
}

export interface CompareState {
  layout: 'pair' | 'all' | 'groups';
  left: ViewTarget | null;
  right: ViewTarget | null;
  diff: boolean;
}

export interface HeatSettings {
  palette: PaletteId;
  rangeMode: 'study' | 'vessel' | 'custom';
  min: number;
  max: number;
  steps: number;
  aggregation: Aggregation;
  smooth: boolean;
  outlines: boolean;
  showMarkers: boolean;
}

export interface StatsSettings {
  unit: 'image' | 'vessel';
  test: TestChoice;
  alpha: number;
  padjust: PAdjust;
  section: number | null;
  side: Side | null;
  position: string | null;
  errorBar: 'sd' | 'sem' | 'ci';
}

export interface DamageState {
  fileName: string | null;
  mapping: DamageMapping | null;
  rows: DamageRow[];
  skipped: SkippedRow[];
  ambiguousUnits: boolean;
  percentFormatted: boolean;
  sheetNames: string[];
}

export interface Scene {
  id: string;
  title: string;
  step: StepId;
  mode: ViewMode;
  vessel: string | null;
  compare: CompareState;
  camera: CameraState;
  /** Screen-independent camera (preferred when present). */
  view?: CameraView;
}

export interface PresentationSettings {
  title: string;
  subtitle: string;
  footer: string;
  logo: string | null;
  dark: boolean;
  scenes: Scene[];
}

export interface Toast {
  id: number;
  kind: 'info' | 'success' | 'warning' | 'error';
  text: string;
}

export type DialogId = 'export' | 'help' | 'privacy' | 'present-settings' | 'save' | null;

export interface AppState {
  study: { name: string; partner: string; notes: string };
  model: ModelInfo;
  sections: SectionSettings;
  images: ImageItem[];
  damage: DamageState;
  treatments: Treatment[];
  vesselTreatment: Record<string, string>;
  heat: HeatSettings;
  viewMode: ViewMode;
  vessel: string | null;
  selection: Selection | null;
  compare: CompareState;
  stats: StatsSettings;
  presentation: PresentationSettings;
  step: StepId;
  theme: Theme;
  presenting: boolean;
  dialog: DialogId;
  lightbox: { imageIds: string[]; index: number } | null;
  /** Image being placed by clicking on the model, and the vessel it belongs to. */
  placing: { imageId: string; vessel: string } | null;
  sidebarOpen: boolean;
  dirty: boolean;
  busy: { text: string; fraction: number | null } | null;
  toasts: Toast[];
  highlightSection: number | null;
}

export const emptyModel: ModelInfo = {
  status: 'empty',
  name: '',
  format: '',
  size: 0,
  progress: null,
  error: null,
  vertexCount: 0,
  triangleCount: 0,
  length: 0,
  meanRadius: 0,
  method: 'curved',
  quality: 0,
  warnings: [],
  hasTexture: false,
  units: 'mm',
  upAxis: 'y',
  rotation: null,
  centerlineMode: 'auto',
  revision: 0,
  isDemo: false,
};

export const defaultHeat: HeatSettings = {
  palette: 'heat',
  rangeMode: 'study',
  min: 0,
  max: 20,
  steps: 0,
  aggregation: 'mean',
  smooth: false,
  outlines: true,
  showMarkers: true,
};

export const defaultStats: StatsSettings = {
  unit: 'image',
  test: 'auto',
  alpha: 0.05,
  padjust: 'holm',
  section: null,
  side: null,
  position: null,
  errorBar: 'sd',
};

function loadTheme(): Theme {
  try {
    const t = localStorage.getItem('vessel-viewer:theme');
    if (t === 'light' || t === 'dark' || t === 'system') return t;
  } catch {
    /* ignore */
  }
  return 'system';
}

export function initialState(): Omit<AppState, 'theme'> {
  return {
    study: { name: '', partner: '', notes: '' },
    model: { ...emptyModel },
    sections: { ...DEFAULT_SECTIONS },
    images: [],
    damage: {
      fileName: null,
      mapping: null,
      rows: [],
      skipped: [],
      ambiguousUnits: false,
      percentFormatted: false,
      sheetNames: [],
    },
    treatments: [],
    vesselTreatment: {},
    heat: { ...defaultHeat },
    viewMode: 'sections',
    vessel: null,
    selection: null,
    compare: { layout: 'pair', left: null, right: null, diff: false },
    stats: { ...defaultStats },
    presentation: { title: '', subtitle: '', footer: 'Confidential', logo: null, dark: true, scenes: [] },
    step: 'model',
    presenting: false,
    dialog: null,
    lightbox: null,
    placing: null,
    sidebarOpen: typeof window === 'undefined' || window.innerWidth >= 768,
    dirty: false,
    busy: null,
    toasts: [],
    highlightSection: null,
  };
}

export const useStore = create<AppState>(() => ({ ...initialState(), theme: loadTheme() }));

export const set = useStore.setState;
export const get = useStore.getState;

/** Marks the study as having unsaved changes. */
export function update(partial: Partial<AppState> | ((s: AppState) => Partial<AppState>)) {
  useStore.setState((s) => ({ ...(typeof partial === 'function' ? partial(s) : partial), dirty: true }));
}

let toastId = 0;
export function toast(text: string, kind: Toast['kind'] = 'info', ms = 4200) {
  const id = ++toastId;
  set((s) => ({ toasts: [...s.toasts.slice(-3), { id, kind, text }] }));
  window.setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), ms);
}

export function setTheme(theme: Theme) {
  try {
    localStorage.setItem('vessel-viewer:theme', theme);
  } catch {
    /* ignore */
  }
  set({ theme });
}
