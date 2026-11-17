/** Local file helpers: pickers, folder drag-and-drop and downloads. Nothing is uploaded. */

export function pickFiles(opts: { accept?: string; multiple?: boolean; directory?: boolean } = {}): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    if (opts.accept) input.accept = opts.accept;
    input.multiple = !!opts.multiple;
    if (opts.directory) {
      input.setAttribute('webkitdirectory', '');
      input.setAttribute('directory', '');
    }
    input.style.display = 'none';
    let settled = false;
    const done = (files: File[]) => {
      if (settled) return;
      settled = true;
      input.remove();
      resolve(files);
    };
    input.addEventListener('change', () => done(Array.from(input.files ?? [])));
    input.addEventListener('cancel', () => done([]));
    document.body.appendChild(input);
    input.click();
  });
}

interface FsEntry {
  isFile: boolean;
  isDirectory: boolean;
  name: string;
  file?: (cb: (f: File) => void, err?: (e: unknown) => void) => void;
  createReader?: () => { readEntries: (cb: (entries: FsEntry[]) => void, err?: (e: unknown) => void) => void };
}

async function readEntry(entry: FsEntry, out: File[]): Promise<void> {
  if (entry.isFile && entry.file) {
    await new Promise<void>((resolve) =>
      entry.file!(
        (f) => {
          out.push(f);
          resolve();
        },
        () => resolve(),
      ),
    );
  } else if (entry.isDirectory && entry.createReader) {
    const reader = entry.createReader();
    for (;;) {
      const batch = await new Promise<FsEntry[]>((resolve) => reader.readEntries(resolve, () => resolve([])));
      if (batch.length === 0) break;
      for (const e of batch) await readEntry(e, out);
    }
  }
}

/** Files from a drop event, including everything inside dropped folders. */
export async function filesFromDrop(dt: DataTransfer): Promise<File[]> {
  const items = Array.from(dt.items ?? []);
  const entries: FsEntry[] = [];
  for (const it of items) {
    if (it.kind !== 'file') continue;
    const e = it.webkitGetAsEntry?.() as unknown as FsEntry | null;
    if (e) entries.push(e);
  }
  if (entries.length === 0) return Array.from(dt.files ?? []);
  const out: File[] = [];
  for (const e of entries) await readEntry(e, out);
  return out;
}

export function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export function safeFileName(name: string, fallback = 'study'): string {
  const s = name
    .trim()
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, ' ')
    .slice(0, 120);
  return s || fallback;
}

export function formatBytes(n: number): string {
  if (!n) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(u.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return `${(n / Math.pow(1024, i)).toFixed(i ? 1 : 0)} ${u[i]}`;
}

export function dateStamp(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}
