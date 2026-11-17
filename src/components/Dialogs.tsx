import { useMemo, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Box,
  FileImage,
  FileSpreadsheet,
  FileText,
  Images,
  Lock,
  Map as MapIcon,
  Play,
  Plus,
  Save,
  ShieldCheck,
  Trash2,
} from 'lucide-react';
import { downloadBlob, formatBytes, pickFiles, safeFileName } from '../lib/files';
import { saveProject } from '../lib/project';
import { csvBlob, observationRows, renderSvg, statsWorkbook, svgBlob, svgToPng, vesselRows, xlsxBlob } from '../lib/exporters';
import { exportAllPng, exportGlb, renderViewsPng, type ImageOptions } from '../lib/viewExport';
import { addScene, applyScene } from '../state/actions';
import { assets } from '../state/assets';
import { currentVessel, getScale, getVessels, targetValues, useLayout } from '../state/derived';
import { set, toast, update, useStore } from '../state/store';
import { NamingGuide } from './steps/ImagesStep';
import { RegionMap, chromeColors } from './RegionMap';
import { startPresentation } from './TopBar';
import { Button, Callout, Dialog, Field, Kbd, Segmented, Switch, cx } from './ui';

function SaveDialog() {
  const open = useStore((s) => s.dialog === 'save');
  const study = useStore((s) => s.study);
  const images = useStore((s) => s.images);
  const [withImages, setWithImages] = useState(true);
  const size = useMemo(() => images.reduce((a, i) => a + (i.size || 0), 0), [images]);
  const close = () => set({ dialog: null });
  return (
    <Dialog
      open={open}
      onClose={close}
      title="Save the study"
      description="Everything is saved as one .vessel file on your computer: model, sections, placements, damage data, treatment key and presentation."
      footer={
        <>
          <Button variant="ghost" onClick={close}>
            Cancel
          </Button>
          <Button
            variant="primary"
            icon={<Save className="h-4 w-4" />}
            onClick={async () => {
              close();
              await saveProject({ includeImages: withImages });
            }}
          >
            Save
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="Study name">
          <input className="field" value={study.name} placeholder="e.g. Catheter study 2026-03" onChange={(e) => update((s) => ({ study: { ...s.study, name: e.target.value } }))} />
        </Field>
        <Field label="Partner (optional)">
          <input className="field" value={study.partner} onChange={(e) => update((s) => ({ study: { ...s.study, partner: e.target.value } }))} />
        </Field>
        <Field label="Notes (optional)">
          <textarea className="field h-16 py-1.5" value={study.notes} onChange={(e) => update((s) => ({ study: { ...s.study, notes: e.target.value } }))} />
        </Field>
        <Switch
          label="Include the image files"
          description={
            withImages
              ? `Opens with everything in place${size ? ` (about ${formatBytes(size)} of images)` : ''}.`
              : 'Smaller file. When reopened you can relink the images from their folder.'
          }
          checked={withImages}
          onChange={setWithImages}
        />
        <Callout kind="info">The file stays on your computer like any other confidential file. Share it only through channels approved for partner data.</Callout>
      </div>
    </Dialog>
  );
}

const SIZES: Record<string, [number, number]> = {
  hd: [1920, 1080],
  '4k': [3840, 2160],
  square: [2400, 2400],
  slide: [2560, 1440],
};

function ExportDialog() {
  const open = useStore((s) => s.dialog === 'export');
  const hasRows = useStore((s) => s.damage.rows.length > 0);
  const vessels = getVessels(useStore.getState());
  const layout = useLayout();
  const [tab, setTab] = useState<'image' | 'maps' | 'data' | 'model' | 'pdf'>('image');
  const [size, setSize] = useState('hd');
  const [bg, setBg] = useState<ImageOptions['background']>('white');
  const [title, setTitle] = useState(true);
  const [legend, setLegend] = useState(true);
  const [markers, setMarkers] = useState(false);
  const [pdf, setPdf] = useState({ pageSize: 'letter' as 'letter' | 'a4', vessels: true, stats: true, data: true });
  const close = () => set({ dialog: null });
  const name = safeFileName(useStore.getState().study.name || 'study');
  const opts: ImageOptions = { width: SIZES[size][0], height: SIZES[size][1], background: bg, title, legend, markers };
  const run = async (label: string, fn: (progress: (f: number) => void) => Promise<void>) => {
    set({ busy: { text: label, fraction: null } });
    try {
      await fn((f) => set({ busy: { text: label, fraction: f } }));
      toast('Export finished.', 'success');
    } catch (e) {
      toast(`Export failed: ${e instanceof Error ? e.message : String(e)}`, 'error', 8000);
    } finally {
      set({ busy: null });
    }
  };
  const regionMapSvg = (kind: 'vessel' | 'groups') => {
    const s = useStore.getState();
    const light = chromeColors(false);
    const scale = getScale(s);
    const parts: string[] = [];
    if (kind === 'vessel') {
      const v = currentVessel(s);
      if (!v) return '';
      return renderSvg(<RegionMap values={targetValues(s, { kind: 'vessel', key: v.vKey })} scale={scale} layout={layout} width={900} colors={light} title={`${v.name} — damage by location (%)`} />);
    }
    for (const t of s.treatments) {
      if (!getVessels(s).some((v) => v.treatmentId === t.id)) continue;
      parts.push(renderSvg(<RegionMap values={targetValues(s, { kind: 'group', id: t.id })} scale={scale} layout={layout} width={900} colors={light} title={`${t.name} — average damage by location (%)`} />));
    }
    // Stack the maps vertically into one SVG document.
    let y = 0;
    const body = parts
      .map((p) => {
        const h = Number(/height="([\d.]+)"/.exec(p)?.[1] ?? 200);
        const inner = p.replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '');
        const g = `<g transform="translate(0 ${y})">${inner}</g>`;
        y += h + 24;
        return g;
      })
      .join('');
    return `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="${y}" viewBox="0 0 900 ${y}">${body}</svg>`;
  };

  const tabs = [
    { value: 'image', label: '3D images', icon: FileImage },
    { value: 'maps', label: 'Region maps', icon: MapIcon },
    { value: 'data', label: 'Data & stats', icon: FileSpreadsheet },
    { value: 'model', label: '3D model', icon: Box },
    { value: 'pdf', label: 'PDF report', icon: FileText },
  ] as const;

  return (
    <Dialog open={open} onClose={close} width={680} title="Export" description="High-resolution images, vector region maps, data tables and a PDF summary for reports and FDA submissions.">
      <div className="mb-4 flex flex-wrap gap-1.5">
        {tabs.map((t) => (
          <button
            key={t.value}
            type="button"
            onClick={() => setTab(t.value)}
            className={cx(
              'flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[12.5px] font-medium',
              tab === t.value ? 'border-accent bg-accent-soft text-accent-soft-ink' : 'border-line text-ink-2 hover:text-ink',
            )}
          >
            <t.icon className="h-3.5 w-3.5" />
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'image' && (
        <div className="space-y-3">
          <p className="text-[12.5px] text-ink-2">Exports exactly what the 3D view shows now (single vessel, side by side or all vessels), from the current camera angle.</p>
          <Field label="Size">
            <Segmented
              value={size}
              onChange={setSize}
              options={[
                { value: 'hd', label: '1920×1080' },
                { value: 'slide', label: '2560×1440' },
                { value: '4k', label: '4K' },
                { value: 'square', label: 'Square' },
              ]}
            />
          </Field>
          <Field label="Background">
            <Segmented
              value={bg}
              onChange={setBg}
              options={[
                { value: 'white', label: 'White' },
                { value: 'transparent', label: 'Transparent' },
                { value: 'dark', label: 'Dark' },
              ]}
            />
          </Field>
          <div className="flex flex-wrap gap-x-6 gap-y-1">
            <Switch inline label="Title" checked={title} onChange={setTitle} />
            <Switch inline label="Colour legend" checked={legend} onChange={setLegend} disabled={!hasRows} />
            <Switch inline label="Image markers" checked={markers} onChange={setMarkers} />
          </div>
          <div className="flex flex-wrap gap-2 pt-1">
            <Button variant="primary" icon={<FileImage className="h-4 w-4" />} onClick={() => run('Rendering the image…', async () => downloadBlob(await renderViewsPng(opts), `${name}-3d-view.png`))}>
              Download PNG
            </Button>
            <Button
              icon={<Images className="h-4 w-4" />}
              disabled={!vessels.length}
              onClick={() => run('Rendering every vessel…', async (p) => downloadBlob(await exportAllPng('vessels', opts, p), `${name}-all-vessels.zip`))}
            >
              Every vessel (.zip)
            </Button>
            <Button
              icon={<Images className="h-4 w-4" />}
              disabled={!vessels.length}
              onClick={() => run('Rendering treatment averages…', async (p) => downloadBlob(await exportAllPng('groups', opts, p), `${name}-treatment-averages.zip`))}
            >
              Treatment averages (.zip)
            </Button>
          </div>
        </div>
      )}

      {tab === 'maps' && (
        <div className="space-y-3">
          <p className="text-[12.5px] text-ink-2">
            Region maps unroll the vessel: every section, side and position as a grid of cells coloured by damage. SVG files stay sharp at any size in
            Word, PowerPoint and Illustrator.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" disabled={!vessels.length} onClick={() => downloadBlob(svgBlob(regionMapSvg('vessel')), `${name}-region-map.svg`)}>
              Current vessel (SVG)
            </Button>
            <Button disabled={!vessels.length} onClick={() => run('Rendering…', async () => downloadBlob(await svgToPng(regionMapSvg('vessel'), 3), `${name}-region-map.png`))}>
              Current vessel (PNG)
            </Button>
            <Button disabled={!vessels.length} onClick={() => downloadBlob(svgBlob(regionMapSvg('groups')), `${name}-region-maps-by-treatment.svg`)}>
              Treatment averages (SVG)
            </Button>
          </div>
        </div>
      )}

      {tab === 'data' && (
        <div className="space-y-3">
          <p className="text-[12.5px] text-ink-2">Tables of placements, damage values and statistics, for checking in JMP or Excel.</p>
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" icon={<FileSpreadsheet className="h-4 w-4" />} disabled={!hasRows} onClick={() => downloadBlob(xlsxBlob(statsWorkbook(useStore.getState())), `${name}-statistics.xlsx`)}>
              Statistics workbook (.xlsx)
            </Button>
            <Button onClick={() => downloadBlob(csvBlob(observationRows(useStore.getState())), `${name}-data.csv`)}>All images and values (.csv)</Button>
            <Button onClick={() => downloadBlob(csvBlob(vesselRows(useStore.getState())), `${name}-vessels.csv`)}>Per-vessel summary (.csv)</Button>
          </div>
          <p className="text-[11.5px] text-muted">Box plots and breakdown charts can be exported as SVG or PNG from the Statistics step.</p>
        </div>
      )}

      {tab === 'model' && (
        <div className="space-y-3">
          <p className="text-[12.5px] text-ink-2">
            The 3D model with the current colours baked in, as a .glb file. It opens in PowerPoint (Insert → 3D Models), Windows 3D Viewer, macOS Preview and
            most 3D tools.
          </p>
          <Button variant="primary" icon={<Box className="h-4 w-4" />} onClick={() => run('Exporting the 3D model…', async () => downloadBlob(await exportGlb(), `${name}-3d-model.glb`))}>
            Download .glb
          </Button>
        </div>
      )}

      {tab === 'pdf' && (
        <div className="space-y-3">
          <p className="text-[12.5px] text-ink-2">A summary report: treatment heat maps from the top and bottom, region maps, statistics, charts and the data table.</p>
          <Field label="Page size">
            <Segmented
              value={pdf.pageSize}
              onChange={(pageSize) => setPdf((p) => ({ ...p, pageSize }))}
              options={[
                { value: 'letter', label: 'US Letter' },
                { value: 'a4', label: 'A4' },
              ]}
            />
          </Field>
          <Switch label="Statistics and charts" checked={pdf.stats} onChange={(v) => setPdf((p) => ({ ...p, stats: v }))} />
          <Switch label="Every vessel" description="One small top-view heat map per vessel." checked={pdf.vessels} onChange={(v) => setPdf((p) => ({ ...p, vessels: v }))} />
          <Switch label="Data appendix" checked={pdf.data} onChange={(v) => setPdf((p) => ({ ...p, data: v }))} />
          <Button
            variant="primary"
            icon={<FileText className="h-4 w-4" />}
            onClick={() =>
              run('Building the PDF report…', async (progress) => {
                const { buildReport } = await import('../lib/report');
                const blob = await buildReport({
                  ...pdf,
                  onProgress: (f, text) => {
                    progress(f);
                    set({ busy: { text, fraction: f } });
                  },
                });
                downloadBlob(blob, `${name}-report.pdf`);
              })
            }
          >
            Create PDF
          </Button>
        </div>
      )}
    </Dialog>
  );
}

function PresentationSettingsDialog() {
  const open = useStore((s) => s.dialog === 'present-settings');
  const p = useStore((s) => s.presentation);
  const close = () => set({ dialog: null });
  const setP = (patch: Partial<typeof p>) => update((s) => ({ presentation: { ...s.presentation, ...patch } }));
  const move = (i: number, d: number) => {
    const arr = [...p.scenes];
    const j = i + d;
    if (j < 0 || j >= arr.length) return;
    [arr[i], arr[j]] = [arr[j], arr[i]];
    setP({ scenes: arr });
  };
  return (
    <Dialog
      open={open}
      onClose={close}
      width={620}
      title="Presentation"
      description="A clean, full-screen view for partner meetings. Editing controls are hidden."
      footer={
        <>
          <Button variant="ghost" onClick={close}>
            Close
          </Button>
          <Button
            variant="primary"
            icon={<Play className="h-4 w-4" />}
            disabled={useStore.getState().model.status !== 'ready'}
            onClick={() => {
              close();
              startPresentation();
            }}
          >
            Start presenting
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Title">
            <input className="field" value={p.title} placeholder="Study title" onChange={(e) => setP({ title: e.target.value })} />
          </Field>
          <Field label="Subtitle">
            <input className="field" value={p.subtitle} placeholder="e.g. Partner name · date" onChange={(e) => setP({ subtitle: e.target.value })} />
          </Field>
        </div>
        <Field label="Footer" hint="Shown at the bottom of every screen and exported image.">
          <input className="field" value={p.footer} onChange={(e) => setP({ footer: e.target.value })} />
        </Field>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex h-14 w-36 items-center justify-center overflow-hidden rounded-lg border border-dashed border-line-strong bg-surface-2">
            {p.logo ? <img src={p.logo} alt="Company logo" className="max-h-12 max-w-32 object-contain" /> : <span className="text-[11.5px] text-muted">No logo</span>}
          </div>
          <Button
            size="sm"
            onClick={async () => {
              const [f] = await pickFiles({ accept: '.png,.jpg,.jpeg,.svg,.webp' });
              if (!f) return;
              if (f.size > 2_000_000) {
                toast('Please use a logo smaller than 2 MB.', 'warning');
                return;
              }
              const reader = new FileReader();
              reader.onload = () => setP({ logo: String(reader.result) });
              reader.readAsDataURL(f);
            }}
          >
            {p.logo ? 'Change logo' : 'Add company logo'}
          </Button>
          {p.logo && (
            <Button size="sm" variant="ghost" onClick={() => setP({ logo: null })}>
              Remove
            </Button>
          )}
          <Segmented
            className="ml-auto"
            size="sm"
            value={p.dark ? 'dark' : 'light'}
            onChange={(v) => setP({ dark: v === 'dark' })}
            options={[
              { value: 'dark', label: 'Dark' },
              { value: 'light', label: 'Light' },
            ]}
          />
        </div>
        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-[12.5px] font-semibold text-ink">Scenes ({p.scenes.length})</span>
            <Button
              size="sm"
              icon={<Plus className="h-3.5 w-3.5" />}
              onClick={() => {
                const cam = assets.engine?.getCameraState();
                if (cam) addScene(cam);
              }}
            >
              Add current view
            </Button>
          </div>
          {p.scenes.length === 0 ? (
            <p className="rounded-lg bg-sunken px-3 py-2.5 text-[12px] text-ink-2">
              Scenes are saved views you step through with the arrow keys: a vessel or comparison, colouring and camera angle. Without scenes, the arrow keys
              move between vessels.
            </p>
          ) : (
            <ol className="space-y-1.5">
              {p.scenes.map((sc, i) => (
                <li key={sc.id} className="flex items-center gap-1.5 rounded-lg border border-line bg-surface-2 px-2 py-1.5">
                  <span className="tabular w-5 text-center text-[12px] text-muted">{i + 1}</span>
                  <input
                    className="field h-7 flex-1"
                    value={sc.title}
                    aria-label="Scene title"
                    onChange={(e) => setP({ scenes: p.scenes.map((x) => (x.id === sc.id ? { ...x, title: e.target.value } : x)) })}
                  />
                  <Button size="xs" variant="ghost" onClick={() => applyScene(sc)}>
                    Show
                  </Button>
                  <Button size="xs" variant="ghost" aria-label="Move up" onClick={() => move(i, -1)}>
                    <ArrowUp className="h-3 w-3" />
                  </Button>
                  <Button size="xs" variant="ghost" aria-label="Move down" onClick={() => move(i, 1)}>
                    <ArrowDown className="h-3 w-3" />
                  </Button>
                  <Button size="xs" variant="ghost" aria-label="Delete scene" onClick={() => setP({ scenes: p.scenes.filter((x) => x.id !== sc.id) })}>
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>
    </Dialog>
  );
}

function HelpDialog() {
  const open = useStore((s) => s.dialog === 'help');
  const close = () => set({ dialog: null });
  const keys: [string[], string][] = [
    [['←', '→'], 'Previous / next vessel (or scene when presenting)'],
    [['Click'], 'Open the images at a location'],
    [['Drag'], 'Rotate · right-drag or Shift-drag to pan · scroll to zoom'],
    [['R'], 'Reset the view'],
    [['Esc'], 'Close the image panel or cancel placing'],
    [['Ctrl', 'S'], 'Save the study'],
    [['Ctrl', 'O'], 'Open a study'],
    [['Space'], 'Start or stop rotation (presenting)'],
    [['O'], 'Toggle the traced outline (image viewer)'],
  ];
  return (
    <Dialog open={open} onClose={close} width={640} title="Help" description="Follow the numbered steps on the left; each one matches a phase of the project roadmap.">
      <div className="space-y-4 text-[13px] text-ink-2">
        <ol className="list-decimal space-y-1 pl-5">
          <li>
            <b className="text-ink">Load the 3D model</b>: an STL from the partner or a phone scan (GLB/OBJ/PLY).
          </li>
          <li>
            <b className="text-ink">Define sections</b>: how many sections the vessel was cut into, which end is proximal and which side is top.
          </li>
          <li>
            <b className="text-ink">Add images</b>: drop the whole folder; images are placed from their file names. Fix any flagged names by hand.
          </li>
          <li>
            <b className="text-ink">Add damage data</b>: the Excel sheet of % damage per image colours the model as a heat map.
          </li>
          <li>
            <b className="text-ink">Assign treatments</b>: the treatment key links each bioreactor to its treatment.
          </li>
          <li>
            <b className="text-ink">Explore</b>, <b className="text-ink">Compare</b> and run <b className="text-ink">Statistics</b>, then save, present or export.
          </li>
        </ol>
        <NamingGuide defaultOpen />
        <div>
          <div className="mb-1.5 text-[12.5px] font-semibold text-ink">Shortcuts</div>
          <table className="w-full">
            <tbody>
              {keys.map(([k, desc]) => (
                <tr key={desc} className="border-b border-line/70">
                  <td className="py-1.5 pr-3 whitespace-nowrap">
                    {k.map((x) => (
                      <Kbd key={x}>{x}</Kbd>
                    ))}
                  </td>
                  <td className="py-1.5 text-ink">{desc}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-[12px]">
          Supported files: STL, GLB, glTF, OBJ (+MTL), PLY or a .zip of these for models; TIFF (8/16-bit), JPEG, PNG, BMP for images; .xlsx or .csv for data;
          .vessel for saved studies.
        </p>
      </div>
    </Dialog>
  );
}

function PrivacyDialog() {
  const open = useStore((s) => s.dialog === 'privacy');
  const close = () => set({ dialog: null });
  const points: [string, string][] = [
    ['Processing happens on your computer', 'Images, spreadsheets and models are opened in this browser tab. Nothing is sent to a server, an AI service or anyone else.'],
    [
      'The browser enforces it',
      "The page ships with a Content-Security-Policy that only allows it to load its own files. Requests to any other site are blocked by the browser, so data can't be sent anywhere even by mistake.",
    ],
    ['No AI in the app', 'The viewer is ordinary code that reads file names and numbers. Images are only decoded for display.'],
    [
      'Nothing is kept after you close the tab',
      'Study data is never written to browser storage. Only your light/dark preference is remembered. To keep a study, save a .vessel file to your computer.',
    ],
    ['Data is kept out of the repository', 'Only the app code is on GitHub. Its .gitignore blocks common data files (models, images, spreadsheets, saved studies).'],
    [
      'Sharing with partners',
      'Show results in a live meeting (Present), or give each partner only their own study file or exports. Avoid public links that contain partner data.',
    ],
  ];
  return (
    <Dialog open={open} onClose={close} width={600} title="Confidentiality" description="Partner data often concerns devices still in FDA review. The app is built so it stays private.">
      <ul className="space-y-3">
        {points.map(([title, text]) => (
          <li key={title} className="flex gap-3">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-good-ink" />
            <div>
              <div className="text-[13px] font-semibold text-ink">{title}</div>
              <div className="text-[12.5px] leading-relaxed text-ink-2">{text}</div>
            </div>
          </li>
        ))}
      </ul>
      <div className="mt-4 flex items-start gap-2 rounded-lg bg-sunken px-3 py-2.5 text-[12px] text-ink-2">
        <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>
          Check it yourself: open your browser's developer tools, Network tab, then add files. No requests leave the page. For extra assurance, run the app
          locally or on private hosting (see the README).
        </span>
      </div>
    </Dialog>
  );
}

export function Dialogs() {
  return (
    <>
      <SaveDialog />
      <ExportDialog />
      <PresentationSettingsDialog />
      <HelpDialog />
      <PrivacyDialog />
    </>
  );
}
