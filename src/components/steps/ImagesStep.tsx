import { useMemo, useState } from 'react';
import { Check, ChevronDown, Crosshair, EyeOff, FileWarning, Images, Link2, MapPin, Pencil, Trash2, Undo2 } from 'lucide-react';
import { NAME_EXAMPLE, positionLabel, type Side } from '../../lib/naming';
import { medialCount } from '../../lib/regions';
import { pickFiles } from '../../lib/files';
import type { ImageItem } from '../../lib/study';
import { addImageFiles, placeImage, removeAllImages, setImageExcluded } from '../../state/actions';
import { assets } from '../../state/assets';
import { currentVessel, useDerived, useLayout, useVessels } from '../../state/derived';
import { set, toast, useStore } from '../../state/store';
import { Badge, Button, Callout, Dropzone, Stat, cx } from '../ui';
import { Help, NextButton } from './common';

export function NamingGuide({ defaultOpen = false }: { defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const parts: [string, string, string][] = [
    ['BRS24-10', 'Bioreactor ID', 'Identifies the vessel and its treatment'],
    ['4x', 'Magnification', 'Normally 4x'],
    ['2', 'Section', 'Usually 1–4 or 1–6'],
    ['T', 'Side', 'T = top, B = bottom'],
    ['M2', 'Position', 'P = proximal, M1, M2… = medial, D = distal'],
  ];
  const colors = ['#2a78d6', '#6250d6', '#eb6834', '#1baf7a', '#e34948'];
  return (
    <div className="rounded-lg border border-line bg-surface-2">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left"
      >
        <span className="text-[12.5px] font-medium text-ink">Naming convention</span>
        <span className="flex items-center gap-1 font-mono text-[11.5px] text-ink-2">
          {NAME_EXAMPLE}
          <ChevronDown className={cx('h-3.5 w-3.5 transition-transform', open && 'rotate-180')} />
        </span>
      </button>
      {open && (
        <div className="border-t border-line px-3 py-2.5">
          <div className="mb-2 font-mono text-[14px] font-semibold">
            {parts.map(([p], i) => (
              <span key={p}>
                <span style={{ color: colors[i] }}>{p}</span>
                {i < parts.length - 1 && <span className="text-muted">_</span>}
              </span>
            ))}
          </div>
          <table className="w-full text-[12px]">
            <tbody>
              {parts.map(([p, name, desc], i) => (
                <tr key={p} className="align-top">
                  <td className="py-0.5 pr-2 font-mono font-semibold" style={{ color: colors[i] }}>
                    {p}
                  </td>
                  <td className="py-0.5 pr-2 whitespace-nowrap text-ink">{name}</td>
                  <td className="py-0.5 text-ink-2">{desc}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-[11.5px] text-muted">
            Case, file extensions and spaces instead of underscores are fine. Suffixes such as <span className="font-mono">_2</span> add more images at the
            same spot; <span className="font-mono">_trace</span> or <span className="font-mono">_mask</span> marks a traced damage outline.
          </p>
        </div>
      )}
    </div>
  );
}

export function PlacementEditor({ image, onDone }: { image: ImageItem; onDone?: () => void }) {
  const vessels = useVessels();
  const layout = useLayout();
  const cur = useStore(currentVessel);
  const guessVessel = image.manual?.bioreactor ?? image.parsed?.bioreactor ?? cur?.name ?? vessels[0]?.name ?? '';
  const [vessel, setVessel] = useState(guessVessel);
  const [section, setSection] = useState(image.manual?.section ?? image.parsed?.section ?? 1);
  const [side, setSide] = useState<Side>(image.manual?.side ?? image.parsed?.side ?? 'T');
  const positions = layout.positions[Math.max(0, Math.min(layout.count - 1, section - 1))] ?? ['P'];
  const [positionRaw, setPosition] = useState(image.manual?.position ?? image.parsed?.position ?? 'P');
  const position = positions.includes(positionRaw) ? positionRaw : positions[0];
  const valid = vessel.trim().length > 0;
  return (
    <div className="mt-2 space-y-2 rounded-md border border-line bg-surface p-2.5">
      <div className="grid grid-cols-2 gap-2">
        <label className="col-span-2 text-[11.5px] text-ink-2">
          Vessel (bioreactor ID)
          <input className="field mt-0.5" list="vessel-ids" value={vessel} onChange={(e) => setVessel(e.target.value)} placeholder="e.g. BRS24-10" />
          <datalist id="vessel-ids">
            {vessels.map((v) => (
              <option key={v.vKey} value={v.name} />
            ))}
          </datalist>
        </label>
        <label className="text-[11.5px] text-ink-2">
          Section
          <select className="field mt-0.5" value={section} onChange={(e) => setSection(Number(e.target.value))}>
            {Array.from({ length: layout.count }, (_v, i) => (
              <option key={i} value={i + 1}>
                {i + 1}
              </option>
            ))}
          </select>
        </label>
        <label className="text-[11.5px] text-ink-2">
          Side
          <select className="field mt-0.5" value={side} onChange={(e) => setSide(e.target.value as Side)}>
            <option value="T">Top</option>
            <option value="B">Bottom</option>
          </select>
        </label>
        <label className="col-span-2 text-[11.5px] text-ink-2">
          Position
          <select className="field mt-0.5" value={position} onChange={(e) => setPosition(e.target.value)}>
            {positions.map((p) => (
              <option key={p} value={p}>
                {p} · {positionLabel(p, medialCount(positions))}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="flex flex-wrap gap-1.5">
        <Button
          size="sm"
          variant="primary"
          disabled={!valid}
          icon={<Check className="h-3.5 w-3.5" />}
          onClick={() => {
            placeImage(image.id, { bioreactor: vessel.trim(), section, side, position });
            toast(`Placed ${image.fileName}.`, 'success');
            onDone?.();
          }}
        >
          Save
        </Button>
        <Button
          size="sm"
          disabled={!valid || useStore.getState().model.status !== 'ready'}
          icon={<Crosshair className="h-3.5 w-3.5" />}
          onClick={() => {
            set({ placing: { imageId: image.id, vessel: vessel.trim() }, vessel: vessel.trim().toUpperCase() });
            onDone?.();
          }}
        >
          Pick on model
        </Button>
        {image.manual && (
          <Button size="sm" variant="ghost" icon={<Undo2 className="h-3.5 w-3.5" />} onClick={() => placeImage(image.id, null)}>
            Use file name
          </Button>
        )}
      </div>
    </div>
  );
}

function UnplacedRow({ image }: { image: ImageItem }) {
  const [open, setOpen] = useState(false);
  return (
    <li className="rounded-lg border border-line bg-surface-2 px-2.5 py-2">
      <div className="flex items-start gap-2">
        <FileWarning className="mt-0.5 h-4 w-4 shrink-0 text-warning-ink" />
        <div className="min-w-0 flex-1">
          <div className="truncate font-mono text-[12px] text-ink" title={image.fileName}>
            {image.fileName}
          </div>
          <div className="text-[11.5px] leading-snug text-ink-2">{image.parseError}</div>
        </div>
      </div>
      <div className="mt-1.5 flex gap-1.5 pl-6">
        <Button size="xs" variant={open ? 'soft' : 'secondary'} icon={<MapPin className="h-3 w-3" />} onClick={() => setOpen((o) => !o)}>
          Place by hand
        </Button>
        <Button size="xs" variant="ghost" icon={<EyeOff className="h-3 w-3" />} onClick={() => setImageExcluded(image.id, true)}>
          Ignore
        </Button>
      </div>
      {open && <PlacementEditor image={image} onDone={() => setOpen(false)} />}
    </li>
  );
}

export function ImagesStep() {
  const images = useStore((s) => s.images);
  const d = useDerived();
  const vessels = useVessels();
  const [showManual, setShowManual] = useState(false);
  const counts = useMemo(() => {
    const active = images.filter((i) => !i.excluded);
    return {
      total: active.length,
      overlays: active.filter((i) => i.parsed?.overlay && !i.manual).length,
      manual: active.filter((i) => i.manual).length,
      excluded: images.filter((i) => i.excluded).length,
      missing: images.filter((i) => !assets.images.has(i.id)).length,
    };
  }, [images]);
  const placed = counts.total - counts.overlays - d.unplacedImages.length;

  return (
    <div className="space-y-3">
      <Help>
        Add all of a study's images at once. Each one is pinned to its location on the model by reading its file name. Images don't need to cover
        the whole vessel.
      </Help>
      <NamingGuide defaultOpen={images.length === 0} />
      <Dropzone
        onFiles={addImageFiles}
        accept=".tif,.tiff,.jpg,.jpeg,.png,.bmp,.gif,.webp"
        directory
        title={images.length ? 'Add more images' : 'Drop images or a folder here'}
        hint="TIFF, JPEG, PNG, BMP. Nothing is uploaded; images stay on this computer."
        icon={<Images className="h-4 w-4" />}
      />

      {images.length > 0 && (
        <>
          <div className="grid grid-cols-2 gap-2">
            <Stat label="Placed from names" value={placed.toLocaleString()} sub={`${vessels.length} vessel${vessels.length === 1 ? '' : 's'}`} />
            <Stat
              label="Need placing"
              value={<span className={d.unplacedImages.length ? 'text-warning-ink' : ''}>{d.unplacedImages.length}</span>}
              sub={counts.manual ? `${counts.manual} placed by hand` : 'names not recognised'}
            />
          </div>
          {counts.overlays > 0 && (
            <Callout kind="info">
              {counts.overlays} traced outline{counts.overlays === 1 ? '' : 's'} found. Turn them on in the image viewer to see the traced damage over
              the original.
            </Callout>
          )}
          {counts.missing > 0 && (
            <Callout
              kind="warning"
              title={`${counts.missing} image file${counts.missing === 1 ? ' is' : 's are'} missing`}
              action={
                <Button
                  size="sm"
                  icon={<Link2 className="h-3.5 w-3.5" />}
                  onClick={async () => {
                    const files = await pickFiles({ directory: true, multiple: true });
                    const byName = new Map(files.map((f) => [f.name.toLowerCase(), f]));
                    let n = 0;
                    for (const img of useStore.getState().images) {
                      const f = byName.get(img.fileName.toLowerCase());
                      if (f && !assets.images.has(img.id)) {
                        assets.images.set(img.id, f);
                        n++;
                      }
                    }
                    set((s) => ({ images: [...s.images] }));
                    toast(`Relinked ${n} image${n === 1 ? '' : 's'}.`, n ? 'success' : 'warning');
                  }}
                >
                  Relink from a folder
                </Button>
              }
            >
              The study was saved without images. Choose the image folder to show them again.
            </Callout>
          )}

          {d.unplacedImages.length > 0 && (
            <div>
              <div className="mb-1.5 text-[12px] font-semibold text-ink">Names that need attention</div>
              <ul className="space-y-1.5">
                {d.unplacedImages.slice(0, 50).map((img) => (
                  <UnplacedRow key={img.id} image={img} />
                ))}
              </ul>
              {d.unplacedImages.length > 50 && <p className="mt-1 text-[11.5px] text-muted">…and {d.unplacedImages.length - 50} more.</p>}
            </div>
          )}

          {counts.manual > 0 && (
            <div>
              <button type="button" className="flex items-center gap-1 text-[12px] font-medium text-ink-2 hover:text-ink" onClick={() => setShowManual((v) => !v)}>
                <Pencil className="h-3 w-3" /> {counts.manual} placed by hand
                <ChevronDown className={cx('h-3 w-3 transition-transform', showManual && 'rotate-180')} />
              </button>
              {showManual && (
                <ul className="mt-1.5 space-y-1">
                  {images
                    .filter((i) => i.manual && !i.excluded)
                    .map((i) => (
                      <li key={i.id} className="flex items-center justify-between gap-2 rounded-md bg-surface-2 px-2 py-1 text-[11.5px]">
                        <span className="truncate font-mono" title={i.fileName}>
                          {i.fileName}
                        </span>
                        <Badge tone="accent">
                          {i.manual!.bioreactor} · S{i.manual!.section} {i.manual!.side} {i.manual!.position}
                        </Badge>
                      </li>
                    ))}
                </ul>
              )}
            </div>
          )}

          {counts.excluded > 0 && (
            <button
              type="button"
              className="text-[12px] text-accent hover:underline"
              onClick={() => {
                for (const i of useStore.getState().images.filter((x) => x.excluded)) setImageExcluded(i.id, false);
              }}
            >
              Restore {counts.excluded} ignored image{counts.excluded === 1 ? '' : 's'}
            </button>
          )}

          <div className="flex justify-end">
            <Button
              size="sm"
              variant="danger"
              icon={<Trash2 className="h-3.5 w-3.5" />}
              onClick={() => {
                if (window.confirm('Remove all images from this study? Your files on disk are not affected.')) removeAllImages();
              }}
            >
              Remove all images
            </Button>
          </div>
        </>
      )}
      <NextButton to="damage">Next: add damage data</NextButton>
    </div>
  );
}
