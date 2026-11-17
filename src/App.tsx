import { useEffect, useState } from 'react';
import { CheckCircle2, FileUp, Info, TriangleAlert, X, XCircle } from 'lucide-react';
import { CompareSummary } from './components/CompareSummary';
import { Dialogs } from './components/Dialogs';
import { ImagePanel } from './components/ImagePanel';
import { Lightbox } from './components/Lightbox';
import { PresentationChrome } from './components/Presentation';
import { RegionMapPanel } from './components/RegionMap';
import { Sidebar } from './components/Sidebar';
import { StatsView } from './components/StatsView';
import { openStudyPicker, TopBar } from './components/TopBar';
import { Progress, cx } from './components/ui';
import { DarkContext, useResolvedTheme } from './components/useTheme';
import { Viewer } from './components/Viewer';
import { Welcome } from './components/Welcome';
import { filesFromDrop } from './lib/files';
import { isImageFile } from './lib/images';
import { openProject } from './lib/project';
import { addImageFiles, loadDamageFile, loadModel, loadTreatmentKeyFile } from './state/actions';
import { set, useStore } from './state/store';

const MODEL_RE = /\.(stl|glb|gltf|obj|ply|mtl|bin)$/i;
const SHEET_RE = /\.(xlsx|xlsm|xls|csv|tsv|txt)$/i;

async function routeFiles(files: File[]) {
  const project = files.find((f) => /\.vessel$/i.test(f.name));
  if (project) return openProject(project);
  const models = files.filter((f) => MODEL_RE.test(f.name));
  const zips = files.filter((f) => /\.zip$/i.test(f.name));
  const images = files.filter((f) => isImageFile(f.name));
  const sheets = files.filter((f) => SHEET_RE.test(f.name));
  const textures = models.length ? images.filter((f) => /\.(png|jpe?g|webp)$/i.test(f.name) && files.some((m) => /\.(obj|gltf)$/i.test(m.name))) : [];
  if (models.length || zips.length) {
    set({ step: 'model' });
    await loadModel([...models, ...zips, ...textures]);
  }
  const imgs = images.filter((f) => !textures.includes(f));
  if (imgs.length) {
    addImageFiles(imgs);
    if (!models.length) set({ step: 'images' });
  }
  for (const sh of sheets) {
    if (useStore.getState().step === 'treatments' || /treat|key/i.test(sh.name)) await loadTreatmentKeyFile(sh);
    else {
      await loadDamageFile(sh);
      set({ step: 'damage' });
    }
  }
}

function GlobalDrop() {
  const [active, setActive] = useState(false);
  useEffect(() => {
    let depth = 0;
    const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files');
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth++;
      setActive(true);
    };
    const leave = () => {
      depth = Math.max(0, depth - 1);
      if (depth === 0) setActive(false);
    };
    const over = (e: DragEvent) => {
      if (hasFiles(e)) e.preventDefault();
    };
    const drop = async (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      setActive(false);
      if ((e.target as HTMLElement)?.closest?.('[data-dropzone]')) return;
      const files = await filesFromDrop(e.dataTransfer!);
      if (files.length) await routeFiles(files);
    };
    window.addEventListener('dragenter', enter);
    window.addEventListener('dragleave', leave);
    window.addEventListener('dragover', over);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragenter', enter);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('dragover', over);
      window.removeEventListener('drop', drop);
    };
  }, []);
  if (!active) return null;
  return (
    <div className="pointer-events-none fixed inset-0 z-[60] flex items-center justify-center bg-accent/10 backdrop-blur-[1px]">
      <div className="flex items-center gap-3 rounded-2xl border-2 border-dashed border-accent bg-surface px-6 py-5 shadow-pop">
        <FileUp className="h-6 w-6 text-accent" />
        <div>
          <div className="text-[15px] font-semibold text-ink">Drop to add to the study</div>
          <div className="text-[12.5px] text-ink-2">Models, image folders, spreadsheets or a saved .vessel study. Files stay on this computer.</div>
        </div>
      </div>
    </div>
  );
}

