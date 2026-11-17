// 零依赖 ZIP 打包器：仅使用 STORE（不压缩），满足 PNG 序列帧打包交付

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const enc = new TextEncoder();

export interface ZipEntry { name: string; data: Uint8Array }

export function buildZip(entries: ZipEntry[]): Blob {
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;

  const u16 = (n: number) => { const b = new Uint8Array(2); new DataView(b.buffer).setUint16(0, n, true); return b; };
  const u32 = (n: number) => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, n >>> 0, true); return b; };

  for (const e of entries) {
    const nameBytes = enc.encode(e.name);
    const crc = crc32(e.data);
    const size = e.data.length;

    const local = [
      u32(0x04034b50), u16(20), u16(0), u16(0),
      u16(0), u16(0), u32(crc), u32(size), u32(size),
      u16(nameBytes.length), u16(0), nameBytes, e.data,
    ];
    for (const c of local) chunks.push(c);

    central.push(...[
      u32(0x02014b50), u16(20), u16(20), u16(0), u16(0),
      u16(0), u16(0), u32(crc), u32(size), u32(size),
      u16(nameBytes.length), u16(0), u16(0), u16(0), u16(0),
      u32(0), u32(offset), nameBytes,
    ]);
    offset += 30 + nameBytes.length + size;
  }

  const centralSize = central.reduce((s, c) => s + c.length, 0);
  const centralOffset = offset;
  const end = [
    u32(0x06054b50), u16(0), u16(0),
    u16(entries.length), u16(entries.length),
    u32(centralSize), u32(centralOffset), u16(0),
  ];

  // 合并为连续缓冲区，规避 Uint8Array<ArrayBufferLike> 与 BlobPart 的类型差异
  const all: Uint8Array[] = [...chunks, ...central, ...end];
  const total = all.reduce((s, c) => s + c.length, 0);
  const merged = new Uint8Array(total);
  let pos = 0;
  for (const c of all) { merged.set(c, pos); pos += c.length; }
  return new Blob([merged.buffer], { type: 'application/zip' });
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
