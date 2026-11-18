import type { AppState } from '../lib/store';
import { store } from '../lib/store';
import { BaseElement } from '../lib/base';
import { computeProfile } from '../lib/engine';
import { cctToColor } from '../lib/photometry';
import type { Vec3 } from '../types';
import { polygonRings } from '../types';
import { scheduleName } from './side-panel';

const W = 760;
const H = 210;
const PAD = { l: 46, r: 14, t: 16, b: 28 };

export class ProfileView extends BaseElement {
  template(): string {
    return `
      <style>
        :host { display:block; background:var(--panel); border-top:1px solid var(--line); }
        .head { display:flex; justify-content:space-between; align-items:center; padding:6px 12px; }
        svg { width:100%; height:180px; }
        .lamp-mark { cursor:pointer; }
      </style>
      <div class="head">
        <b>纵断面图（灯杆高度与地面关系）</b>
        <span class="muted" id="meta"></span>
      </div>
      <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"></svg>
    `;
  }

  onState(state: AppState): void {
    const svg = this.$('svg')!;
    const samples = computeProfile(state.project);
    const sMax = samples[samples.length - 1].s;
    const zs = samples.map((s) => s.groundZ);
    const lightZs = samples.map((s) => s.lampLightZ ?? s.groundZ);
    const zMin = Math.min(...zs) - 1;
    const zMax = Math.max(...lightZs) + 1;
    const x = (s: number) => PAD.l + (s / sMax) * (W - PAD.l - PAD.r);
    const y = (z: number) => PAD.t + (1 - (z - zMin) / (zMax - zMin)) * (H - PAD.t - PAD.b);
    const NS = 'http://www.w3.org/2000/svg';
    const el = (name: string, attrs: Record<string, string | number>): SVGElement => {
      const e = document.createElementNS(NS, name);
      for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
      return e;
    };
    svg.innerHTML = '';

    // 网格 + z 轴
    for (let z = Math.ceil(zMin); z <= zMax; z += 2) {
      svg.appendChild(el('line', { x1: PAD.l, x2: W - PAD.r, y1: y(z), y2: y(z), stroke: '#222d3b', 'stroke-width': 0.7 }));
      const t = el('text', { x: PAD.l - 6, y: y(z) + 3, 'text-anchor': 'end', 'font-size': 9, fill: '#7f93aa' });
      t.textContent = `${z}m`;
      svg.appendChild(t);
    }
    for (let s = 0; s <= sMax; s += 20) {
      const t = el('text', { x: x(s), y: H - 8, 'text-anchor': 'middle', 'font-size': 9, fill: '#7f93aa' });
      t.textContent = `${s}m`;
      svg.appendChild(t);
    }

    // 地面线与填充
    const groundPath = samples.map((p, i) => `${i ? 'L' : 'M'}${x(p.s).toFixed(1)},${y(p.groundZ).toFixed(1)}`).join(' ');
    svg.appendChild(el('path', {
      d: `${groundPath} L${x(sMax)},${y(zMin)} L${x(0)},${y(zMin)} Z`,
      fill: 'rgba(127,176,232,.12)', stroke: 'none',
    }));
    svg.appendChild(el('path', { d: groundPath, fill: 'none', stroke: '#7fb0e8', 'stroke-width': 1.6 }));

    // 灯杆与光源
    for (const p of samples) {
      if (!p.lamp || p.lampLightZ === null || p.poleBaseZ === null) continue;
      const lamp = p.lamp;
      const on = lamp.schedule[state.schedule];
      const color = on ? cctToColor(lamp.cct) : '#55606e';
      const g = el('g', { class: 'lamp-mark', 'data-id': lamp.id });
      g.appendChild(el('line', {
        x1: x(p.s), y1: y(p.poleBaseZ), x2: x(p.s), y2: y(p.lampLightZ),
        stroke: color, 'stroke-width': 1.4,
      }));
      g.appendChild(el('rect', {
        x: x(p.s) - 3, y: y(p.lampLightZ) - 2, width: 6, height: 4,
        fill: color, rx: 1,
      }));
      const t = el('text', {
        x: x(p.s), y: y(p.lampLightZ) - 5, 'text-anchor': 'middle', 'font-size': 8.5, fill: color,
      });
      t.textContent = `${(p.lampLightZ - p.poleBaseZ).toFixed(1)}m`;
      g.appendChild(t);
      g.addEventListener('click', () => {
        store.selectLamp(lamp.id);
        store.locate(lamp.x, lamp.y);
      });
      svg.appendChild(g);
    }

    // 台阶高差标注
    for (const step of state.project.steps) {
      const ring: Vec3[] = polygonRings(step.geometry)[0] ?? [];
      if (!ring.length) continue;
      const cx = ring.reduce((s, q) => s + q[0], 0) / ring.length;
      // 找最近里程
      let best = samples[0];
      let bd = Infinity;
      for (const p of samples) {
        const d = Math.abs(p.x - cx);
        if (d < bd) {
          bd = d;
          best = p;
        }
      }
      const dh = step.properties.topElev - step.properties.bottomElev;
      const t = el('text', {
        x: x(best.s), y: y(best.groundZ) + 14, 'text-anchor': 'middle', 'font-size': 8.5, fill: '#e0a85e',
      });
      t.textContent = `台阶Δ${dh.toFixed(1)}m`;
      svg.appendChild(t);
    }

    this.$('#meta')!.textContent =
      `${scheduleName(state.schedule)} · 全长 ${sMax.toFixed(1)}m · 高差 ${(zs[zs.length - 1] - zs[0]).toFixed(1)}m · ${state.project.lamps.length} 盏`;
  }
}
