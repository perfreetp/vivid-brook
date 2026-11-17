import type { Camera, RenderPrimitive } from '../types.js';

export interface SceneRenderer {
  readonly kind: 'webgpu' | 'canvas2d';
  render(primitives: RenderPrimitive[], camera: Camera, canvasW: number, canvasH: number): void;
  dispose(): void;
}

export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/** 世界坐标 -> 画布像素坐标（y 轴翻转） */
export function worldToScreen(wx: number, wy: number, camera: Camera, canvasW: number, canvasH: number) {
  return {
    x: canvasW / 2 + camera.panX + wx * camera.zoom,
    y: canvasH / 2 - camera.panY - wy * camera.zoom,
  };
}

export function screenToWorld(sx: number, sy: number, camera: Camera, canvasW: number, canvasH: number) {
  return {
    x: (sx - canvasW / 2 - camera.panX) / camera.zoom,
    y: -(sy - canvasH / 2 - camera.panY) / camera.zoom,
  };
}
