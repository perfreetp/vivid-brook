import { select } from 'd3-selection';
import { zoom as d3zoom, zoomIdentity, type D3ZoomEvent } from 'd3-zoom';
import 'd3-transition';
import type { AppState } from '../lib/store';
import { store } from '../lib/store';
import { BaseElement } from '../lib/base';
import { bbox, deg2rad, polylineInfo } from '../lib/geometry';
import { beamProfile, cctToColor, maxThrowRadius, opticalAxis, sourcePosition } from '../lib/photometry';
import { DIM_THRESHOLD } from '../lib/engine';
import type { Lamp, Vec2, Vec3 } from '../types';
import { lineCoords, polygonRings } from '../types';
import { heatColor, makeProjection, pathFromLine, pathFromRing, type ViewTransform } from './projection';

const ZOOM_KEY = 'trail-lighting-zoom-v1';

export class MapView extends BaseElement {
  private svg!: SVGSVGElement;
  private rootG!: SVGGElement;
  private width = 900;
  private height = 700;
  private transform: ViewTransform = { k: 1, tx: 0, ty: 0 };
  private resizeObs: ResizeObserver | null = null;
  private lastToken = -1;
  private dragging = false;

  template(): string {
    return `
      <style>
        :host { display:block; position:relative; height:100%; background:#0c1118; }
        svg { width:100%; height:100%; display:block; touch-action:none; }
        .legend {
          position:absolute; left:12px; bottom:12px; background:rgba(15,20,27,.88);
          border:1px solid var(--line); border-radius:8px; padding:8px 10px; font-size:11px;
        }
        .legend .bar { width:180px; height:10px; border-radius:5px;
          background:linear-gradient(90deg,#1b2a4a,#1f4e79,#2e7d8c,#3fa66a,#a8c14a,#e8b339,#e0642f,#b8323f); }
        .legend .row { display:flex; justify-content:space-between; color:var(--muted); margin-top:2px; }
        .hud { position:absolute; right:12px; top:12px; display:flex; gap:6px; }
        .cursor-tip { position:absolute; pointer-events:none; background:rgba(15,20,27,.92);
          border:1px solid var(--line); border-radius:6px; padding:4px 8px; font-size:11px;
          display:none; }
        .busy { position:absolute; left:50%; top:14px; transform:translateX(-50%);
          background:rgba(77,163,255,.15); border:1px solid var(--accent); color:var(--accent);
          padding:3px 12px; border-radius:12px; font-size:12px; display:none; }
      </style>
      <svg></svg>
      <div class="busy" id="busy">照度重算中…</div>
      <div class="hud">
        <button id="zoom-in" title="放大">＋</button>
        <button id="zoom-out" title="缩小">－</button>
        <button id="zoom-reset" title="复位">复位</button>
      </div>
      <div class="legend">
        <div>水平面照度（lx）</div>
        <div class="bar"></div>
        <div class="row"><span>0.5</span><span>5</span><span>20</span><span>80+</span></div>
      </div>
      <div class="cursor-tip" id="tip"></div>
    `;
  }

  private get projection() {
    const b = this.worldBounds();
    return makeProjection(this.width, this.height, b);
  }

  private worldBounds() {
    const { project } = store.get();
    // 视野以步道中线为主，周边要素即使超出也能通过缩放查看，避免画面被远处树冠/建筑撑空
    const pts: Vec2[] = lineCoords(project.centerline.geometry).map((p) => [p[0], p[1]] as Vec2);
    const b = bbox(pts);
    return { minX: b.minX - 10, minY: b.minY - 10, maxX: b.maxX + 10, maxY: b.maxY + 10 };
  }

