import type { Camera, RenderPrimitive } from '../types.js';
import { SceneRenderer, worldToScreen } from './renderer.js';

/** Canvas2D 渲染器：WebGPU 不可用时的回退方案，同时承担 PNG 序列帧导出 */
export class Canvas2DRenderer implements SceneRenderer {
  readonly kind = 'canvas2d' as const;

  constructor(private ctx: CanvasRenderingContext2D) {}

  render(primitives: RenderPrimitive[], camera: Camera, canvasW: number, canvasH: number): void {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, canvasW, canvasH);
    ctx.fillStyle = '#10171e';
    ctx.fillRect(0, 0, canvasW, canvasH);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    const sp = (x: number, y: number) => worldToScreen(x, y, camera, canvasW, canvasH);

    for (const prim of primitives) {
      ctx.strokeStyle = prim.color;
      ctx.fillStyle = prim.color;
      ctx.lineWidth = (prim.width ?? 1) * (prim.type === 'line' ? 1 : 1) * Math.max(1, camera.zoom * 0.8);
      switch (prim.type) {
        case 'line': {
          const pts = prim.points!;
          ctx.beginPath();
          pts.forEach((pt, i) => {
            const s = sp(pt.x, pt.y);
            if (i === 0) ctx.moveTo(s.x, s.y);
            else ctx.lineTo(s.x, s.y);
          });
          ctx.stroke();
          break;
        }
        case 'poly': {
          const pts = prim.points!;
          ctx.beginPath();
          pts.forEach((pt, i) => {
            const s = sp(pt.x, pt.y);
            if (i === 0) ctx.moveTo(s.x, s.y);
            else ctx.lineTo(s.x, s.y);
          });
          ctx.closePath();
          if (prim.fill) ctx.fill();
          else ctx.stroke();
          break;
        }
        case 'circle': {
          const c = sp(prim.center!.x, prim.center!.y);
          ctx.beginPath();
          ctx.arc(c.x, c.y, (prim.radius ?? 8) * camera.zoom, 0, Math.PI * 2);
          if (prim.fill) ctx.fill();
          else ctx.stroke();
          break;
        }
        case 'rect': {
          const c = sp(prim.x!, prim.y!);
          const w = prim.w! * camera.zoom;
          const h = prim.h! * camera.zoom;
          if (prim.fill) ctx.fillRect(c.x, c.y - h, w, h);
          else ctx.strokeRect(c.x, c.y - h, w, h);
          break;
        }
      }
    }
  }

  dispose(): void { /* 无需释放 */ }
}
