import {
  BarChart3,
  Box,
  FileSpreadsheet,
  FolderOpen,
  GitCompareArrows,
  Images,
  Layers,
  Lock,
  MousePointerClick,
  ShieldCheck,
  Sparkles,
  Tags,
} from 'lucide-react';
import { pickFiles } from '../lib/files';
import { MODEL_EXTENSIONS } from '../three/loaders';
import { loadDemo, loadModel } from '../state/actions';
import { set, useStore } from '../state/store';
import { AppLogo, openStudyPicker } from './TopBar';
import { Button } from './ui';

const PHASES = [
  { icon: Box, title: 'Load model', text: 'STL or phone scan' },
  { icon: Layers, title: 'Sections', text: 'Top/bottom, P·M·D' },
  { icon: Images, title: 'Images', text: 'Placed from file names' },
  { icon: FileSpreadsheet, title: 'Damage data', text: 'Excel → heat map' },
  { icon: Tags, title: 'Treatments', text: 'Treatment key' },
  { icon: MousePointerClick, title: 'Explore', text: 'Click to inspect' },
  { icon: GitCompareArrows, title: 'Compare', text: 'Side by side' },
  { icon: BarChart3, title: 'Statistics', text: 'ANOVA, Kruskal–Wallis' },
];

export function Welcome() {
  const status = useStore((s) => s.model.status);
  if (status !== 'empty' && status !== 'error') return null;
  return (
    <div className="scroll-thin absolute inset-0 z-10 overflow-y-auto">
      <div className="mx-auto flex min-h-full max-w-[900px] flex-col justify-center px-5 py-10">
        <div className="mb-4 flex items-center gap-3">
          <AppLogo className="h-11 w-11" />
          <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-good-soft px-3 py-1 text-[12px] font-medium text-good-ink">
            <Lock className="h-3.5 w-3.5" /> Runs entirely in your browser · nothing is uploaded
          </span>
        </div>
        <h1 className="text-[30px] leading-tight font-semibold tracking-tight text-ink sm:text-[36px]">See vessel damage in 3D</h1>
        <p className="mt-3 max-w-[640px] text-[15px] leading-relaxed text-ink-2">
          Map every image to the place on the vessel mimic where it was taken, colour the model by percent damage, and compare treatments with
          partners on a 3D model instead of paging through folders of images.
        </p>

        <div className="mt-7 grid gap-3 sm:grid-cols-3">
          <button
            type="button"
            onClick={loadDemo}
            className="group flex flex-col items-start rounded-xl border border-accent bg-accent-soft p-4 text-left transition-shadow hover:shadow-card"
          >
            <Sparkles className="h-5 w-5 text-accent" />
            <span className="mt-3 text-[15px] font-semibold text-ink">Explore the demo study</span>
            <span className="mt-1 text-[12.5px] leading-snug text-ink-2">15 synthetic vessels, 3 treatments, images and damage data.</span>
          </button>
          <button
            type="button"
            onClick={async () => {
              const files = await pickFiles({ accept: MODEL_EXTENSIONS.join(','), multiple: true });
              if (files.length) {
                set({ step: 'model' });
                await loadModel(files);
              }
            }}
            className="group flex flex-col items-start rounded-xl border border-line bg-surface p-4 text-left transition-shadow hover:border-line-strong hover:shadow-card"
          >
            <Box className="h-5 w-5 text-ink-2" />
            <span className="mt-3 text-[15px] font-semibold text-ink">Start a new study</span>
            <span className="mt-1 text-[12.5px] leading-snug text-ink-2">Load an STL from the partner or a phone scan (GLB, OBJ, PLY).</span>
          </button>
          <button
            type="button"
            onClick={openStudyPicker}
            className="group flex flex-col items-start rounded-xl border border-line bg-surface p-4 text-left transition-shadow hover:border-line-strong hover:shadow-card"
          >
            <FolderOpen className="h-5 w-5 text-ink-2" />
            <span className="mt-3 text-[15px] font-semibold text-ink">Open a saved study</span>
            <span className="mt-1 text-[12.5px] leading-snug text-ink-2">A .vessel file restores the model, images, data and settings.</span>
          </button>
        </div>

        <h2 className="mt-9 mb-3 text-[12px] font-semibold tracking-wider text-muted uppercase">How it works</h2>
        <ol className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {PHASES.map((p, i) => (
            <li key={p.title} className="flex items-start gap-2.5 rounded-lg border border-line bg-surface/80 p-2.5">
              <span className="tabular flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-sunken text-[11.5px] font-semibold text-ink-2">
                {i + 1}
              </span>
              <span className="min-w-0">
                <span className="flex items-center gap-1.5 text-[13px] font-semibold text-ink">
                  <p.icon className="h-3.5 w-3.5 text-accent" /> {p.title}
                </span>
                <span className="block text-[11.5px] leading-snug text-ink-2">{p.text}</span>
              </span>
            </li>
          ))}
        </ol>
        <p className="mt-3 text-[12.5px] text-ink-2">
          Then <b className="font-medium text-ink">save</b> the study as one file, <b className="font-medium text-ink">present</b> it in a clean
          full-screen view, and <b className="font-medium text-ink">export</b> heat maps, charts and a PDF summary for reports and FDA submissions.
        </p>

        <div className="mt-7 flex items-start gap-3 rounded-xl border border-line bg-surface p-4">
          <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-good-ink" />
          <div className="text-[12.5px] leading-relaxed text-ink-2">
            <b className="font-semibold text-ink">Confidential by design.</b> Images, spreadsheets and models are opened in this browser tab and
            are never sent to a server or an AI service. The page's security policy blocks it from contacting other sites, and nothing is kept
            after you close the tab unless you save a study file.{' '}
            <Button variant="ghost" size="xs" className="!px-1 text-accent" onClick={() => set({ dialog: 'privacy' })}>
              Learn more
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
