import { useMemo, useState } from 'react';
import { ChevronDown, Download, FileSpreadsheet, Trash2 } from 'lucide-react';
import { columnLabels, type DamageMapping } from '../../lib/importers';
import { downloadBlob } from '../../lib/files';
import { cellText, writeXlsx, type CellValue } from '../../lib/spreadsheet';
import { stripExtension } from '../../lib/naming';
import { applyDamageMapping, clearDamage, loadDamageFile } from '../../state/actions';
import { assets } from '../../state/assets';
import { useDerived } from '../../state/derived';
import { useStore } from '../../state/store';
import { Button, Callout, Dropzone, Field, Segmented, Stat, cx } from '../ui';
import { Help, NextButton } from './common';

export function downloadDamageTemplate() {
  const s = useStore.getState();
  const rows: CellValue[][] = [['Image', '% Damage', 'Treatment (optional)']];
  const names = s.images.filter((i) => !i.excluded && !i.parsed?.overlay).map((i) => stripExtension(i.fileName));
  if (names.length) for (const n of names) rows.push([n, null, null]);
  else rows.push(['BRS24-10_4x_2_T_M2', 12.5, 'Control'], ['BRS24-10_4x_2_B_M2', 8.1, 'Control']);
  downloadBlob(
    new Blob([writeXlsx([{ name: 'Damage', rows }])], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
    'damage-template.xlsx',
  );
}

function MappingEditor() {
  const damage = useStore((s) => s.damage);
  const sheets = assets.damageSheets;
  const m = damage.mapping;
  const labels = useMemo(() => (sheets && m ? columnLabels(sheets[m.sheetIndex], m.headerRow) : []), [sheets, m]);
  if (!sheets || !m) return null;
  const sheet = sheets[m.sheetIndex];
  const change = (patch: Partial<DamageMapping>) => applyDamageMapping({ ...m, ...patch });
  const preview = sheet.rows.slice(m.headerRow + 1, m.headerRow + 6);
  const cols = [m.nameCol, m.damageCol, ...(m.treatmentCol !== null ? [m.treatmentCol] : [])];
  return (
    <div className="space-y-2.5 rounded-lg border border-line bg-surface-2 p-3">
      {sheets.length > 1 && (
        <Field label="Sheet">
          <select className="field" value={m.sheetIndex} onChange={(e) => change({ sheetIndex: Number(e.target.value) })}>
            {sheets.map((s, i) => (
              <option key={i} value={i}>
                {s.name}
              </option>
            ))}
          </select>
        </Field>
      )}
      <div className="grid grid-cols-2 gap-2">
        <Field label="Image names">
          <select className="field" value={m.nameCol} onChange={(e) => change({ nameCol: Number(e.target.value) })}>
            {labels.map((l, i) => (
              <option key={i} value={i}>
                {l}
              </option>
            ))}
          </select>
        </Field>
        <Field label="% damage">
          <select className="field" value={m.damageCol} onChange={(e) => change({ damageCol: Number(e.target.value) })}>
            {labels.map((l, i) => (
              <option key={i} value={i}>
                {l}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Treatment (optional)">
          <select
            className="field"
            value={m.treatmentCol ?? -1}
            onChange={(e) => change({ treatmentCol: Number(e.target.value) < 0 ? null : Number(e.target.value) })}
          >
            <option value={-1}>None</option>
            {labels.map((l, i) => (
              <option key={i} value={i}>
                {l}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Header row">
          <select className="field" value={m.headerRow} onChange={(e) => change({ headerRow: Number(e.target.value) })}>
            <option value={-1}>No header</option>
            {Array.from({ length: Math.min(10, sheet.rows.length) }, (_v, i) => (
              <option key={i} value={i}>
                Row {i + 1}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <Field label="Values are">
        <Segmented
          className="w-full"
          size="sm"
          value={m.units}
          onChange={(units) => change({ units })}
          options={[
            { value: 'percent', label: 'Percent (12.5)' },
            { value: 'fraction', label: 'Fraction (0.125)' },
          ]}
        />
      </Field>
      <div className="overflow-x-auto rounded-md border border-line">
        <table className="w-full text-[11.5px]">
          <thead className="bg-sunken text-ink-2">
            <tr>
              {cols.map((c) => (
                <th key={c} className="px-2 py-1 text-left font-medium whitespace-nowrap">
                  {labels[c]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {preview.map((row, r) => (
              <tr key={r} className="border-t border-line">
                {cols.map((c) => (
                  <td key={c} className="tabular max-w-[150px] truncate px-2 py-1 text-ink">
                    {cellText(row[c])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function DamageStep() {
  const damage = useStore((s) => s.damage);
  const images = useStore((s) => s.images);
  const d = useDerived();
  const [showIssues, setShowIssues] = useState(false);
  const matched = d.observations.filter((o) => o.damage !== null && o.imageId).length;
  const problems = [
    ...d.unparsedRows.map((r) => ({ row: r.rowNumber, name: r.name, reason: "The name doesn't follow the naming convention." })),
    ...damage.skipped.map((r) => ({ row: r.rowNumber, name: r.name, reason: r.reason })),
  ].sort((a, b) => a.row - b.row);

  return (
    <div className="space-y-3">
      <Help>
        Upload the Excel sheet of percent damage per image: image names in one column, % damage in another. The model is coloured by these values.
        A treatment column, or a “Treatment key” sheet in the same workbook, is picked up too.
      </Help>
      <Dropzone
        onFiles={(f) => f[0] && loadDamageFile(f[0])}
        accept=".xlsx,.xlsm,.csv,.tsv,.txt"
        multiple={false}
        title={damage.fileName ? 'Replace the spreadsheet' : 'Drop the damage spreadsheet here'}
        hint="Excel (.xlsx) or CSV. Older .xls files: save as .xlsx first."
        icon={<FileSpreadsheet className="h-4 w-4" />}
        compact={!!damage.fileName}
      />
      <button type="button" onClick={downloadDamageTemplate} className="flex items-center gap-1.5 text-[12px] font-medium text-accent hover:underline">
        <Download className="h-3.5 w-3.5" />
        Download a template{images.length ? ' with your image names' : ''}
      </button>

      {damage.fileName && (
        <>
          <div className="grid grid-cols-2 gap-2">
            <Stat label="Damage values" value={damage.rows.length.toLocaleString()} sub={damage.fileName} />
            <Stat label="Matched to images" value={matched.toLocaleString()} sub={images.length ? `${d.rowsWithoutImage} without an image` : 'no images added'} />
          </div>
          {damage.ambiguousUnits && (
            <Callout kind="warning" title="Are these fractions?">
              All values are between 0 and 1. If 0.12 means 12%, choose “Fraction” below. If it really means 0.12%, leave it as is.
            </Callout>
          )}
          {damage.percentFormatted && (
            <Callout kind="success">Cells formatted as percentages in Excel were converted automatically.</Callout>
          )}
          {d.duplicateRows > 0 && (
            <Callout kind="warning">
              {d.duplicateRows} image name{d.duplicateRows === 1 ? ' appears' : 's appear'} more than once. All values are kept and averaged per
              location.
            </Callout>
          )}
          {problems.length > 0 && (
            <div className="rounded-lg border border-line bg-surface-2">
              <button
                type="button"
                className="flex w-full items-center justify-between px-3 py-2 text-left text-[12.5px] font-medium text-ink"
                onClick={() => setShowIssues((v) => !v)}
                aria-expanded={showIssues}
              >
                <span className="text-warning-ink">
                  {problems.length} row{problems.length === 1 ? '' : 's'} couldn't be used
                </span>
                <ChevronDown className={cx('h-4 w-4 transition-transform', showIssues && 'rotate-180')} />
              </button>
              {showIssues && (
                <ul className="max-h-56 space-y-1 overflow-y-auto border-t border-line px-3 py-2">
                  {problems.slice(0, 200).map((p, i) => (
                    <li key={i} className="text-[11.5px] leading-snug">
                      <span className="text-muted">Row {p.row}</span> <span className="font-mono text-ink">{p.name || '(blank)'}</span>
                      <div className="text-ink-2">{p.reason}</div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          <MappingEditor />
          <div className="flex justify-end">
            <Button size="sm" variant="danger" icon={<Trash2 className="h-3.5 w-3.5" />} onClick={clearDamage}>
              Remove damage data
            </Button>
          </div>
        </>
      )}
      <NextButton to="treatments">Next: assign treatments</NextButton>
    </div>
  );
}
