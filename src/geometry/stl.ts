/** Fast STL parsing (binary and ASCII) to a flat triangle-soup position array. */

export function parseStl(buf: ArrayBuffer): Float32Array {
  const bytes = buf.byteLength;
  if (bytes >= 84) {
    const dv = new DataView(buf);
    const n = dv.getUint32(80, true);
    const expected = 84 + n * 50;
    const binaryBySize = expected === bytes || (bytes > 84 && (bytes - 84) % 50 === 0 && !looksAscii(buf));
    if (binaryBySize) {
      const count = expected === bytes ? n : (bytes - 84) / 50;
      const out = new Float32Array(count * 9);
      let o = 84 + 12;
      for (let i = 0; i < count; i++, o += 50) {
        for (let k = 0; k < 9; k++) out[i * 9 + k] = dv.getFloat32(o + k * 4, true);
      }
      return out;
    }
  }
  return parseAsciiStl(new TextDecoder().decode(new Uint8Array(buf)));
}

function looksAscii(buf: ArrayBuffer): boolean {
  const head = new TextDecoder().decode(new Uint8Array(buf, 0, Math.min(512, buf.byteLength))).trimStart();
  return head.startsWith('solid') && /facet|endsolid/.test(new TextDecoder().decode(new Uint8Array(buf, 0, Math.min(4096, buf.byteLength))));
}

function parseAsciiStl(text: string): Float32Array {
  const out: number[] = [];
  const re = /vertex\s+([-+]?[\d.]+(?:[eE][-+]?\d+)?)\s+([-+]?[\d.]+(?:[eE][-+]?\d+)?)\s+([-+]?[\d.]+(?:[eE][-+]?\d+)?)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) out.push(+m[1], +m[2], +m[3]);
  if (out.length < 9) throw new Error("This STL file doesn't contain any triangles.");
  return new Float32Array(out.slice(0, out.length - (out.length % 9)));
}
