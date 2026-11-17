import { useState } from 'react';
import { ArrowDown, ArrowUp, Download, KeyRound, Plus, Trash2 } from 'lucide-react';
import { seriesColor, formatPercent } from '../../lib/colormaps';
import { downloadBlob } from '../../lib/files';
import { writeXlsx, type CellValue } from '../../lib/spreadsheet';
import type { TreatmentRole } from '../../lib/study';
import {
  addTreatment,
  loadTreatmentKeyFile,
  moveTreatment,
  removeTreatment,
  setVesselTreatment,
  updateTreatment,
} from '../../state/actions';
import { useVessels } from '../../state/derived';
import { useStore } from '../../state/store';
import { useDark } from '../useTheme';
import { Button, Callout, Dropzone, IconButton, cx } from '../ui';
import { Help, NextButton } from './common';

const ROLES: { value: TreatmentRole; label: string }[] = [
  { value: 'control', label: 'Control' },
  { value: 'investigational', label: 'Investigational device' },
  { value: 'standard', label: 'Market standard' },
  { value: 'other', label: 'Other' },
];

export function TreatmentsStep() {
  const vessels = useVessels();
  const treatments = useStore((s) => s.treatments);
  const vt = useStore((s) => s.vesselTreatment);
  const dark = useDark();
  const [newName, setNewName] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const unassigned = vessels.filter((v) => !vt[v.vKey]).length;

  const exportKey = () => {
    const rows: CellValue[][] = [['Bioreactor', 'Treatment']];
    for (const v of vessels) rows.push([v.name, treatments.find((t) => t.id === vt[v.vKey])?.name ?? '']);
    if (vessels.length === 0) rows.push(['BRS24-01', 'Control'], ['BRS24-02', 'Investigational device'], ['BRS24-03', 'Market standard']);
    downloadBlob(
      new Blob([writeXlsx([{ name: 'Treatment key', rows }])], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
      'treatment-key.xlsx',
    );
  };

  const toggle = (k: string) =>
    setSelected((prev) => {
      const n = new Set(prev);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });

  return (
    <div className="space-y-3">
      <Help>
        The bioreactor ID doesn't say which treatment a vessel received, so add a <b>treatment key</b>: a small table matching each bioreactor ID to its
        treatment. Upload one, use a column in the damage sheet, or assign treatments here.
      </Help>
      <Dropzone
        onFiles={(f) => f[0] && loadTreatmentKeyFile(f[0])}
        accept=".xlsx,.xlsm,.csv,.tsv,.txt"
        multiple={false}
        compact
        title="Upload a treatment key"
        hint="Two columns: bioreactor ID and treatment."
        icon={<KeyRound className="h-3.5 w-3.5" />}
      />
      <button type="button" onClick={exportKey} className="flex items-center gap-1.5 text-[12px] font-medium text-accent hover:underline">
        <Download className="h-3.5 w-3.5" />
        {vessels.length ? 'Download the key with your vessel IDs' : 'Download a treatment key template'}
      </button>

      <div>
        <div className="mb-1.5 text-[12px] font-semibold text-ink">Treatment groups</div>
        {treatments.length === 0 && <p className="text-[12px] text-muted">No treatments yet.</p>}
        <ul className="space-y-1.5">
          {treatments.map((t, i) => {
            const n = vessels.filter((v) => vt[v.vKey] === t.id).length;
            return (
              <li key={t.id} className="rounded-lg border border-line bg-surface-2 p-2">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    title="Change colour"
                    aria-label={`Colour for ${t.name}. Click to change.`}
                    onClick={() => updateTreatment(t.id, { slot: (t.slot + 1) % 8 })}
                    className="h-5 w-5 shrink-0 rounded-md ring-1 ring-black/10"
                    style={{ background: seriesColor(t.slot, dark) }}
                  />
                  <input
                    className="field h-7 min-w-0 flex-1"
                    value={t.name}
                    aria-label="Treatment name"
                    onChange={(e) => updateTreatment(t.id, { name: e.target.value })}
                  />
                  <span className="tabular w-10 shrink-0 text-right text-[11.5px] text-muted" title="Vessels">
                    {n} ves.
                  </span>
                </div>
                <div className="mt-1.5 flex items-center gap-1 pl-7">
                  <select
                    className="field h-7 flex-1 text-[12px]"
                    aria-label="Role"
                    value={t.role}
                    onChange={(e) => updateTreatment(t.id, { role: e.target.value as TreatmentRole })}
                  >
                    {ROLES.map((r) => (
                      <option key={r.value} value={r.value}>
                        {r.label}
                      </option>
                    ))}
                  </select>
                  <IconButton label="Move up" size="sm" disabled={i === 0} onClick={() => moveTreatment(t.id, -1)}>
                    <ArrowUp className="h-3.5 w-3.5" />
                  </IconButton>
                  <IconButton label="Move down" size="sm" disabled={i === treatments.length - 1} onClick={() => moveTreatment(t.id, 1)}>
                    <ArrowDown className="h-3.5 w-3.5" />
                  </IconButton>
                  <IconButton
                    label="Delete treatment"
                    size="sm"
                    onClick={() => {
                      if (n === 0 || window.confirm(`Delete "${t.name}"? ${n} vessel${n === 1 ? '' : 's'} will become unassigned.`)) removeTreatment(t.id);
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </IconButton>
                </div>
              </li>
            );
          })}
        </ul>
        <form
          className="mt-2 flex gap-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            if (addTreatment(newName)) setNewName('');
          }}
        >
          <input className="field h-8" placeholder="New treatment, e.g. Control" value={newName} onChange={(e) => setNewName(e.target.value)} />
          <Button type="submit" size="md" icon={<Plus className="h-4 w-4" />} disabled={!newName.trim()}>
            Add
          </Button>
        </form>
      </div>

      {vessels.length > 0 && (
        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-[12px] font-semibold text-ink">Vessels ({vessels.length})</span>
            {unassigned > 0 && <span className="text-[11.5px] text-warning-ink">{unassigned} unassigned</span>}
          </div>
          {selected.size > 0 && (
            <div className="mb-2 flex items-center gap-1.5 rounded-md bg-accent-soft px-2 py-1.5">
              <span className="text-[12px] text-ink">{selected.size} selected →</span>
              <select
                className="field h-7 flex-1 text-[12px]"
                value=""
                onChange={(e) => {
                  setVesselTreatment([...selected], e.target.value === '__none' ? null : e.target.value);
                  setSelected(new Set());
                }}
              >
                <option value="" disabled>
                  Assign treatment…
                </option>
                {treatments.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
                <option value="__none">No treatment</option>
              </select>
            </div>
          )}
          <div className="max-h-[340px] overflow-y-auto rounded-lg border border-line">
            <table className="w-full text-[12px]">
              <thead className="sticky top-0 bg-sunken text-ink-2">
                <tr>
                  <th className="w-7 py-1 pl-2 text-left">
                    <input
                      type="checkbox"
                      aria-label="Select all vessels"
                      checked={selected.size === vessels.length}
                      onChange={(e) => setSelected(e.target.checked ? new Set(vessels.map((v) => v.vKey)) : new Set())}
                    />
                  </th>
                  <th className="py-1 text-left font-medium">Vessel</th>
                  <th className="py-1 text-right font-medium">Mean</th>
                  <th className="py-1 pr-2 pl-2 text-left font-medium">Treatment</th>
                </tr>
              </thead>
              <tbody>
                {vessels.map((v) => (
                  <tr key={v.vKey} className={cx('border-t border-line', selected.has(v.vKey) && 'bg-accent-soft/50')}>
                    <td className="py-1 pl-2">
                      <input type="checkbox" aria-label={`Select ${v.name}`} checked={selected.has(v.vKey)} onChange={() => toggle(v.vKey)} />
                    </td>
                    <td className="py-1 font-medium text-ink">{v.name}</td>
                    <td className="tabular py-1 text-right text-ink-2">{formatPercent(v.mean)}</td>
                    <td className="py-1 pr-1 pl-2">
                      <select
                        className={cx('field h-7 text-[12px]', !vt[v.vKey] && 'border-warning text-warning-ink')}
                        value={vt[v.vKey] ?? ''}
                        aria-label={`Treatment for ${v.name}`}
                        onChange={(e) => setVesselTreatment([v.vKey], e.target.value || null)}
                      >
                        <option value="">Unassigned</option>
                        {treatments.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.name}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {vessels.length === 0 && <Callout kind="info">Vessels appear here once images or damage data are added.</Callout>}
      <NextButton to="explore">Next: explore the results</NextButton>
    </div>
  );
}