  mount(): void {
    this.svg = this.$('svg') as unknown as SVGSVGElement;
    this.rootG = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    this.rootG.setAttribute('class', 'world');
    this.svg.appendChild(this.rootG);

    const sel = select(this.svg);
    const zoom = d3zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.4, 8])
      .on('zoom', (event: D3ZoomEvent<SVGSVGElement, unknown>) => {
        this.transform = { k: event.transform.k, tx: event.transform.x, ty: event.transform.y };
        this.rootG.setAttribute('transform', `translate(${event.transform.x},${event.transform.y}) scale(${event.transform.k})`);
        try {
          localStorage.setItem(ZOOM_KEY, JSON.stringify(this.transform));
        } catch { /* ignore */ }
      });
    sel.call(zoom);
    this.$('#zoom-in')!.addEventListener('click', () => sel.transition().duration(180).call(zoom.scaleBy, 1.4));
    this.$('#zoom-out')!.addEventListener('click', () => sel.transition().duration(180).call(zoom.scaleBy, 1 / 1.4));
    this.$('#zoom-reset')!.addEventListener('click', () => {
      sel.transition().duration(220).call(zoom.transform, zoomIdentity);
    });
    try {
      const saved = localStorage.getItem(ZOOM_KEY);
      if (saved) {
        const t = JSON.parse(saved) as ViewTransform;
        sel.call(zoom.transform, zoomIdentity.translate(t.tx, t.ty).scale(t.k));
      }
    } catch { /* ignore */ }

    // 双击空白处加灯
    this.svg.addEventListener('dblclick', (ev) => {
      const [wx, wy] = this.toWorld(ev);
      store.addLamp(wx, wy);
    });

    this.resizeObs = new ResizeObserver(() => this.resize());
    this.resizeObs.observe(this);
    requestAnimationFrame(() => this.resize());
  }

  private resize(): void {
    const rect = this.getBoundingClientRect();
    if (rect.width < 10) return;
    this.width = rect.width;
    this.height = rect.height;
    this.svg.setAttribute('viewBox', `0 0 ${this.width} ${this.height}`);
    this.draw(store.get());
  }

  private toWorld(ev: MouseEvent | PointerEvent): Vec2 {
    const pt = this.svg.createSVGPoint();
    pt.x = ev.clientX;
    pt.y = ev.clientY;
    const ctm = this.rootG.getScreenCTM();
    const w = ctm ? pt.matrixTransform(ctm.inverse()) : pt;
    return [w.x, w.y];
  }

  onState(state: AppState): void {
    this.$('#busy')!.style.display = state.busy ? 'block' : 'none';
    if (state.locateToken !== this.lastToken && state.locateAt) {
      this.lastToken = state.locateToken;
      this.centerOn(state.locateAt.x, state.locateAt.y);
    }
    this.draw(state);
  }

  private centerOn(x: number, y: number): void {
    const p = this.projection;
    const [sx, sy] = p.project(x, y);
    const sel = select(this.svg);
    const zoom = d3zoom<SVGSVGElement, unknown>().scaleExtent([0.4, 8]);
    sel.transition().duration(300).call(
      zoom.transform,
      zoomIdentity.translate(this.width / 2 - sx * 1.6, this.height / 2 - sy * 1.6).scale(1.6),
    );
  }

  private draw(state: AppState): void {
    if (this.width < 10) return;
    const { project, layers, result } = state;
    const p = this.projection;
    const proj = p.project;
    const NS = 'http://www.w3.org/2000/svg';
    const el = (name: string, attrs: Record<string, string | number>): SVGElement => {
      const e = document.createElementNS(NS, name);
      for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
      return e;
    };
    this.rootG.innerHTML = '';

    // ---- 背景网格（1m） ----
    const b = this.worldBounds();
    const gridG = el('g', { class: 'grid' });
    for (let x = Math.ceil(b.minX); x <= b.maxX; x++) {
      gridG.appendChild(el('line', {
        x1: proj(x, b.minY)[0], y1: proj(x, b.minY)[1],
        x2: proj(x, b.maxY)[0], y2: proj(x, b.maxY)[1],
        stroke: '#182230', 'stroke-width': 0.5 / p.scale,
      }));
    }
    for (let y = Math.ceil(b.minY); y <= b.maxY; y++) {
      gridG.appendChild(el('line', {
        x1: proj(b.minX, y)[0], y1: proj(b.minX, y)[1],
        x2: proj(b.maxX, y)[0], y2: proj(b.maxX, y)[1],
        stroke: '#182230', 'stroke-width': 0.5 / p.scale,
      }));
    }
    this.rootG.appendChild(gridG);

    // ---- 热力栅格 ----
    if (layers.heat && result) {
      const heatG = el('g', {});
      const g = result.grid;
      const cell = p.scale;
      for (let i = 0; i < g.cells.length; i++) {
        if (!g.onTrail[i] && g.values[i] < 0.05) continue;
        const c = g.cells[i];
        const [sx, sy] = proj(c.x - 0.5, c.y - 0.5);
        heatG.appendChild(el('rect', {
          x: sx, y: sy, width: cell, height: cell,
          fill: heatColor(g.values[i]),
          'fill-opacity': g.onTrail[i] ? 0.78 : 0.25,
          stroke: 'none',
        }));
      }
      this.rootG.appendChild(heatG);
    }

    // ---- 等值线 ----
    if (layers.contours && result) {
      const cg = el('g', {});
      for (const c of result.contours) {
        for (const polygon of c.rings) {
          cg.appendChild(el('path', {
            d: polygon.map((ring) => pathFromRing(proj, ring)).join(' '),
            fill: 'none',
            stroke: 'rgba(255,255,255,.28)',
            'stroke-width': 0.6 / p.scale,
            'stroke-dasharray': `${2 / p.scale},${1.5 / p.scale}`,
          }));
          const labelAt = polygon[0][0];
          if (labelAt) {
            const [lx, ly] = proj(labelAt[0], labelAt[1]);
            const t = el('text', {
              x: lx, y: ly, fill: 'rgba(255,255,255,.55)',
              'font-size': 9 / p.scale,
            });
            t.textContent = `${c.threshold}lx`;
            cg.appendChild(t);
          }
        }
      }
      this.rootG.appendChild(cg);
    }

    // ---- 要素分层（树冠 → 建筑 → 挡墙 → 台阶） ----
    const drawPoly = (
      rings: Vec3[][],
      fill: string,
      stroke: string,
      opacity: number,
      label?: string,
    ) => {
      const g = el('g', {});
      for (const ring of rings) {
        g.appendChild(el('path', {
          d: pathFromRing(proj, ring.map((q) => [q[0], q[1]] as Vec2)),
          fill, stroke, 'fill-opacity': opacity, 'stroke-width': 1.2 / p.scale,
        }));
      }
      if (label) {
        const c = ringCenter(rings[0] ?? []);
        const [tx, ty] = proj(c[0], c[1]);
        const t = el('text', { x: tx, y: ty, 'font-size': 10 / p.scale, fill: '#8fa0b3', 'text-anchor': 'middle' });
        t.textContent = label;
        g.appendChild(t);
      }
      this.rootG.appendChild(g);
    };

    if (layers.canopies) {
      for (const f of project.canopies) {
        drawPoly(polygonRings(f.geometry), '#2f7d4f', '#57c98d', 0.28, f.properties.name);
      }
    }
    if (layers.buildings) {
      for (const f of project.buildings) {
        drawPoly(polygonRings(f.geometry), '#5a6472', '#aeb9c6', 0.55, f.properties.name);
      }
    }
    if (layers.walls) {
      for (const f of project.walls) {
        drawPoly(polygonRings(f.geometry), '#7a5c33', '#e0a85e', 0.55, f.properties.name);
      }
    }
    if (layers.steps) {
      for (const f of project.steps) {
        drawPoly(polygonRings(f.geometry), '#3b4a5e', '#7fb0e8', 0.45, f.properties.name);
      }
    }

    // ---- 步道中线 ----
    const line = lineCoords(project.centerline.geometry);
    const lineG = el('g', {});
    lineG.appendChild(el('path', {
      d: pathFromLine(proj, line.map((q) => [q[0], q[1]] as Vec2)),
      fill: 'none', stroke: '#cfe3ff', 'stroke-width': 2.2 / p.scale,
      'stroke-dasharray': `${4 / p.scale},${3 / p.scale}`,
    }));
    // 桩号刻度
    const info = polylineInfo(line);
    for (let s = 0; s <= info.total; s += 10) {
      const t = info.total === 0 ? 0 : s / info.total;
      const pt = interpAt(line, t);
      const [sx, sy] = proj(pt[0], pt[1]);
      const tick = el('circle', { cx: sx, cy: sy, r: 1.6 / p.scale, fill: '#cfe3ff' });
      lineG.appendChild(tick);
      const label = el('text', { x: sx, y: sy - 4 / p.scale, 'font-size': 8.5 / p.scale, fill: '#7f93aa', 'text-anchor': 'middle' });
      label.textContent = `${s}m`;
      lineG.appendChild(label);
    }
    this.rootG.appendChild(lineG);

    // ---- 低照度区描红（marching squares 真实等值面，置于热力之上） ----
    if (layers.dimZones && result) {
      const dg = el('g', {});
      for (const z of result.dimZones) {
        for (const polygon of z.rings) {
          for (const ring of polygon) {
            dg.appendChild(el('path', {
              d: pathFromRing(proj, ring),
              fill: 'rgba(255,93,93,.16)',
              stroke: '#ff3b3b',
              'stroke-width': 2.2 / p.scale,
              'stroke-linejoin': 'round',
            }));
          }
        }
        const [cx, cy] = proj(z.centroid[0], z.centroid[1]);
        const t = el('text', {
          x: cx, y: cy, fill: '#ffb0b0', 'font-size': 10.5 / p.scale,
          'text-anchor': 'middle', 'paint-order': 'stroke',
          stroke: '#0c1118', 'stroke-width': 2.4 / p.scale,
        });
        t.textContent = `低于${DIM_THRESHOLD}lx ${z.areaM2}㎡`;
        dg.appendChild(t);
      }
      this.rootG.appendChild(dg);
    }

    // ---- 光斑（每灯有效照射范围）与灯具 ----
    if (layers.lamps) {
      const lampG = el('g', {});
      for (const lamp of project.lamps) {
        const model = project.lampModels.find((m) => m.id === lamp.modelId);
        if (!model) continue;
        const on = lamp.schedule[state.schedule];
        const src = sourcePosition(lamp, project);
        const [hx, hy] = proj(lamp.x, lamp.y);
        const color = cctToColor(lamp.cct);

        // 光斑包络
        if (on) {
          const radius = maxThrowRadius(lamp, src.z, lamp.groundZ, model);
          lampG.appendChild(el('circle', {
            cx: hx, cy: hy, r: radius * p.scale,
            fill: color, 'fill-opacity': 0.10,
            stroke: color, 'stroke-opacity': 0.45, 'stroke-width': 1 / p.scale,
            'stroke-dasharray': `${3 / p.scale},${2 / p.scale}`,
          }));
          if (layers.aim && lamp.aimAzimuth !== null) {
            lampG.appendChild(this.aimPath(lamp, src, p.scale, el, color));
          }
        }

        // 灯位
        const g = el('g', { class: 'lamp', 'data-id': lamp.id, cursor: 'move' });
        const selected = state.selectedLampId === lamp.id;
        g.appendChild(el('circle', {
          cx: hx, cy: hy,
          r: (selected ? 7 : 5.5) / p.scale,
          fill: on ? color : '#55606e',
          stroke: selected ? '#fff' : '#0c1118',
          'stroke-width': (selected ? 2 : 1.2) / p.scale,
        }));
        g.appendChild(el('circle', {
          cx: hx, cy: hy, r: 9 / p.scale, fill: 'none',
          stroke: on ? color : '#55606e', 'stroke-opacity': 0.35, 'stroke-width': 0.8 / p.scale,
        }));
        const label = el('text', {
          x: hx + 8 / p.scale, y: hy - 6 / p.scale,
          'font-size': 9.5 / p.scale, fill: on ? '#e8f1ff' : '#778392',
        });
        label.textContent = lamp.id.replace('lamp-', 'L');
        g.appendChild(label);

        g.addEventListener('pointerdown', (ev) => this.startDrag(ev, lamp.id));
        g.addEventListener('click', (ev) => {
          ev.stopPropagation();
          store.selectLamp(state.selectedLampId === lamp.id ? null : lamp.id);
        });
        lampG.appendChild(g);
      }
      this.rootG.appendChild(lampG);
    }

    // 空白点击取消选中
    this.rootG.onclick = (ev) => {
      if ((ev.target as Element).classList?.contains('lamp')) return;
      if (!this.dragging) store.selectLamp(null);
    };
  }

  private aimPath(
    lamp: Lamp,
    src: { x: number; y: number; z: number },
    scale: number,
    el: (n: string, a: Record<string, string | number>) => SVGElement,
    color: string,
  ): SVGElement {
    const axis = opticalAxis(lamp);
    const profile = beamProfile(lamp);
    const h = src.z - lamp.groundZ;
    // 光轴与地面交点（近似平面地面）
    const tGround = h / Math.max(0.05, -axis.dz);
    const gx = lamp.x + axis.dx * tGround;
    const gy = lamp.y + axis.dy * tGround;
    const [ax, ay] = this.projection.project(lamp.x, lamp.y);
    const [bx, by] = this.projection.project(gx, gy);
    const g = el('g', {});
    g.appendChild(el('line', {
      x1: ax, y1: ay, x2: bx, y2: by,
      stroke: color, 'stroke-width': 1.2 / scale, 'stroke-dasharray': `${2.5 / scale},${2 / scale}`,
    }));
    // 光束边缘两条
    const az = deg2rad(lamp.aimAzimuth ?? 0);
    const half = profile.halfBeam;
    for (const sign of [-1, 1]) {
      const edgeAz = az + sign * half;
      const edgeTilt = deg2rad(lamp.aimTilt);
      const ex = Math.cos(edgeTilt) * Math.cos(edgeAz);
      const ey = Math.cos(edgeTilt) * Math.sin(edgeAz);
      const ez = -Math.sin(edgeTilt);
      if (ez >= -0.02) continue;
      const tt = h / -ez;
      const [ex2, ey2] = this.projection.project(lamp.x + ex * tt, lamp.y + ey * tt);
      g.appendChild(el('line', {
        x1: ax, y1: ay, x2: ex2, y2: ey2,
        stroke: color, 'stroke-opacity': 0.4, 'stroke-width': 0.8 / scale,
      }));
    }
    return g;
  }

  private startDrag(ev: PointerEvent, id: string): void {
    ev.stopPropagation();
    this.dragging = true;
    const move = (mev: PointerEvent) => {
      const [wx, wy] = this.toWorld(mev);
      store.placeLamp(id, wx, wy);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setTimeout(() => (this.dragging = false), 0);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }
}

function ringCenter(ring: Vec3[]): Vec2 {
  let x = 0;
  let y = 0;
  for (const p of ring) {
    x += p[0];
    y += p[1];
  }
  return [x / ring.length, y / ring.length];
}

function interpAt(line: Vec3[], t: number): Vec2 {
  const seg = t * (line.length - 1);
  const i = Math.min(line.length - 2, Math.floor(seg));
  const u = seg - i;
  return [
    line[i][0] + (line[i + 1][0] - line[i][0]) * u,
    line[i][1] + (line[i + 1][1] - line[i][1]) * u,
  ];
}
