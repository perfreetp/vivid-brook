import type { Camera } from '../types.js';
import { BaseElement, fallbackStyleEl } from './base.js';
import { WebGPURenderer } from '../renderer/webgpu.js';
import { Canvas2DRenderer } from '../renderer/canvas2d.js';
import type { SceneRenderer } from '../renderer/renderer.js';
import { screenToWorld } from '../renderer/renderer.js';
import { evaluateScene } from '../core/evaluator.js';
import { buildPrimitives } from '../core/scene.js';
import { dist, clamp } from '../core/math.js';

export class ViewportElement extends BaseElement {
  private canvas!: HTMLCanvasElement;
  private labelLayer!: HTMLDivElement;
  private renderer: SceneRenderer | null = null;
  private raf = 0;
  private drag:
    | { kind: 'pan'; startX: number; startY: number; cam: Camera }
    | { kind: 'rotate'; boneId: string }
    | null = null;
  private statusEl!: HTMLDivElement;
  private lastFrameDrawn = -1;

  protected render(): void {
    this.root.innerHTML = /* html */ `
      ${fallbackStyleEl().outerHTML}
      <style>
        :host { position: relative; display: block; flex: 1 1 0; min-height: 0; width: 100%; background: var(--bg); overflow: hidden; }
        .wrap { position: absolute; inset: 0; }
        canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; cursor: default; }
        .labels { position: absolute; inset: 0; pointer-events: none; }
        .bone-label {
          position: absolute; transform: translate(8px, -50%);
          background: rgba(16,23,30,.82); border: 1px solid var(--border);
          padding: 1px 7px; border-radius: 9px; font-size: 11px; white-space: nowrap;
        }
        .bone-label.over { border-color: var(--danger); color: #ff8a80; }
        .bone-label.sel { border-color: var(--gold); color: var(--gold); }
        .status {
          position: absolute; left: 10px; bottom: 10px; display: flex; gap: 12px;
          background: rgba(16,23,30,.85); border: 1px solid var(--border);
          padding: 6px 10px; border-radius: 6px; font-size: 11px; color: var(--muted);
        }
        .status b { color: var(--text); font-weight: 600; }
        .status .over { color: var(--danger); font-weight: 700; }
        .backend { position: absolute; right: 10px; top: 10px; font-size: 11px; color: var(--muted);
          background: rgba(16,23,30,.85); border: 1px solid var(--border); padding: 4px 9px; border-radius: 6px; }
      </style>
      <div class="wrap">
        <canvas></canvas>
        <div class="labels"></div>
        <div class="backend" id="backend"></div>
        <div class="status" id="status"></div>
      </div>
    `;
    this.canvas = this.el('canvas');
    this.labelLayer = this.el('.labels');
    this.statusEl = this.el('#status');
    this.el<HTMLDivElement>('#backend').textContent = '渲染器初始化中…';
  }

