// Canvas2D 降级渲染器：俯视高度热力图。接口与 WebGPU 渲染器一致，
// 在浏览器不支持 WebGPU 时保证编辑/锁定/塑形/质检功能仍可用
import { CELL, CHUNK_CELLS, CHUNKS_PER_SIDE, FIELD_SIZE, GRID, VERTS } from '../terrain/config';
import { createOrbit } from './camera';
import type { OrbitState } from './camera';
import type { RenderSettings, Renderer } from './types';
import { H_MAX, H_MIN } from '../terrain/exporter';

const TAG_COLORS: Record<string, string> = {
  slope: 'rgba(230,170,80,0.28)',
  step: 'rgba(170,170,190,0.28)',
  gravel: 'rgba(200,160,110,0.32)',
  trench: 'rgba(90,70,50,0.35)',
  water: 'rgba(70,130,180,0.4)',
};

export class Canvas2dRenderer implements Renderer {
  readonly kind = 'canvas2d' as const;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private heights = new Float64Array(VERTS * VERTS);
  private locked = new Uint8Array(CHUNKS_PER_SIDE * CHUNKS_PER_SIDE);
  private tags: string[][] = [];
  private hover = -1;
  private selection = -1;
  private dragRect: { x0: number; z0: number; x1: number; z1: number } | null = null;
  private settings: RenderSettings = { wireframe: false, showWater: true, showChunkGrid: true };
  private waterDepth = 0;
  private orbit: OrbitState;
  private scale = 14; // 像素/米
  private panX = 0;
  private panY = 0;
  private raf = 0;
  private ro: ResizeObserver;
  private panning: { x: number; y: number; px: number; py: number } | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    this.orbit = createOrbit();
    this.fit();
    this.attach();
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(canvas);
    this.resize();
    this.loop();
  }

  private fit() {
    const cw = this.canvas.clientWidth || 800;
    const ch = this.canvas.clientHeight || 600;
    this.scale = Math.min(cw, ch) / (FIELD_SIZE + 4);
    this.panX = (cw - FIELD_SIZE * this.scale) / 2;
    this.panY = (ch - FIELD_SIZE * this.scale) / 2;
  }

  private resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.floor(this.canvas.clientWidth * dpr));
    const h = Math.max(1, Math.floor(this.canvas.clientHeight * dpr));
    if (this.canvas.width !== w) this.canvas.width = w;
    if (this.canvas.height !== h) this.canvas.height = h;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  private attach() {
    const c = this.canvas;
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    c.addEventListener('pointerdown', (e) => {
      if (e.button === 1 || e.button === 2) {
        this.panning = { x: e.clientX, y: e.clientY, px: this.panX, py: this.panY };
        c.setPointerCapture(e.pointerId);
      }
    });
    c.addEventListener('pointermove', (e) => {
      if (!this.panning) return;
      this.panX = this.panning.px + (e.clientX - this.panning.x);
      this.panY = this.panning.py + (e.clientY - this.panning.y);
    });
    c.addEventListener('pointerup', () => (this.panning = null));
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      const factor = 1 - Math.sign(e.deltaY) * 0.1;
      const rect = c.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const wx = (mx - this.panX) / this.scale;
      const wy = (my - this.panY) / this.scale;
      this.scale = Math.max(4, Math.min(60, this.scale * factor));
      this.panX = mx - wx * this.scale;
      this.panY = my - wy * this.scale;
    }, { passive: false });
  }

  getOrbit(): OrbitState { return this.orbit; }
  orbitBy() { /* 2D 视图无轨道旋转 */ }
  zoomBy() { /* 由滚轮缩放处理 */ }
  setHover(id: number | null) { this.hover = id ?? -1; }
  setSelection(id: number | null) { this.selection = id ?? -1; }
  setDragRect(r: { x0: number; z0: number; x1: number; z1: number } | null) { this.dragRect = r; }
  setSettings(s: RenderSettings) { this.settings = { ...s }; }
  setWaterDepth(d: number) { this.waterDepth = d; }

  updateTerrain(heights: Float64Array, chunkLocked: Uint8Array, chunkTags: string[][]): void {
    this.heights = heights;
    this.locked = chunkLocked;
    this.tags = chunkTags;
  }

  pick(clientX: number, clientY: number): { x: number; z: number } | null {
    const rect = this.canvas.getBoundingClientRect();
    const x = (clientX - rect.left - this.panX) / this.scale;
    const z = (clientY - rect.top - this.panY) / this.scale;
    if (x < 0 || z < 0 || x > FIELD_SIZE || z > FIELD_SIZE) return null;
    return { x, z };
  }

  private shade(h: number): string {
    const t = Math.max(0, Math.min(1, (h - H_MIN) / (H_MAX - H_MIN)));
    // 深绿 -> 土黄
    const r = Math.round(40 + t * 100);
    const g = Math.round(76 - t * 20);
    const b = Math.round(33 + t * 30);
    return `rgb(${r},${g},${b})`;
  }

  private draw() {
    const ctx = this.ctx;
    const cw = this.canvas.clientWidth;
    const ch = this.canvas.clientHeight;
    ctx.fillStyle = '#12171f';
    ctx.fillRect(0, 0, cw, ch);
    const s = this.scale;
    ctx.save();
    ctx.translate(this.panX, this.panY);

    // 单元高度填色（每个 cell 取中心四点均值）
    for (let iz = 0; iz < GRID; iz++) {
      for (let ix = 0; ix < GRID; ix++) {
        const h =
          (this.heights[iz * VERTS + ix] +
            this.heights[iz * VERTS + ix + 1] +
            this.heights[(iz + 1) * VERTS + ix] +
            this.heights[(iz + 1) * VERTS + ix + 1]) / 4;
        ctx.fillStyle = this.shade(h);
        ctx.fillRect(ix * CELL * s, iz * CELL * s, CELL * s + 0.5, CELL * s + 0.5);
      }
    }

    // 特征带染色
    for (let cz = 0; cz < CHUNKS_PER_SIDE; cz++) {
      for (let cx = 0; cx < CHUNKS_PER_SIDE; cx++) {
        const id = cz * CHUNKS_PER_SIDE + cx;
        for (const t of this.tags[id] ?? []) {
          const col = TAG_COLORS[t];
          if (!col) continue;
          ctx.fillStyle = col;
          ctx.fillRect(cx * CHUNK_CELLS * CELL * s, cz * CHUNK_CELLS * CELL * s, CHUNK_CELLS * CELL * s, CHUNK_CELLS * CELL * s);
        }
        if (this.locked[id]) {
          ctx.fillStyle = 'rgba(245,120,40,0.45)';
          ctx.fillRect(cx * CHUNK_CELLS * CELL * s, cz * CHUNK_CELLS * CELL * s, CHUNK_CELLS * CELL * s, CHUNK_CELLS * CELL * s);
        }
      }
    }

    // 涉水带水面
    if (this.settings.showWater && this.waterDepth > 0) {
      ctx.fillStyle = 'rgba(70,140,210,0.45)';
      ctx.fillRect(0, 32 * s, FIELD_SIZE * s, 8 * s);
    }

    // 线框 / 区块格网
    if (this.settings.wireframe) {
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      for (let i = 0; i <= GRID; i++) {
        ctx.moveTo(i * CELL * s, 0);
        ctx.lineTo(i * CELL * s, FIELD_SIZE * s);
        ctx.moveTo(0, i * CELL * s);
        ctx.lineTo(FIELD_SIZE * s, i * CELL * s);
      }
      ctx.stroke();
    }
    if (this.settings.showChunkGrid) {
      ctx.strokeStyle = 'rgba(255,255,255,0.75)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let i = 0; i <= CHUNKS_PER_SIDE; i++) {
        const p = i * CHUNK_CELLS * CELL * s;
        ctx.moveTo(p, 0);
        ctx.lineTo(p, FIELD_SIZE * s);
        ctx.moveTo(0, p);
        ctx.lineTo(FIELD_SIZE * s, p);
      }
      ctx.stroke();
    }

    // 悬停 / 选中描边
    const outline = (id: number, color: string) => {
      if (id < 0) return;
      const cx = id % CHUNKS_PER_SIDE;
      const cz = Math.floor(id / CHUNKS_PER_SIDE);
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.strokeRect(cx * CHUNK_CELLS * CELL * s, cz * CHUNK_CELLS * CELL * s, CHUNK_CELLS * CELL * s, CHUNK_CELLS * CELL * s);
    };
    outline(this.hover, 'rgba(255,240,90,0.95)');
    outline(this.selection, 'rgba(60,210,255,0.95)');

    // 拖框
    if (this.dragRect) {
      const x = Math.min(this.dragRect.x0, this.dragRect.x1) * s;
      const z = Math.min(this.dragRect.z0, this.dragRect.z1) * s;
      const w = Math.abs(this.dragRect.x1 - this.dragRect.x0) * s;
      const h = Math.abs(this.dragRect.z1 - this.dragRect.z0) * s;
      ctx.fillStyle = 'rgba(90,180,255,0.18)';
      ctx.fillRect(x, z, w, h);
      ctx.strokeStyle = 'rgba(120,200,255,0.95)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([5, 4]);
      ctx.strokeRect(x, z, w, h);
      ctx.setLineDash([]);
    }

    // 边框与比例尺
    ctx.strokeStyle = '#c8d4e0';
    ctx.lineWidth = 2;
    ctx.strokeRect(0, 0, FIELD_SIZE * s, FIELD_SIZE * s);
    ctx.fillStyle = '#c8d4e0';
    ctx.font = '11px sans-serif';
    ctx.fillText('0m', 0, FIELD_SIZE * s + 14);
    ctx.fillText('40m', FIELD_SIZE * s - 24, FIELD_SIZE * s + 14);
    ctx.restore();
  }

  private loop = () => {
    this.raf = requestAnimationFrame(this.loop);
    this.draw();
  };

  dispose() {
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
  }
}
