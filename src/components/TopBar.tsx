import { useState } from 'react';
import {
  CircleHelp,
  Download,
  FilePlus2,
  FolderOpen,
  Lock,
  Menu,
  Monitor,
  Moon,
  MoreHorizontal,
  Presentation,
  Save,
  Sparkles,
  Sun,
} from 'lucide-react';
import { pickFiles } from '../lib/files';
import { openProject, PROJECT_EXT, saveProject } from '../lib/project';
import { loadDemo, newStudy } from '../state/actions';
import { set, setTheme, update, useStore } from '../state/store';
import { Button, cx, IconButton } from './ui';

export function AppLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden>
      <rect width="64" height="64" rx="14" fill="#0d366b" />
      <path d="M10 42c8 0 10-20 22-20s12 20 22 20" fill="none" stroke="#86b6ef" strokeWidth="12" strokeLinecap="round" />
      <path d="M10 42c8 0 10-20 22-20s12 20 22 20" fill="none" stroke="#fdd49e" strokeWidth="5" strokeLinecap="round" />
      <circle cx="32" cy="22" r="4.5" fill="#d7301f" />
    </svg>
  );
}

export async function openStudyPicker() {
  const files = await pickFiles({ accept: `${PROJECT_EXT},.zip` });
  if (files[0]) await openProject(files[0]);
}

export function startPresentation() {
  set({ presenting: true, selection: null, toasts: [] });
  document.documentElement.requestFullscreen?.().catch(() => {});
}

export function TopBar() {
  const name = useStore((s) => s.study.name);
  const dirty = useStore((s) => s.dirty);
  const theme = useStore((s) => s.theme);
  const ready = useStore((s) => s.model.status === 'ready');
  const [menu, setMenu] = useState(false);
  const nextTheme = theme === 'system' ? 'light' : theme === 'light' ? 'dark' : 'system';
  const ThemeIcon = theme === 'system' ? Monitor : theme === 'light' ? Sun : Moon;

  return (
    <header className="relative z-30 flex h-12 shrink-0 items-center gap-2 border-b border-line bg-surface px-2 sm:px-3">
      <IconButton label="Show steps" className="md:hidden" onClick={() => set((s) => ({ sidebarOpen: !s.sidebarOpen }))}>
        <Menu className="h-4 w-4" />
      </IconButton>
      <div className="flex min-w-0 items-center gap-2">
        <AppLogo className="h-7 w-7 shrink-0" />
        <span className="hidden text-[14px] font-semibold whitespace-nowrap text-ink sm:inline">3D Vessel Model</span>
        <span className="hidden h-5 w-px bg-line sm:inline-block" aria-hidden />
        <label className="sr-only" htmlFor="study-name">
          Study name
        </label>
        <input
          id="study-name"
          value={name}
          placeholder="Untitled study"
          onChange={(e) => update((s) => ({ study: { ...s.study, name: e.target.value } }))}
          className="h-8 w-[220px] min-w-0 truncate rounded-md border border-transparent bg-transparent px-2 text-[13px] text-ink placeholder:text-muted hover:border-line focus:border-accent focus:outline-none max-sm:hidden"
        />
        {dirty && (
          <span className="hidden text-[11.5px] whitespace-nowrap text-muted lg:inline" title="Changes since the last save">
            Unsaved changes
          </span>
        )}
      </div>

      <div className="ml-auto flex items-center gap-1">
        <button
          type="button"
          onClick={() => set({ dialog: 'privacy' })}
          className="mr-1 hidden items-center gap-1.5 rounded-full border border-line bg-good-soft px-2.5 py-1 text-[11.5px] font-medium text-good-ink hover:border-good md:inline-flex"
        >
          <Lock className="h-3 w-3" /> Data stays on this computer
        </button>
        <IconButton label="Privacy" className="md:hidden" onClick={() => set({ dialog: 'privacy' })}>
          <Lock className="h-4 w-4" />
        </IconButton>
        <Button variant="ghost" size="md" icon={<FolderOpen className="h-4 w-4" />} onClick={openStudyPicker} className="max-sm:hidden">
          <span className="hidden lg:inline">Open</span>
        </Button>
        <Button
          variant="ghost"
          size="md"
          icon={<Save className="h-4 w-4" />}
          onClick={() => set({ dialog: 'save' })}
          className="max-sm:hidden"
          title="Save study (Ctrl+S)"
        >
          <span className="hidden lg:inline">Save</span>
        </Button>
        <Button
          variant="ghost"
          size="md"
          icon={<Download className="h-4 w-4" />}
          disabled={!ready}
          onClick={() => set({ dialog: 'export' })}
          className="max-sm:hidden"
        >
          <span className="hidden lg:inline">Export</span>
        </Button>
        <Button
          variant="primary"
          size="md"
          icon={<Presentation className="h-4 w-4" />}
          disabled={!ready}
          onClick={startPresentation}
        >
          <span className="hidden sm:inline">Present</span>
        </Button>
        <div className="relative">
          <IconButton label="More" onClick={() => setMenu((m) => !m)} active={menu}>
            <MoreHorizontal className="h-4 w-4" />
          </IconButton>
          {menu && (
            <div className="absolute top-full right-0 mt-1.5 w-60 rounded-lg border border-line bg-surface p-1 shadow-pop" onMouseLeave={() => setMenu(false)}>
              {[
                { icon: FilePlus2, label: 'New study', run: newStudy },
                { icon: FolderOpen, label: 'Open study…', run: openStudyPicker },
                { icon: Save, label: 'Save study…', run: () => set({ dialog: 'save' }) },
                { icon: Save, label: 'Save as…', run: () => saveProject({ includeImages: true, saveAs: true }) },
                { icon: Download, label: 'Export…', run: () => set({ dialog: 'export' }) },
                { icon: Presentation, label: 'Presentation settings…', run: () => set({ dialog: 'present-settings' }) },
                { icon: Sparkles, label: 'Load the demo study', run: loadDemo },
                { icon: CircleHelp, label: 'Help & shortcuts', run: () => set({ dialog: 'help' }) },
              ].map((m) => (
                <button
                  key={m.label}
                  type="button"
                  onClick={() => {
                    setMenu(false);
                    void m.run();
                  }}
                  className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-[13px] text-ink hover:bg-sunken"
                >
                  <m.icon className="h-4 w-4 text-ink-2" />
                  {m.label}
                </button>
              ))}
            </div>
          )}
        </div>
        <IconButton label="Help" onClick={() => set({ dialog: 'help' })} className="max-sm:hidden">
          <CircleHelp className="h-4 w-4" />
        </IconButton>
        <IconButton label={`Theme: ${theme} (click for ${nextTheme})`} onClick={() => setTheme(nextTheme)} side="left">
          <ThemeIcon className={cx('h-4 w-4')} />
        </IconButton>
      </div>
    </header>
  );
}