  protected bind(): void {
    this.initRenderer();
    this.listen('renderer', () => { this.renderer?.dispose(); this.renderer = null; this.initRenderer(); });
    this.listen('project', () => this.draw(true));
    this.listen('selection', () => this.draw(true));
    this.listen('camera', () => this.draw(true));
    this.listen('playhead', () => this.draw(false));
    this.listen('playing', () => {});

    // 尺寸自适应
    const ro = new ResizeObserver(() => this.resize());
    ro.observe(this.canvas.parentElement!);
    this.unsubs.push(() => ro.disconnect());

    this.canvas.addEventListener('pointerdown', this.onPointerDown);
    window.addEventListener('pointermove', this.onPointerMove);
    window.addEventListener('pointerup', this.onPointerUp);
    this.canvas.addEventListener('wheel', this.onWheel, { passive: false });
    this.unsubs.push(() => {
      window.removeEventListener('pointermove', this.onPointerMove);
      window.removeEventListener('pointerup', this.onPointerUp);
      cancelAnimationFrame(this.raf);
    });

    // 播放循环由 rAF 驱动，按时间精确推进帧
    let last = performance.now();
    const tick = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      const p = this.store.project;
      if (p && this.store.playing) {
        let f = this.store.frame + dt * p.fps;
        if (f >= p.frameCount) {
          if (this.store.loop) f = f % p.frameCount;
          else { f = p.frameCount - 1; this.store.setPlaying(false); }
        }
        this.store.setFrame(f);
      }
      this.draw(false);
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  private async initRenderer(): Promise<void> {
    if (this.store.rendererKind === 'webgpu') {
      try {
        this.resize();
        this.renderer = await WebGPURenderer.create(this.canvas);
        this.el<HTMLDivElement>('#backend').textContent = 'WebGPU 硬件渲染';
        this.store.setRendererKind('webgpu');
      } catch (e) {
        console.warn('WebGPU 初始化失败，回退 Canvas2D：', e);
        const ctx = this.canvas.getContext('2d')!;
        this.renderer = new Canvas2DRenderer(ctx);
        this.el<HTMLDivElement>('#backend').textContent = 'Canvas2D 兼容渲染（WebGPU 不可用）';
        this.store.rendererKind = 'canvas2d';
      }
    } else {
      const ctx = this.canvas.getContext('2d')!;
      this.renderer = new Canvas2DRenderer(ctx);
      this.el<HTMLDivElement>('#backend').textContent = 'Canvas2D 兼容渲染';
    }
    this.resize();
    this.draw(true);
  }

  private resize(): void {
    const rect = this.canvas.parentElement!.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(320, Math.floor(rect.width));
    const h = Math.max(240, Math.floor(rect.height));
    this.canvas.width = Math.floor(w * dpr);
    this.canvas.height = Math.floor(h * dpr);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    // Canvas2D 需要按 dpr 缩放，使图元坐标映射到 CSS 像素
    const ctx = this.canvas.getContext('2d');
    if (ctx && this.renderer?.kind === 'canvas2d') ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this._cssW = w;
    this._cssH = h;
    this.draw(true);
  }

  private _cssW = 800;
  private _cssH = 600;

  private draw(force: boolean): void {
    const p = this.store.project;
    if (!p || !this.renderer) return;
    const frame = Math.round(this.store.frame);
    this.lastFrameDrawn = frame;
    void force;
    const scene = evaluateScene(p, frame);
    const prims = buildPrimitives(p, scene, this.store.selectedBoneId);
    this.renderer.render(prims, this.store.camera, this._cssW, this._cssH);
    this.updateLabels(scene);
    this.updateStatus(scene);
  }

  private updateLabels(scene: ReturnType<typeof evaluateScene>): void {
    const cam = this.store.camera;
    const html = scene.bones
      .filter((b) => b.bone.length >= 0)
      .map((b) => {
        const sx = this._cssW / 2 + cam.panX + b.start.x * cam.zoom;
        const sy = this._cssH / 2 - cam.panY - b.start.y * cam.zoom;
        const cls = b.overLimit ? 'over' : this.store.selectedBoneId === b.bone.id ? 'sel' : '';
        return `<span class="bone-label ${cls}" style="left:${sx}px;top:${sy}px">${b.bone.name} ${b.localAngle.toFixed(1)}°</span>`;
      })
      .join('');
    this.labelLayer.innerHTML = html;
  }

  private updateStatus(scene: ReturnType<typeof evaluateScene>): void {
    const over = scene.bones.filter((b) => b.overLimit);
    const p = this.store.project!;
    const frame = Math.round(this.store.frame);
    const totalSec = (p.frameCount / p.fps).toFixed(2);
    const curSec = (frame / p.fps).toFixed(2);
    this.statusEl.innerHTML = `
      <span>帧 <b>${frame}</b>/${p.frameCount - 1}</span>
      <span>时间 <b>${curSec}s</b> / 总时长 <b>${totalSec}s</b>（${p.fps}fps）</span>
      <span class="${over.length ? 'over' : ''}">${over.length ? '⚠ 限位触发：' + over.map((o) => o.bone.name).join('、') : '关节状态正常'}</span>
    `;
  }

  // ---------------- 交互 ----------------

  private eventPos(e: PointerEvent | WheelEvent) {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private onPointerDown = (e: PointerEvent): void => {
    this.canvas.setPointerCapture(e.pointerId);
    const sp = this.eventPos(e);
    const wp = screenToWorld(sp.x, sp.y, this.store.camera, this._cssW, this._cssH);
    if (e.button === 1 || e.shiftKey || e.button === 2) {
      this.drag = { kind: 'pan', startX: e.clientX, startY: e.clientY, cam: { ...this.store.camera } };
      return;
    }
    // 命中测试：找最近的骨骼起点（铰点）
    const scene = evaluateScene(this.store.project!, Math.round(this.store.frame));
    let hit: string | null = null;
    let best = 18 / this.store.camera.zoom + 6;
    for (const bw of scene.bones) {
      const d = dist(wp, bw.start);
      if (d < best) { best = d; hit = bw.bone.id; }
    }
    if (hit) {
      this.store.selectBone(hit);
      // 拖拽开始时压一次撤销栈，移动过程中只更新数据
      this.store.pushUndo();
      this.drag = { kind: 'rotate', boneId: hit };
    } else {
      this.store.selectBone(null);
      this.drag = { kind: 'pan', startX: e.clientX, startY: e.clientY, cam: { ...this.store.camera } };
    }
  };

  private onPointerMove = (e: PointerEvent): void => {
    const d = this.drag;
    if (!d) return;
    if (d.kind === 'pan') {
      const dx = e.clientX - d.startX;
      const dy = e.clientY - d.startY;
      this.store.setCamera({ panX: d.cam.panX + dx, panY: d.cam.panY - dy });
      return;
    }
    // 旋转：指针相对骨骼起点的方位角 -> 局部角
    const p = this.store.project!;
    const bone = p.bones.find((b) => b.id === d.boneId);
    if (!bone) return;
    const scene = evaluateScene(p, Math.round(this.store.frame));
    const bw = scene.byId.get(bone.id)!;
    const sp = this.eventPos(e);
    const wp = screenToWorld(sp.x, sp.y, this.store.camera, this._cssW, this._cssH);
    const worldAngle = Math.atan2(wp.y - bw.start.y, wp.x - bw.start.x) * 180 / Math.PI;
    const parentAngle = bw.bone.parentId ? scene.byId.get(bw.bone.parentId!)?.worldAngle ?? 0 : 0;
    const local = worldAngle - parentAngle;
    this.applyLiveAngle(bone.id, local);
  };

  /** 拖拽中的临时角度（撤销栈已在拖拽起点压入，这里只更新数据并刷新） */
  private applyLiveAngle(boneId: string, angle: number): void {
    const p = this.store.project!;
    const track = p.tracks[boneId];
    const frame = Math.round(this.store.frame);
    const existing = track.find((k) => k.frame === frame);
    if (existing) existing.angle = angle;
    else {
      track.push({ frame, angle, easing: 'ease-in-out', inTangent: 0, outTangent: 0 });
      track.sort((a, b) => a.frame - b.frame);
    }
    this.store.emit('project');
  }

  private onPointerUp = (): void => {
    if (this.drag?.kind === 'rotate') {
      this.store.save();
    }
    this.drag = null;
  };

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    const sp = this.eventPos(e);
    const before = screenToWorld(sp.x, sp.y, this.store.camera, this._cssW, this._cssH);
    const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
    const zoom = clamp(this.store.camera.zoom * factor, 0.25, 6);
    // 以鼠标位置为锚点缩放
    const panX = sp.x - this._cssW / 2 - before.x * zoom;
    const panY = -(sp.y - this._cssH / 2) + before.y * zoom;
    this.store.setCamera({ zoom, panX, panY });
  };
}
