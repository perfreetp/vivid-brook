// 导出：16-bit 原始高度图 + 8-bit 预览 PNG + OBJ 网格，供仿真侧导入
import { CELL, FIELD_SIZE, VERTS } from './config';

/** 高度范围（米），用于 16bit 量化；本场地所有特征都在此范围内 */
export const H_MIN = -1.5;
export const H_MAX = 4.0;

function quantize16(h: number): number {
  const t = (h - H_MIN) / (H_MAX - H_MIN);
  return Math.max(0, Math.min(65535, Math.round(t * 65535)));
}

/** 导出 16-bit little-endian 原始高度图（无文件头，配合 .meta.json 使用） */
export function exportHeightmapRaw(heights: Float64Array): { raw: Blob; meta: Blob } {
  const buf = new ArrayBuffer(VERTS * VERTS * 2);
  const view = new DataView(buf);
  for (let i = 0; i < VERTS * VERTS; i++) {
    view.setUint16(i * 2, quantize16(heights[i]), true);
  }
  const raw = new Blob([buf], { type: 'application/octet-stream' });
  const meta = new Blob(
    [
      JSON.stringify(
        {
          width: VERTS,
          height: VERTS,
          format: 'uint16-le',
          fieldSizeMeters: FIELD_SIZE,
          cellMeters: CELL,
          heightMinMeters: H_MIN,
          heightMaxMeters: H_MAX,
          rowOrder: 'z-major, z=0 first',
        },
        null,
        2,
      ),
    ],
    { type: 'application/json' },
  );
  return { raw, meta };
}

/** 导出 8-bit 灰度预览 PNG（canvas 编码，无第三方依赖） */
export function exportHeightmapPng8(heights: Float64Array): Blob {
  const canvas = document.createElement('canvas');
  canvas.width = VERTS;
  canvas.height = VERTS;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(VERTS, VERTS);
  for (let iz = 0; iz < VERTS; iz++) {
    for (let ix = 0; ix < VERTS; ix++) {
      const src = heights[iz * VERTS + ix];
      const g = Math.max(0, Math.min(255, Math.round(((src - H_MIN) / (H_MAX - H_MIN)) * 255)));
      const p = (iz * VERTS + ix) * 4;
      img.data[p] = g;
      img.data[p + 1] = g;
      img.data[p + 2] = g;
      img.data[p + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  // canvas.toBlob 是异步的，这里用 dataURL 同步转出
  const url = canvas.toDataURL('image/png');
  return dataUrlToBlob(url);
}

function dataUrlToBlob(url: string): Blob {
  const [head, body] = url.split(',');
  const mime = /:(.*?);/.exec(head)?.[1] ?? 'application/octet-stream';
  const bin = atob(body);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

/** 导出 OBJ：y 向上，场地中心平移到原点，三角网格按格网顺序展开 */
export function exportObj(heights: Float64Array): Blob {
  const lines: string[] = ['# Robot field test terrain, generated procedurally', 'o field_40m'];
  const half = FIELD_SIZE / 2;
  for (let iz = 0; iz < VERTS; iz++) {
    for (let ix = 0; ix < VERTS; ix++) {
      const x = ix * CELL - half;
      const z = iz * CELL - half;
      const y = heights[iz * VERTS + ix];
      lines.push(`v ${x.toFixed(4)} ${y.toFixed(4)} ${z.toFixed(4)}`);
    }
  }
  const vid = (ix: number, iz: number) => iz * VERTS + ix + 1; // OBJ 索引从 1 开始
  for (let iz = 0; iz < VERTS - 1; iz++) {
    for (let ix = 0; ix < VERTS - 1; ix++) {
      const a = vid(ix, iz);
      const b = vid(ix + 1, iz);
      const c = vid(ix, iz + 1);
      const d = vid(ix + 1, iz + 1);
      lines.push(`f ${a} ${c} ${b}`);
      lines.push(`f ${b} ${c} ${d}`);
    }
  }
  return new Blob([lines.join('\n')], { type: 'text/plain' });
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
