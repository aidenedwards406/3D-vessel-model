/**
 * Lazy ZIP reading: parses the central directory and returns entries as Blob
 * slices, so large study files open instantly and images are read on demand.
 */
import { inflateSync } from 'fflate';

export interface ZipEntry {
  name: string;
  method: number;
  compressedSize: number;
  size: number;
  localOffset: number;
}

export interface LazyZip {
  entries: Map<string, ZipEntry>;
  has(name: string): boolean;
  blob(name: string, type?: string): Promise<Blob>;
  bytes(name: string): Promise<Uint8Array>;
}

export class ZipFormatError extends Error {}

export async function openZip(file: Blob): Promise<LazyZip> {
  const size = file.size;
  const tailLen = Math.min(size, 65_557 + 20);
  const tail = new Uint8Array(await file.slice(size - tailLen).arrayBuffer());
  const dv = new DataView(tail.buffer);
  let eocd = -1;
  for (let i = tail.length - 22; i >= 0; i--) {
    if (dv.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new ZipFormatError("This isn't a valid study file.");
  let count = dv.getUint16(eocd + 10, true);
  let cdSize = dv.getUint32(eocd + 12, true);
  let cdOffset = dv.getUint32(eocd + 16, true);
  if (cdOffset === 0xffffffff || count === 0xffff || cdSize === 0xffffffff) {
    const loc = eocd - 20;
    if (loc >= 0 && dv.getUint32(loc, true) === 0x07064b50) {
      const z64off = Number(dv.getBigUint64(loc + 8, true));
      const z = new DataView(await file.slice(z64off, z64off + 56).arrayBuffer());
      count = Number(z.getBigUint64(32, true));
      cdSize = Number(z.getBigUint64(40, true));
      cdOffset = Number(z.getBigUint64(48, true));
    }
  }
  const cd = new DataView(await file.slice(cdOffset, cdOffset + cdSize).arrayBuffer());
  const entries = new Map<string, ZipEntry>();
  const dec = new TextDecoder();
  let p = 0;
  for (let i = 0; i < count && p + 46 <= cd.byteLength; i++) {
    if (cd.getUint32(p, true) !== 0x02014b50) break;
    const method = cd.getUint16(p + 10, true);
    let csize = cd.getUint32(p + 20, true);
    let usize = cd.getUint32(p + 24, true);
    const nlen = cd.getUint16(p + 28, true);
    const xlen = cd.getUint16(p + 30, true);
    const clen = cd.getUint16(p + 32, true);
    let lofs = cd.getUint32(p + 42, true);
    const name = dec.decode(new Uint8Array(cd.buffer, cd.byteOffset + p + 46, nlen));
    let x = p + 46 + nlen;
    const xend = x + xlen;
    while (x + 4 <= xend) {
      const id = cd.getUint16(x, true);
      const sz = cd.getUint16(x + 2, true);
      if (id === 1) {
        let q = x + 4;
        if (usize === 0xffffffff) {
          usize = Number(cd.getBigUint64(q, true));
          q += 8;
        }
        if (csize === 0xffffffff) {
          csize = Number(cd.getBigUint64(q, true));
          q += 8;
        }
        if (lofs === 0xffffffff) lofs = Number(cd.getBigUint64(q, true));
      }
      x += 4 + sz;
    }
    entries.set(name, { name, method, compressedSize: csize, size: usize, localOffset: lofs });
    p += 46 + nlen + xlen + clen;
  }

  const dataOffset = async (e: ZipEntry) => {
    const h = new DataView(await file.slice(e.localOffset, e.localOffset + 30).arrayBuffer());
    if (h.getUint32(0, true) !== 0x04034b50) throw new ZipFormatError('The study file is damaged.');
    return e.localOffset + 30 + h.getUint16(26, true) + h.getUint16(28, true);
  };

  const getEntry = (name: string) => {
    const e = entries.get(name);
    if (!e) throw new ZipFormatError(`"${name}" is missing from the study file.`);
    return e;
  };

  return {
    entries,
    has: (name) => entries.has(name),
    async blob(name, type = '') {
      const e = getEntry(name);
      const off = await dataOffset(e);
      if (e.method === 0) return file.slice(off, off + e.compressedSize, type);
      const comp = new Uint8Array(await file.slice(off, off + e.compressedSize).arrayBuffer());
      return new Blob([inflateSync(comp) as Uint8Array<ArrayBuffer>], { type });
    },
    async bytes(name) {
      const e = getEntry(name);
      const off = await dataOffset(e);
      const comp = new Uint8Array(await file.slice(off, off + e.compressedSize).arrayBuffer());
      return e.method === 0 ? comp : inflateSync(comp);
    },
  };
}
