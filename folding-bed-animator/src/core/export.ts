import type { AnimProject } from '../types.js';
import { evaluateScene } from './evaluator.js';
import { buildPrimitives } from './scene.js';
import { Canvas2DRenderer } from '../renderer/canvas2d.js';
import { buildZip, downloadBlob, type ZipEntry } from './zip.js';

/** 在离屏画布上渲染指定帧（导出不受视图缩放影响，固定 1:1） */
function renderFrame(project: AnimProject, frame: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = project.canvasW;
  canvas.height = project.canvasH;
  const ctx = canvas.getContext('2d')!;
  const renderer = new Canvas2DRenderer(ctx);
  const scene = evaluateScene(project, frame);
  const prims = buildPrimitives(project, scene, null);
  renderer.render(prims, { panX: 0, panY: 0, zoom: 1 }, project.canvasW, project.canvasH);
  return canvas;
}

function canvasToPng(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(async (blob) => {
      if (!blob) { reject(new Error('PNG 编码失败')); return; }
      resolve(new Uint8Array(await blob.arrayBuffer()));
    }, 'image/png');
  });
}

const pad4 = (n: number) => String(n).padStart(4, '0');

/** 导出当前帧单张 PNG */
export async function exportSingleFrame(project: AnimProject, frame: number): Promise<void> {
  const canvas = renderFrame(project, frame);
  canvas.toBlob((blob) => {
    if (blob) downloadBlob(blob, `${project.name}_f${pad4(frame)}.png`);
  }, 'image/png');
}

/** 导出帧范围 PNG 序列并打包 zip（逐帧生成，带进度回调） */
export async function exportSequence(
  project: AnimProject,
  startFrame: number,
  endFrame: number,
  onProgress?: (done: number, total: number) => void,
): Promise<void> {
  const entries: ZipEntry[] = [];
  const total = endFrame - startFrame + 1;
  for (let i = 0; i < total; i++) {
    const frame = startFrame + i;
    const canvas = renderFrame(project, frame);
    const data = await canvasToPng(canvas);
    entries.push({ name: `frames/${project.name}_f${pad4(frame)}.png`, data });
    onProgress?.(i + 1, total);
  }
  // 附带工程元数据，便于交付核对
  const meta = new TextEncoder().encode(JSON.stringify({
    project: project.name, fps: project.fps, startFrame, endFrame,
    frames: total, exportedAt: new Date().toISOString(),
  }, null, 2));
  entries.push({ name: 'manifest.json', data: meta });
  const zip = buildZip(entries);
  downloadBlob(zip, `${project.name}_f${pad4(startFrame)}-${pad4(endFrame)}.zip`);
}
