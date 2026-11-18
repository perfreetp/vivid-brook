// 渲染器公共接口：WebGPU 主实现 + Canvas2D 降级实现共用
import type { OrbitState } from './camera';

export interface RenderSettings {
  wireframe: boolean;
  showWater: boolean;
  showChunkGrid: boolean;
}

export interface Renderer {
  readonly kind: 'webgpu' | 'canvas2d';
  /** 高度缓冲或区块状态变化后调用 */
  updateTerrain(heights: Float64Array, chunkLocked: Uint8Array, chunkTags: string[][]): void;
  setHover(id: number | null): void;
  setSelection(id: number | null): void;
  setDragRect(rect: { x0: number; z0: number; x1: number; z1: number } | null): void;
  setSettings(s: RenderSettings): void;
  setWaterDepth(d: number): void;
  getOrbit(): OrbitState;
  /** 屏幕像素 -> 场地世界坐标（xz，y 取当前地形高度迭代） */
  pick(clientX: number, clientY: number): { x: number; z: number } | null;
  dispose(): void;
}
