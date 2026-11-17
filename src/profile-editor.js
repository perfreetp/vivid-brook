/**
 * profile-editor.js — 二维半剖轮廓编辑器（Canvas2D）
 * 交互：拖拽控制点移动、双击空白处加点、双击/右键控制点删点、滚轮缩放
 */
import { sampleProfile, profileMetrics } from './geometry.js';

const HANDLE_R = 6;
const HIT_R = 11;

export class ProfileEditor {
  /**
   * @param canvas 目标 canvas
   * @param getState () => ({ controlPoints, threshold, readonly })
   * @param onChange (nextPoints) => void
   */
  constructor(canvas, getState, onChange) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.getState = getState;
    this.onChange = onChange;
    this.scale = 2.2;       // px / mm
    this.centerX = 0;       // 轴所在的屏幕 x
    this.dragIndex = -1;
    this.hoverIndex = -1;
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this._bound = false;
    this.bind();
    this.resize();
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(canvas);
  }

  destroy() {
    this.ro.disconnect();
    this.unbind();
  }

  bind() {
    if (this._bound) return;
    this._bound = true;
    this._onDown = e => this.onDown(e);
    this._onMove = e => this.onMove(e);
    this._onUp = () => { this.dragIndex = -1; this.canvas.style.cursor = 'crosshair'; };
    this._onDbl = e => this.onDoubleClick(e);
    this._onCtx = e => { e.preventDefault(); this.onRightClick(e); };
    this._onWheel = e => this.onWheel(e);
    this._onLeave = () => { this.hoverIndex = -1; this.draw(); };
    this.canvas.addEventListener('pointerdown', this._onDown);
    window.addEventListener('pointermove', this._onMove);
    window.addEventListener('pointerup', this._onUp);
    this.canvas.addEventListener('dblclick', this._onDbl);
    this.canvas.addEventListener('contextmenu', this._onCtx);
    this.canvas.addEventListener('wheel', this._onWheel, { passive: false });
    this.canvas.addEventListener('pointerleave', this._onLeave);
  }

  unbind() {
    if (!this._bound) return;
    this._bound = false;
    this.canvas.removeEventListener('pointerdown', this._onDown);
    window.removeEventListener('pointermove', this._onMove);
    window.removeEventListener('pointerup', this._onUp);
    this.canvas.removeEventListener('dblclick', this._onDbl);
    this.canvas.removeEventListener('contextmenu', this._onCtx);
    this.canvas.removeEventListener('wheel', this._onWheel);
    this.canvas.removeEventListener('pointerleave', this._onLeave);
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    this.w = rect.width;
    this.h = rect.height;
    this.canvas.width = Math.round(rect.width * this.dpr);
    this.canvas.height = Math.round(rect.height * this.dpr);
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.centerX = 64;
    this.baseY = this.h - 34;
    this.draw();
  }

  /** 世界坐标 (mm) → 屏幕 (px) */
  toScreen(r, y) {
    return { x: this.centerX + r * this.scale, y: this.baseY - y * this.scale };
  }
  toWorld(px, py) {
    const rect = this.canvas.getBoundingClientRect();
    const x = px - rect.left, y = py - rect.top;
    return { r: Math.max(0, (x - this.centerX) / this.scale), y: Math.max(0, (this.baseY - y) / this.scale) };
  }

  hitTest(px, py) {
    const { controlPoints } = this.getState();
    const rect = this.canvas.getBoundingClientRect();
    const x = px - rect.left, y = py - rect.top;
    for (let i = controlPoints.length - 1; i >= 0; i--) {
      const s = this.toScreen(controlPoints[i].r, controlPoints[i].y);
      if (Math.hypot(s.x - x, s.y - y) <= HIT_R) return i;
    }
    return -1;
  }

  onWheel(e) {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.08 : 1 / 1.08;
    const next = Math.min(8, Math.max(0.6, this.scale * factor));
    // 以指针位置为锚点缩放
    const rect = this.canvas.getBoundingClientRect();
    const ax = e.clientX - rect.left, ay = e.clientY - rect.top;
    const before = this.toWorld(e.clientX, e.clientY);
    this.scale = next;
    this.centerX = ax - before.r * this.scale;
    this.baseY = ay + before.y * this.scale;
    this.draw();
  }

  onDown(e) {
    if (e.button !== 0) return;
    const state = this.getState();
    if (state.readonly) return;
    const idx = this.hitTest(e.clientX, e.clientY);
    if (idx >= 0) {
      this.dragIndex = idx;
      this.canvas.style.cursor = 'grabbing';
    }
  }

  onMove(e) {
    const state = this.getState();
    if (this.dragIndex >= 0 && !state.readonly) {
      const w = this.toWorld(e.clientX, e.clientY);
      const pts = state.controlPoints.map(p => ({ ...p }));
      const i = this.dragIndex;
      const n = pts.length;
      const isAxisEnd = (i === 0 || i === n - 1);
      pts[i].r = isAxisEnd ? 0 : w.r;
      // 保持高度顺序单调（允许相等），端点限制在轴上高度范围
      const minY = i > 0 ? pts[i - 1].y : 0;
      const maxY = i < n - 1 ? pts[i + 1].y : Math.max(pts[i].y + 1, w.y);
      pts[i].y = Math.min(maxY, Math.max(minY, w.y));
      if (i === 0) pts[i].y = 0;
      if (i === n - 1) pts[i].y = Math.max(pts[n - 2].y, w.y);
      this.onChange(pts);
      this.draw();
      return;
    }
    const idx = state.readonly ? -1 : this.hitTest(e.clientX, e.clientY);
    if (idx !== this.hoverIndex) {
      this.hoverIndex = idx;
      this.canvas.style.cursor = idx >= 0 ? 'grab' : 'crosshair';
      this.draw();
    }
  }

  onDoubleClick(e) {
    const state = this.getState();
    if (state.readonly) return;
    const existing = this.hitTest(e.clientX, e.clientY);
    if (existing >= 0) { this.removePoint(existing); return; }
    const w = this.toWorld(e.clientX, e.clientY);
    const pts = state.controlPoints.map(p => ({ ...p }));
    // 按高度插入到正确位置
    let k = pts.findIndex(p => p.y > w.y);
    if (k < 0) k = pts.length - 1;
    pts.splice(k, 0, { r: w.r, y: w.y });
    this.onChange(pts);
    this.draw();
  }

  onRightClick(e) {
    const state = this.getState();
    if (state.readonly) return;
    const idx = this.hitTest(e.clientX, e.clientY);
    if (idx >= 0) this.removePoint(idx);
  }

  removePoint(i) {
    const { controlPoints } = this.getState();
    if (controlPoints.length <= 4 || i === 0 || i === controlPoints.length - 1) return; // 保留轴上两端点
    const pts = controlPoints.filter((_, j) => j !== i);
    this.onChange(pts);
    this.draw();
  }

  /* ---------------- 渲染 ---------------- */

  draw() {
    const ctx = this.ctx;
    const state = this.getState();
    if (!state) return;
    const { controlPoints: cps, threshold, readonly } = state;
    const samples = sampleProfile(cps, 20);
    const metrics = profileMetrics(cps, threshold);

    ctx.clearRect(0, 0, this.w, this.h);
    this.drawGrid(ctx);

    // 回转体填充提示（镜像半剖）
    ctx.save();
    ctx.beginPath();
    samples.forEach((p, i) => {
      const s = this.toScreen(p.r, p.y);
      i === 0 ? ctx.moveTo(s.x, s.y) : ctx.lineTo(s.x, s.y);
    });
    for (let i = samples.length - 1; i >= 0; i--) {
      const s = this.toScreen(-samples[i].r, samples[i].y);
      ctx.lineTo(s.x, s.y);
    }
    ctx.closePath();
    ctx.fillStyle = 'rgba(23,105,224,0.08)';
    ctx.fill();
    ctx.restore();

    this.drawAxis(ctx);
    this.drawCurvatureComb(ctx, samples, metrics, cps);
    this.drawSpline(ctx, samples, metrics, cps);
    this.drawHandles(ctx, cps, metrics, readonly);
  }

  drawGrid(ctx) {
    const step = 20 * this.scale; // 20mm 网格
    ctx.strokeStyle = 'rgba(120,140,160,0.16)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = this.centerX % step; x < this.w; x += step) { ctx.moveTo(x, 0); ctx.lineTo(x, this.h); }
    for (let y = this.baseY % step; y > 0; y -= step) { ctx.moveTo(0, y); ctx.lineTo(this.w, y); }
    ctx.stroke();
    ctx.fillStyle = 'rgba(120,140,160,0.75)';
    ctx.font = '10px Consolas, monospace';
    ctx.fillText('网格 20mm', 8, 14);
  }

  drawAxis(ctx) {
    ctx.strokeStyle = 'rgba(180,60,60,0.55)';
    ctx.setLineDash([6, 5]);
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(this.centerX, 8);
    ctx.lineTo(this.centerX, this.baseY);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(180,60,60,0.8)';
    ctx.font = '11px "Segoe UI", sans-serif';
    ctx.fillText('回转轴 r=0', this.centerX + 6, this.baseY - 4);
    // 原点与方向
    ctx.fillText('y(mm) ↑', this.centerX + 6, 20);
    ctx.fillText('r(mm) →', this.centerX + 4, this.baseY + 16);
  }

  /** 曲率梳：沿样条法向按 κ 比例伸出，超限段标红 */
  drawCurvatureComb(ctx, samples, metrics, cps) {
    const combScale = 900;
    ctx.lineWidth = 1;
    for (let i = 1; i < samples.length - 1; i++) {
      const a = samples[i - 1], b = samples[i], c = samples[i + 1];
      const dr = c.r - a.r, dy = c.y - a.y;
      const len = Math.hypot(dr, dy) || 1;
      // 法向（指向轮廓外侧，即 +r 方向一侧）
      const nx = dy / len, ny = -dr / len;
      // 估算该采样点曲率
      const r1 = b.r - a.r, y1 = b.y - a.y, r2 = c.r - b.r, y2 = c.y - b.y;
      const denom = (r1 * r1 + y1 * y1) * (r2 * r2 + y2 * y2);
      const k = denom < 1e-12 ? 0 : Math.abs(r1 * y2 - y1 * r2) / Math.pow(denom, 0.75);
      const s0 = this.toScreen(b.r, b.y);
      const s1 = this.toScreen(b.r + nx * k * combScale / this.scale, b.y + ny * k * combScale / this.scale);
      ctx.strokeStyle = k > this.getState().threshold ? 'rgba(217,56,46,0.85)' : 'rgba(122,79,208,0.55)';
      ctx.beginPath();
      ctx.moveTo(s0.x, s0.y);
      ctx.lineTo(s1.x, s1.y);
      ctx.stroke();
    }
  }

  drawSpline(ctx, samples, metrics, cps) {
    // 找出超限控制点的 y 区间，将其附近曲线段染红
    const overY = new Set(metrics.filter(m => m.overThreshold).map(m => cps[m.index].y));
    ctx.lineWidth = 2.4;
    ctx.strokeStyle = '#1769e0';
    ctx.beginPath();
    samples.forEach((p, i) => {
      const s = this.toScreen(p.r, p.y);
      i === 0 ? ctx.moveTo(s.x, s.y) : ctx.lineTo(s.x, s.y);
    });
    ctx.stroke();
    if (overY.size) {
      ctx.strokeStyle = '#d9382e';
      ctx.lineWidth = 3;
      ctx.beginPath();
      let pen = false;
      samples.forEach((p, i) => {
        const near = [...overY].some(y => Math.abs(y - p.y) < 6);
        const s = this.toScreen(p.r, p.y);
        if (near) { if (!pen) { ctx.moveTo(s.x, s.y); pen = true; } else ctx.lineTo(s.x, s.y); }
        else pen = false;
      });
      ctx.stroke();
    }
  }

  drawHandles(ctx, cps, metrics, readonly) {
    cps.forEach((p, i) => {
      const s = this.toScreen(p.r, p.y);
      const m = metrics[i];
      const over = m?.overThreshold;
      const hovered = i === this.hoverIndex || i === this.dragIndex;
      // 控制点
      ctx.beginPath();
      ctx.arc(s.x, s.y, hovered ? HANDLE_R + 2 : HANDLE_R, 0, Math.PI * 2);
      ctx.fillStyle = over ? '#d9382e' : '#ffffff';
      ctx.fill();
      ctx.lineWidth = hovered ? 2.4 : 1.8;
      ctx.strokeStyle = over ? '#a01f17' : '#1769e0';
      ctx.stroke();
      // 编号 + 实时数据（悬停或超限时显示）
      if (hovered || over) {
        const label = `#${i} r${p.r.toFixed(1)} y${p.y.toFixed(1)} | κ=${m.curvature.toFixed(4)} θ=${m.angle.toFixed(1)}°`;
        ctx.font = '11px Consolas, monospace';
        const tw = ctx.measureText(label).width;
        const lx = Math.min(this.w - tw - 8, s.x + 10);
        const ly = Math.max(16, s.y - 10);
        ctx.fillStyle = over ? 'rgba(217,56,46,0.94)' : 'rgba(28,39,51,0.92)';
        ctx.beginPath();
        ctx.roundRect(lx - 5, ly - 12, tw + 10, 18, 5);
        ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.fillText(label, lx, ly + 1);
      } else {
        ctx.fillStyle = 'rgba(90,107,124,0.9)';
        ctx.font = '10px Consolas, monospace';
        ctx.fillText(String(i), s.x - 3, s.y - 9);
      }
    });
    if (readonly) {
      ctx.fillStyle = 'rgba(120,130,145,0.85)';
      ctx.font = '12px "Segoe UI", sans-serif';
      ctx.fillText('只读预览（质检视图）', 8, this.h - 10);
    }
  }
}
