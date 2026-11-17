import { processGeometry, type ProcessResult } from './process';
import { parseStl } from './stl';

export type WorkerRequest =
  | { type: 'process'; id: number; kind: 'stl'; buffer: ArrayBuffer; mode: 'auto' | 'straight' }
  | { type: 'process'; id: number; kind: 'mesh'; positions: Float32Array; index: Uint32Array | null; mode: 'auto' | 'straight' };

export type WorkerResponse =
  | { type: 'progress'; id: number; stage: string; fraction: number }
  | { type: 'done'; id: number; result: ProcessResult }
  | { type: 'error'; id: number; message: string };

interface WorkerScope {
  onmessage: ((e: MessageEvent<WorkerRequest>) => void) | null;
  postMessage(message: WorkerResponse, transfer?: Transferable[]): void;
}
const ctx = self as unknown as WorkerScope;

ctx.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const req = e.data;
  if (req.type !== 'process') return;
  const progress = (stage: string, fraction: number) =>
    ctx.postMessage({ type: 'progress', id: req.id, stage, fraction } satisfies WorkerResponse);
  try {
    let positions: Float32Array;
    let index: Uint32Array | null = null;
    if (req.kind === 'stl') {
      progress('Reading the STL file', 0.02);
      positions = parseStl(req.buffer);
    } else {
      positions = req.positions;
      index = req.index;
    }
    const result = processGeometry({ positions, index, mode: req.mode }, progress);
    const transfer: Transferable[] = [
      result.positions.buffer,
      result.index.buffer,
      result.aT.buffer,
      result.radial.buffer,
      result.dist.buffer,
      result.centerline.buffer,
      result.tangents.buffer,
      result.radiusMax.buffer,
      result.radiusMean.buffer,
    ];
    ctx.postMessage({ type: 'done', id: req.id, result } satisfies WorkerResponse, transfer);
  } catch (err) {
    ctx.postMessage({
      type: 'error',
      id: req.id,
      message: err instanceof Error ? err.message : String(err),
    } satisfies WorkerResponse);
  }
};