function Toasts() {
  const toasts = useStore((s) => s.toasts);
  return (
    <div className="pointer-events-none fixed bottom-4 left-1/2 z-[70] flex w-[min(520px,calc(100vw-24px))] -translate-x-1/2 flex-col gap-2" aria-live="polite">
      {toasts.map((t) => {
        const Icon = { info: Info, success: CheckCircle2, warning: TriangleAlert, error: XCircle }[t.kind];
        const color = { info: 'text-accent', success: 'text-good-ink', warning: 'text-warning-ink', error: 'text-critical-ink' }[t.kind];
        return (
          <div key={t.id} className="animate-fade-in pointer-events-auto flex items-start gap-2.5 rounded-xl border border-line bg-surface px-3.5 py-2.5 shadow-pop">
            <Icon className={cx('mt-0.5 h-4 w-4 shrink-0', color)} />
            <span className="flex-1 text-[13px] leading-snug text-ink">{t.text}</span>
            <button
              type="button"
              aria-label="Dismiss"
              className="text-muted hover:text-ink"
              onClick={() => set((s) => ({ toasts: s.toasts.filter((x) => x.id !== t.id) }))}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
}

function BusyOverlay() {
  const busy = useStore((s) => s.busy);
  if (!busy) return null;
  return (
    <div className="fixed inset-0 z-[65] flex items-center justify-center bg-bg/50 backdrop-blur-[2px]" role="alertdialog" aria-busy>
      <div className="w-[min(380px,90vw)] rounded-xl border border-line bg-surface p-5 shadow-pop">
        <div className="mb-3 text-[14px] font-semibold text-ink">{busy.text}</div>
        <Progress value={busy.fraction} />
      </div>
    </div>
  );
}

export default function App() {
  const theme = useResolvedTheme();
  const dark = theme === 'dark';
  const step = useStore((s) => s.step);
  const presenting = useStore((s) => s.presenting);
  const selection = useStore((s) => s.selection);
  const ready = useStore((s) => s.model.status === 'ready');
  const hasData = useStore((s) => s.images.length > 0 || s.damage.rows.length > 0);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        set({ dialog: 'save' });
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'o') {
        e.preventDefault();
        void openStudyPicker();
      }
    };
    const onUnload = (e: BeforeUnloadEvent) => {
      if (useStore.getState().dirty) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    const mq = window.matchMedia('(min-width: 768px)');
    const onWidth = () => set({ sidebarOpen: mq.matches });
    mq.addEventListener('change', onWidth);
    window.addEventListener('keydown', onKey);
    window.addEventListener('beforeunload', onUnload);
    return () => {
      mq.removeEventListener('change', onWidth);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('beforeunload', onUnload);
    };
  }, []);

  return (
    <DarkContext.Provider value={dark}>
    <div className="flex h-full flex-col bg-bg text-ink">
      <a href="#viewer" className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-[80] focus:rounded focus:bg-surface focus:px-3 focus:py-2">
        Skip to the 3D view
      </a>
      {!presenting && <TopBar />}
      <div className="relative flex min-h-0 flex-1">
        {!presenting && <Sidebar />}
        <main id="viewer" className="relative flex min-w-0 flex-1 flex-col">
          <div className={cx('relative min-h-0 flex-1', step === 'stats' && !presenting && 'invisible')}>
            <Viewer dark={dark} />
            <Welcome />
          </div>
          {!presenting && step === 'explore' && ready && hasData && <RegionMapPanel />}
          {!presenting && step === 'compare' && ready && hasData && <CompareSummary />}
          {!presenting && step === 'stats' && <StatsView />}
        </main>
        {selection && <ImagePanel />}
      </div>
      {presenting && <PresentationChrome />}
      <Dialogs />
      <Lightbox />
      <Toasts />
      <BusyOverlay />
      <GlobalDrop />
    </div>
    </DarkContext.Provider>
  );
}
