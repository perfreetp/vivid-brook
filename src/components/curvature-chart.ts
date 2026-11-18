import { store } from '../state/store';
import { sampleSpline } from '../math/spline';
import { sharedCss } from './styles';

/**
 * 沿线曲率/曲率半径实时曲线（Canvas 绘制）。
 * 红底区域为超阈值的曲率突变段；双 Y 轴：左曲率、右半径。
 */
export class CurvatureChart extends HTMLElement {
  private root: ShadowRoot;
  private canvas: HTMLCanvasElement;
  private unsub: (() => void) | null = null;

  constructor() {
    super();
    this.root = this.attachShadow({ mode: 'open' });
    this.root.innerHTML = `
      <style>${sharedCss}
        .wrap { border:1px solid #e2e8f0; border-radius:6px; background:#fcfdff; padding:6px; }
        canvas { width:100%; height:170px; display:block; }
        .legend { display:flex; gap:14px; font-size:11px; color:#475569; margin-top:2px; }
        .dot { display:inline-block; width:10px; height:10px; border-radius:2px; margin-right:3px; vertical-align:middle; }
      </style>
      <div class="wrap">
        <canvas width="520" height="170"></canvas>
        <div class="legend">
          <span><i class="dot" style="background:#2563eb"></i>曲率 κ (1/m)</span>
          <span><i class="dot" style="background:#7c3aed"></i>曲率半径 R (m)</span>
          <span><i class="dot" style="background:#dc2626"></i>超阈值突变段</span>
        </div>
      </div>`;
    this.canvas = this.root.querySelector('canvas')!;
  }

  connectedCallback(): void {
    this.unsub = store.subscribe(() => this.draw());
  }
  disconnectedCallback(): void {
    this.unsub?.();
  }

  private draw(): void {
    const s = store.get();
    const line = s.lines[s.activeLine];
    const samples = sampleSpline(line.controlPoints, 24, s.curvature.smoothWindow);
    const cv = this.canvas;
    const ctx2d = cv.getContext('2d')!;
    const W = cv.width;
    const H = cv.height;
    ctx2d.clearRect(0, 0, W, H);
    if (samples.length < 2) {
      ctx2d.fillStyle = '#94a3b8';
      ctx2d.font = '13px sans-serif';
      ctx2d.fillText('当前线控制点不足，无法计算曲率', 20, H / 2);
      return;
    }

    const padL = 52;
    const padR = 52;
    const padT = 14;
    const padB = 26;
    const plotW = W - padL - padR;
    const plotH = H - padT - padB;
    const totalS = samples[samples.length - 1].s || 1;
    const kMax = Math.max(s.curvature.threshold * 1.2, ...samples.map((q) => q.curvature));
    const finiteR = samples.map((q) => q.radius).filter((r) => isFinite(r));
    const rMax = finiteR.length ? Math.max(...finiteR) : 1;

    const xOf = (st: number) => padL + (st / totalS) * plotW;
    const yK = (k: number) => padT + plotH - (k / kMax) * plotH;
    const yR = (r: number) => padT + plotH - (Math.min(r, rMax) / rMax) * plotH;

    // 网格与轴
    ctx2d.strokeStyle = '#e2e8f0';
    ctx2d.fillStyle = '#64748b';
    ctx2d.font = '10px Consolas, monospace';
    ctx2d.lineWidth = 1;
    for (let g = 0; g <= 4; g++) {
      const y = padT + (plotH * g) / 4;
      ctx2d.beginPath();
      ctx2d.moveTo(padL, y);
      ctx2d.lineTo(W - padR, y);
      ctx2d.stroke();
      ctx2d.fillText((kMax * (1 - g / 4)).toFixed(4), 4, y + 3);
      ctx2d.fillText((rMax * (1 - g / 4)).toFixed(0), W - padR + 4, y + 3);
    }
    for (let g = 0; g <= 5; g++) {
      const st = (totalS * g) / 5;
      ctx2d.fillText(`${st.toFixed(0)}m`, xOf(st) - 12, H - 8);
    }

    // 突变段红底
    ctx2d.fillStyle = 'rgba(220,38,38,0.14)';
    let hotStart = -1;
    for (let i = 0; i <= samples.length; i++) {
      const hot = i < samples.length && samples[i].curvature >= s.curvature.threshold;
      if (hot && hotStart < 0) hotStart = i;
      if (!hot && hotStart >= 0) {
        const x1 = xOf(samples[hotStart].s);
        const x2 = xOf(samples[Math.max(hotStart, i - 1)].s);
        ctx2d.fillRect(x1, padT, Math.max(2, x2 - x1), plotH);
        hotStart = -1;
      }
    }

    // 阈值线
    ctx2d.strokeStyle = '#dc2626';
    ctx2d.setLineDash([5, 4]);
    ctx2d.beginPath();
    ctx2d.moveTo(padL, yK(s.curvature.threshold));
    ctx2d.lineTo(W - padR, yK(s.curvature.threshold));
    ctx2d.stroke();
    ctx2d.setLineDash([]);

    // 曲率曲线
    ctx2d.strokeStyle = '#2563eb';
    ctx2d.lineWidth = 2;
    ctx2d.beginPath();
    samples.forEach((q, i) => {
      const x = xOf(q.s);
      const y = yK(q.curvature);
      i === 0 ? ctx2d.moveTo(x, y) : ctx2d.lineTo(x, y);
    });
    ctx2d.stroke();

    // 曲率半径曲线
    ctx2d.strokeStyle = '#7c3aed';
    ctx2d.lineWidth = 1.6;
    ctx2d.beginPath();
    let started = false;
    samples.forEach((q) => {
      if (!isFinite(q.radius)) return;
      const x = xOf(q.s);
      const y = yR(q.radius);
      if (!started) {
        ctx2d.moveTo(x, y);
        started = true;
      } else ctx2d.lineTo(x, y);
    });
    ctx2d.stroke();

    // 标题
    ctx2d.fillStyle = '#334155';
    ctx2d.font = 'bold 11px sans-serif';
    ctx2d.fillText(`${line.name} · 里程-曲率曲线`, padL, 10);
  }
}
