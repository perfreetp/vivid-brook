/**
 * revolve-renderer.js — 半剖轮廓绕轴旋转的瓶身曲面预览
 * 离屏光栅化：优先 OffscreenCanvas 完成网格投影/光照绘制，再 blit 到可见 canvas；
 * 不支持时直接在可见 canvas 上渲染（等价降级）。
 */
import { sampleProfile } from './geometry.js';

const SEG_THETA = 72;     // 环向分段
const TINT = { r: 46, g: 122, b: 226 };
const LIGHT = normalize({ x: -0.45, y: 0.82, z: 0.55 });

function normalize(v) {
  const l = Math.hypot(v.x, v.y, v.z) || 1;
  return { x: v.x / l, y: v.y / l, z: v.z / l };
}

export class RevolveRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.yaw = 0.6;
    this.tilt = 0.16;
    this.auto = true;
    this.showWire = false;
    this.drag = null;
    this._supportsOff = typeof OffscreenCanvas !== 'undefined';
    this.off = this._supportsOff ? new OffscreenCanvas(300, 300) : null;
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(canvas);
    this.resize();
    this.bind();
    this._raf = null;
    this._last = 0;
    this.tick = this.tick.bind(this);
    this.start();
  }

  destroy() {
    this.ro.disconnect();
    this.unbind();
    if (this._raf) cancelAnimationFrame(this._raf);
  }

  bind() {
    this._down = e => {
      this.auto = false;
      this.drag = { x: e.clientX, y: e.clientY, yaw: this.yaw, tilt: this.tilt };
    };
    this._move = e => {
      if (!this.drag) return;
      this.yaw = this.drag.yaw + (e.clientX - this.drag.x) * 0.012;
      this.tilt = Math.max(-0.9, Math.min(0.9, this.drag.tilt + (e.clientY - this.drag.y) * 0.008));
    };
    this._up = () => { this.drag = null; };
    this.canvas.addEventListener('pointerdown', this._down);
    window.addEventListener('pointermove', this._move);
    window.addEventListener('pointerup', this._up);
  }
  unbind() {
    this.canvas.removeEventListener('pointerdown', this._down);
    window.removeEventListener('pointermove', this._move);
    window.removeEventListener('pointerup', this._up);
  }

  setWire(v) { this.showWire = v; this.render(); }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return; // 画布隐藏（阶段未激活），等 remeasure
    this.w = rect.width; this.h = rect.height;
    this.canvas.width = Math.round(rect.width * this.dpr);
    this.canvas.height = Math.round(rect.height * this.dpr);
    if (this.off) { this.off.width = this.canvas.width; this.off.height = this.canvas.height; }
    this.render();
  }

  /** 阶段切换到曲面页时调用 */
  remeasure() {
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return;
    if (rect.width !== this.w || rect.height !== this.h) this.resize();
    else this.render();
  }

  setProfile(controlPoints, material) {
    this.controlPoints = controlPoints;
    this.material = material;
    this.render();
  }

  start() {
    const loop = t => {
      if (this.auto && !this.drag) this.yaw += 0.0045;
      if (this.auto || this.drag) this.render();
      this._raf = requestAnimationFrame(loop);
    };
    this._raf = requestAnimationFrame(loop);
  }

  tick() { this.render(); }

  /* ---------- 离屏渲染主流程 ---------- */

  buildMesh(cps) {
    const s = sampleProfile(cps, 26);
    const ys = s.map(p => p.y), rs = s.map(p => p.r);
    const yMin = ys[0], yMax = ys[ys.length - 1];
    const rMax = Math.max(...rs, 1);
    const h = yMax - yMin || 1;
    // 归一化设备坐标 → 屏幕
    const k = Math.min(this.w / (rMax * 2.6), this.h / (h * 1.25));
    const cx = this.w / 2, cy = this.h / 2;
    const project = (x, y, z) => ({
      x: cx + x * k,
      y: cy - (y - (yMin + yMax) / 2) * k,
      z,
    });
    const cyY = Math.cos(this.yaw), syY = Math.sin(this.yaw);
    const ct = Math.cos(this.tilt), st = Math.sin(this.tilt);
    const rotate = (r, y, theta) => {
      // 绕 y 轴（瓶轴）自转，再绕 x 轴倾斜
      const x0 = r * Math.cos(theta), z0 = r * Math.sin(theta);
      const x1 = x0 * cyY + z0 * syY;
      const z1 = -x0 * syY + z0 * cyY;
      const y1 = y * ct - z1 * st;
      const z2 = y * st + z1 * ct;
      return { x: x1, y: y1, z: z2 };
    };
    return { s, project, rotate, yMin, yMax, rMax, h };
  }

  render() {
    if (!Number.isFinite(this.w) || !Number.isFinite(this.h)) return; // 画布尚未可见
    this.painted = true;
    const target = this.off ?? this.canvas;
    const ctx = target.getContext('2d');
    const W = this.canvas.width, H = this.canvas.height;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.w, this.h);
    this.drawBackdrop(ctx);
    if (!this.controlPoints || this.controlPoints.length < 2) return;

    const { s, project, rotate } = this.buildMesh(this.controlPoints);
    const quads = [];
    for (let i = 0; i < s.length - 1; i++) {
      for (let j = 0; j < SEG_THETA; j++) {
        const t0 = (j / SEG_THETA) * Math.PI * 2;
        const t1 = ((j + 1) / SEG_THETA) * Math.PI * 2;
        const v00 = rotate(s[i].r, s[i].y, t0);
        const v10 = rotate(s[i + 1].r, s[i + 1].y, t0);
        const v11 = rotate(s[i + 1].r, s[i + 1].y, t1);
        const v01 = rotate(s[i].r, s[i].y, t1);
        const p = [v00, v10, v11, v01].map(v => project(v.x, v.y, v.z));
        const zAvg = (v00.z + v10.z + v11.z + v01.z) / 4;
        // 有限差分法向
        const n = normalize({
          x: (v10.x - v00.x) * (v01.y - v00.y) - (v10.y - v00.y) * (v01.x - v00.x),
          y: 0, z: 0,
        });
        const e1 = { x: v10.x - v00.x, y: v10.y - v00.y, z: v10.z - v00.z };
        const e2 = { x: v01.x - v00.x, y: v01.y - v00.y, z: v01.z - v00.z };
        const normal = normalize({
          x: e1.y * e2.z - e1.z * e2.y,
          y: e1.z * e2.x - e1.x * e2.z,
          z: e1.x * e2.y - e1.y * e2.x,
        });
        quads.push({ p, zAvg, normal });
      }
    }
    // 画家算法：远 → 近
    quads.sort((a, b) => a.zAvg - b.zAvg);
    const matColor = this.materialTint();
    for (const q of quads) {
      const ndl = Math.max(0, q.normal.x * LIGHT.x + q.normal.y * LIGHT.y + q.normal.z * LIGHT.z);
      const facing = Math.max(0, q.normal.z) * 0.25; // 边缘压暗
      const shade = 0.32 + ndl * 0.68 - facing;
      ctx.beginPath();
      q.p.forEach((pt, i) => (i === 0 ? ctx.moveTo(pt.x, pt.y) : ctx.lineTo(pt.x, pt.y)));
      ctx.closePath();
      ctx.fillStyle = `rgb(${Math.round(matColor.r * shade)},${Math.round(matColor.g * shade)},${Math.round(matColor.b * shade)})`;
      ctx.fill();
      if (this.showWire) {
        ctx.strokeStyle = 'rgba(255,255,255,0.18)';
        ctx.lineWidth = 0.6;
        ctx.stroke();
      }
    }
    this.drawProfileRim(ctx, s, project, rotate);

    if (this.off) {
      const visible = this.canvas.getContext('2d');
      visible.setTransform(1, 0, 0, 1, 0, 0);
      visible.clearRect(0, 0, W, H);
      visible.drawImage(this.off, 0, 0);
    }
  }

  materialTint() {
    // 不同材质给一个差异化基色
    switch (this.material) {
      case 'PET 透明': return { r: 90, g: 150, b: 220 };
      case 'PE 乳白': return { r: 214, g: 226, b: 238 };
      case 'PP 磨砂': return { r: 150, g: 170, b: 195 };
      case 'PCR 再生': return { r: 120, g: 168, b: 140 };
      default: return TINT;
    }
  }

  drawBackdrop(ctx) {
    const g = ctx.createLinearGradient(0, 0, 0, this.h);
    g.addColorStop(0, 'rgba(120,140,170,0.10)');
    g.addColorStop(1, 'rgba(120,140,170,0.02)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, this.w, this.h);
    // 地面线
    ctx.strokeStyle = 'rgba(120,140,170,0.35)';
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(12, this.h - 24);
    ctx.lineTo(this.w - 12, this.h - 24);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  drawProfileRim(ctx, s, project, rotate) {
    // 两侧轮廓棱线，强化瓶型识别
    ctx.lineWidth = 1.6;
    for (const theta of [0, Math.PI]) {
      ctx.beginPath();
      s.forEach((p, i) => {
        const v = rotate(p.r, p.y, theta);
        const q = project(v.x, v.y, v.z);
        i === 0 ? ctx.moveTo(q.x, q.y) : ctx.lineTo(q.x, q.y);
      });
      ctx.strokeStyle = 'rgba(10,30,60,0.35)';
      ctx.stroke();
    }
  }
}
