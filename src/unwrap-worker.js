/**
 * unwrap-worker.js — OffscreenCanvas Worker
 * 接收 transferable 的离屏画布与展开参数，在 Worker 内完成全部绘制，
 * 避免轮廓拖拽时展开重算阻塞主线程交互。
 */
import { drawUnwrap } from './unwrap-draw.js';

let canvas = null;
let dpr = 1;

self.onmessage = e => {
  const msg = e.data;
  if (msg.type === 'init') {
    canvas = msg.canvas;
    dpr = msg.dpr;
    return;
  }
  if (msg.type === 'resize') {
    if (canvas) {
      canvas.width = Math.round(msg.cssW * dpr);
      canvas.height = Math.round(msg.cssH * dpr);
    }
    return;
  }
  if (msg.type === 'render' && canvas) {
    const ctx = canvas.getContext('2d');
    const stats = drawUnwrap(ctx, msg.cssW, msg.cssH, dpr, msg.payload);
    self.postMessage({ type: 'done', taskId: msg.taskId, stats });
  }
};
