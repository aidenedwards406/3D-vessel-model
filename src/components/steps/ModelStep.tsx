import { Box, Download, RotateCw, Sparkles } from 'lucide-react';
import { downloadBlob, formatBytes } from '../../lib/files';
import { MODEL_EXTENSIONS } from '../../three/loaders';
import { downloadDemoFiles, layFlat, loadDemo, loadModel, setUpAxis } from '../../state/actions';
import { update, useStore, type UpAxis, type Units } from '../../state/store';
import { Badge, Button, Callout, Dropzone, Field, Progress, Segmented } from '../ui';
import { Card, Help, KeyValue, NextButton } from './common';

const UNIT_FACTORS: Record<Units, number> = { mm: 1, cm: 10, m: 1000, in: 25.4 };

export function formatLength(value: number, units: Units): string {
  const mm = value * UNIT_FACTORS[units];
  if (mm >= 1000) return `${(mm / 1000).toFixed(2)} m`;
  if (mm >= 10) return `${mm.toFixed(1)} mm`;
  return `${mm.toFixed(2)} mm`;
}

export function ModelStep() {
  const model = useStore((s) => s.model);
  const accept = MODEL_EXTENSIONS.join(',');
  const busy = model.status === 'loading' || model.status === 'processing';

  return (
    <div className="space-y-3">
      <Help>
        Load the partner's CAD model as an <b>STL</b> (SolidWorks: <i>File → Save As → STL</i>) or a phone scan exported as{' '}
        <b>GLB</b>, <b>OBJ</b> or <b>PLY</b> from apps such as Polycam, Scaniverse or KIRI Engine.
      </Help>

      {model.status !== 'ready' && !busy && (
        <>
          <Dropzone
            onFiles={loadModel}
            accept={accept}
            multiple
            title="Drop a model here, or click to choose"
            hint="STL, GLB, glTF, OBJ, PLY, or a .zip from a scanning app. For OBJ or glTF, include the texture files too."
            icon={<Box className="h-4 w-4" />}
          />
          {model.status === 'error' && model.error && <Callout kind="error" title="The model couldn't be used">{model.error}</Callout>}
          <div className="flex flex-wrap items-center gap-2 text-[12px] text-ink-2">
            <span>No model handy?</span>
            <Button size="sm" variant="soft" icon={<Sparkles className="h-3.5 w-3.5" />} onClick={loadDemo}>
              Try the demo study
            </Button>
            <Button
              size="sm"
              variant="ghost"
              icon={<Download className="h-3.5 w-3.5" />}
              onClick={() => downloadBlob(downloadDemoFiles().stl, 'demo-vessel.stl')}
            >
              Sample STL
            </Button>
          </div>
        </>
      )}

      {busy && (
        <Card>
          <div className="mb-2 truncate text-[13px] font-medium text-ink">{model.name}</div>
          <Progress value={model.progress?.fraction ?? null} />
          <div className="mt-2 text-[12px] text-ink-2">{model.progress?.stage ?? 'Working…'}</div>
        </Card>
      )}

      {model.status === 'ready' && (
        <>
          <Card>
            <div className="mb-2 flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="truncate text-[13px] font-semibold text-ink" title={model.name}>
                  {model.name}
                </div>
                <div className="text-[11.5px] text-muted">
                  {model.format.toUpperCase()}
                  {model.size ? ` · ${formatBytes(model.size)}` : ''}
                  {model.isDemo ? ' · synthetic demo' : ''}
                </div>
              </div>
              <Badge tone={model.quality > 0.75 ? 'good' : model.quality > 0.5 ? 'warning' : 'critical'}>
                {model.quality > 0.75 ? 'Tube detected' : model.quality > 0.5 ? 'Check fit' : 'Poor fit'}
              </Badge>
            </div>
            <KeyValue
              items={[
                ['Length along centerline', formatLength(model.length, model.units)],
                ['Mean outer diameter', formatLength(model.meanRadius * 2, model.units)],
                ['Triangles', model.triangleCount.toLocaleString()],
                ['Centerline', model.method === 'curved' ? 'Curved (follows bends)' : 'Straight axis'],
              ]}
            />
          </Card>
          {model.warnings.map((w) => (
            <Callout key={w} kind="warning">
              {w}
            </Callout>
          ))}

          <Field label="Model units" hint="STL files don't store units. CAD exports are usually millimetres; phone scans are usually metres.">
            <Segmented<Units>
              value={model.units}
              onChange={(units) => update((s) => ({ model: { ...s.model, units } }))}
              options={[
                { value: 'mm', label: 'mm' },
                { value: 'cm', label: 'cm' },
                { value: 'm', label: 'm' },
                { value: 'in', label: 'in' },
              ]}
              className="w-full"
            />
          </Field>

          <Field label="Which axis points up?" hint="Top/bottom halves are measured from the up direction. Use “Lay flat” for a curved vessel lying on a table.">
            <div className="flex flex-wrap gap-1.5">
              <Segmented<UpAxis>
                size="sm"
                value={model.rotation ? ('custom' as UpAxis) : model.upAxis}
                onChange={setUpAxis}
                options={[
                  { value: 'y', label: '+Y' },
                  { value: 'z', label: '+Z' },
                  { value: 'x', label: '+X' },
                  { value: '-y', label: '−Y' },
                  { value: '-z', label: '−Z' },
                ]}
              />
              <Button size="sm" variant={model.rotation ? 'soft' : 'secondary'} icon={<RotateCw className="h-3.5 w-3.5" />} onClick={layFlat}>
                Lay flat
              </Button>
            </div>
          </Field>

          <Dropzone
            compact
            onFiles={loadModel}
            accept={accept}
            multiple
            title="Replace the model"
            hint="Your images, data and settings are kept."
            icon={<Box className="h-3.5 w-3.5" />}
          />
          <NextButton to="sections">Next: define sections</NextButton>
        </>
      )}
    </div>
  );
}
