import { getDerived, getLayout, getPositionMismatches, getVessels } from '../../state/derived';
import type { AppState, StepId } from '../../state/store';

export type StepStatus = 'done' | 'attention' | 'todo' | 'optional' | 'locked';

export interface StepMeta {
  id: StepId;
  n: number;
  title: string;
  phase: string;
  group: 'setup' | 'analyze';
  status: StepStatus;
  summary: string;
}

export function stepMeta(s: AppState): StepMeta[] {
  const d = getDerived(s);
  const vessels = getVessels(s);
  const modelReady = s.model.status === 'ready';
  const nImages = s.images.filter((i) => !i.excluded && !(i.parsed?.overlay && !i.manual)).length;
  const unplaced = d.unplacedImages.length;
  const rows = s.damage.rows.length;
  const unassigned = vessels.filter((v) => !v.treatmentId).length;
  const groups = s.treatments.filter((t) => vessels.some((v) => v.treatmentId === t.id)).length;
  const hasData = d.observations.length > 0;
  return [
    {
      id: 'model',
      n: 1,
      title: 'Load the 3D model',
      phase: 'Phase 1',
      group: 'setup',
      status: modelReady ? 'done' : s.model.status === 'error' ? 'attention' : 'todo',
      summary: modelReady
        ? `${s.model.name}`
        : s.model.status === 'loading' || s.model.status === 'processing'
          ? 'Analysing…'
          : 'STL from the partner, or a phone scan',
    },
    {
      id: 'sections',
      n: 2,
      title: 'Define sections',
      phase: 'Phase 2',
      group: 'setup',
      status: !modelReady ? 'locked' : getPositionMismatches(s).length ? 'attention' : s.dirty || hasData ? 'done' : 'todo',
      summary: (() => {
        const l = getLayout(s);
        const lists = new Set(l.positions.map((p) => p.map((x) => (x === 'M1' && p.filter((y) => y.startsWith('M')).length === 1 ? 'M' : x)).join(', ')));
        return `${l.count} sections · top/bottom · ${lists.size === 1 ? [...lists][0] : 'positions vary by section'}`;
      })(),
    },
    {
      id: 'images',
      n: 3,
      title: 'Add images',
      phase: 'Phases 3–4',
      group: 'setup',
      status: unplaced > 0 ? 'attention' : nImages > 0 ? 'done' : 'optional',
      summary: nImages
        ? `${nImages} image${nImages === 1 ? '' : 's'}${unplaced ? ` · ${unplaced} to place` : ' · all placed'}`
        : 'Placed automatically from file names',
    },
    {
      id: 'damage',
      n: 4,
      title: 'Add damage data',
      phase: 'Phase 5',
      group: 'setup',
      status: rows ? (d.unparsedRows.length || s.damage.ambiguousUnits ? 'attention' : 'done') : 'todo',
      summary: rows ? `${rows} values from ${s.damage.fileName ?? 'spreadsheet'}` : 'Excel sheet of % damage per image',
    },
    {
      id: 'treatments',
      n: 5,
      title: 'Assign treatments',
      phase: 'Phase 6',
      group: 'setup',
      status: vessels.length === 0 ? 'todo' : unassigned ? 'attention' : 'done',
      summary: vessels.length
        ? `${groups} group${groups === 1 ? '' : 's'}${unassigned ? ` · ${unassigned} vessel${unassigned === 1 ? '' : 's'} unassigned` : ` · ${vessels.length} vessels`}`
        : 'Treatment key: bioreactor → treatment',
    },
    {
      id: 'explore',
      n: 6,
      title: 'Explore results',
      phase: 'Phases 4–5',
      group: 'analyze',
      status: hasData ? 'done' : 'todo',
      summary: hasData ? 'Heat map, markers, image viewer' : 'Needs images or damage data',
    },
    {
      id: 'compare',
      n: 7,
      title: 'Compare treatments',
      phase: 'Phase 6',
      group: 'analyze',
      status: groups >= 2 ? 'done' : 'todo',
      summary: groups >= 2 ? 'Side by side, all vessels, averages' : 'Needs two or more treatment groups',
    },
    {
      id: 'stats',
      n: 8,
      title: 'Statistics',
      phase: 'Phase 10',
      group: 'analyze',
      status: groups >= 2 && rows ? 'done' : 'todo',
      summary: groups >= 2 && rows ? 'Summary, tests, box plots' : 'Needs damage data and treatments',
    },
  ];
}
