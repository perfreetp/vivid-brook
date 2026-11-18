import { BasePanel } from './base';
import { store } from '../state/store';
import { ctx } from './context';
import { sampleSpline, splineLength } from '../math/spline';
import { sharedCss } from './styles';

/** 横断面面板：沿中心线里程拉任意横断面，绘制地形起伏剖面 */
export class SectionPanel extends BasePanel {
  constructor() {
    super('⑤ 横断面剖切', 'section');
  }

  protected mount(): void {
    this.bindStoreRerender();
  }

  render(): void {
    const s = store.get();
    const b = this.body();
    b.innerHTML = '';

    const samples = sampleSpline(s.lines.center.controlPoints, 24, s.curvature.smoothWindow);
    const len = splineLength(samples);

    const enable = this.el('input', { type: 'checkbox' }) as HTMLInputElement;
    enable.checked = s.section.visible;
    enable.addEventListener('change', () => {
      store.update({ section: { ...s.section, visible: enable.checked, station: s.section.station || 0 } });
      ctx.refreshScene();
      this.render();
    });

    if (len <= 0) {
      b.append(this.el('label', { class: 'row' }, enable, document.createTextNode('启用横断面（需先有中心线）')),
        this.el('div', { class: 'file-hint' }, '请先在数据导入中载入示例或在堤线面板编辑中心线。'));
      return;
    }

    const station = Math.min(s.section.station, len);
    const st = this.el('input', { type: 'range', min: '0', max: String(len), step: String(Math.max(1, len / 400)), value: String(station) }) as HTMLInputElement;
    const stVal = this.el('span', { class: 'value-pill' }, `${station.toFixed(1)} m`);
    st.addEventListener('input', () => {
      store.update({ section: { ...store.get().section, station: Number(st.value) } });
      stVal.textContent = `${Number(st.value).toFixed(1)} m`;
      ctx.refreshScene();
      const chart = this.root.querySelector('section-canvas') as SectionCanvas | null;
      chart?.draw();
    });

    const hw = this.el('input', { type: 'range', min: '20', max: '300', step: '5', value: String(s.section.halfWidth) }) as HTMLInputElement;
    const hwVal = this.el('span', { class: 'value-pill' }, `${s.section.halfWidth} m`);
    hw.addEventListener('input', () => {
      store.update({ section: { ...store.get().section, halfWidth: Number(hw.value) } });
      hwVal.textContent = `${hw.value} m`;
      ctx.refreshScene();
      const chart = this.root.querySelector('section-canvas') as SectionCanvas | null;
      chart?.draw();
    });

    b.append(
      this.el('label', { class: 'row' }, enable, document.createTextNode('启用横断面剖切')),
      this.el('label', { class: 'row' },
        this.el('div', { class: 'range-row', style: 'width:100%' },
          document.createTextNode('断面里程 K'), st, stVal
        )
      ),
      this.el('label', { class: 'row' },
        this.el('div', { class: 'range-row', style: 'width:100%' },
          document.createTextNode('断面半宽'), hw, hwVal
        )
      )
    );
    if (s.section.visible) b.append(document.createElement('section-canvas'));
  }
}

/** 横断面地形起伏剖面图 */
export class SectionCanvas extends HTMLElement {
  private root: ShadowRoot;
  private unsub: (() => void) | null = null;

  constructor() {
    super();
    this.root = this.attachShadow({ mode: 'open' });
    this.root.innerHTML = `
      <style>${sharedCss}
        canvas { width:100%; height:150px; border:1px solid #e2e8f0; border-radius:6px; background:#fcfdff; }
        .cap { font-size:11px; color:#475569; margin-top:2px; display:flex; justify-content:space-between; }
      </style>
      <canvas width="520" height="150"></canvas>
      <div class="cap"><span>横断面地形起伏（横向偏移 m →）</span><span class="mono" id="zr"></span></div>`;
  }

  connectedCallback(): void {
    this.unsub = store.subscribe(() => this.draw());
    this.draw();
  }
  disconnectedCallback(): void {
    this.unsub?.();
  }

  draw(): void {
    const cv = this.root.querySelector('canvas')!;
    const c2d = cv.getContext('2d')!;
    const W = cv.width;
    const H = cv.height;
    c2d.clearRect(0, 0, W, H);
    const profile = ctx.scene?.querySectionProfile() ?? [];
    if (profile.length < 2) {
      c2d.fillStyle = '#94a3b8';
      c2d.font = '12px sans-serif';
      c2d.fillText('断面位于地形范围外，暂无剖面数据', 16, H / 2);
      return;
    }
    const padL = 48;
    const padR = 14;
    const padT = 12;
    const padB = 24;
    const pw = W - padL - padR;
    const ph = H - padT - padB;
    const xMin = profile[0].offset;
    const xMax = profile[profile.length - 1].offset;
    let zMin = Infinity;
    let zMax = -Infinity;
    profile.forEach((p) => {
      zMin = Math.min(zMin, p.z);
      zMax = Math.max(zMax, p.z);
    });
    zMin -= 0.5;
    zMax += 0.5;
    const xOf = (x: number) => padL + ((x - xMin) / (xMax - xMin || 1)) * pw;
    const yOf = (z: number) => padT + ph - ((z - zMin) / (zMax - zMin || 1)) * ph;

    c2d.strokeStyle = '#e2e8f0';
    c2d.fillStyle = '#64748b';
    c2d.font = '10px Consolas';
    for (let g = 0; g <= 4; g++) {
      const y = padT + (ph * g) / 4;
      c2d.beginPath();
      c2d.moveTo(padL, y);
      c2d.lineTo(W - padR, y);
      c2d.stroke();
      c2d.fillText((zMax - ((zMax - zMin) * g) / 4).toFixed(1), 6, y + 3);
    }

    // 填充
    c2d.beginPath();
    profile.forEach((p, i) => {
      const x = xOf(p.offset);
      const y = yOf(p.z);
      i === 0 ? c2d.moveTo(x, y) : c2d.lineTo(x, y);
    });
    c2d.lineTo(xOf(xMax), padT + ph);
    c2d.lineTo(xOf(xMin), padT + ph);
    c2d.closePath();
    c2d.fillStyle = 'rgba(37,99,235,0.15)';
    c2d.fill();

    c2d.strokeStyle = '#1d4ed8';
    c2d.lineWidth = 2;
    c2d.beginPath();
    profile.forEach((p, i) => {
      const x = xOf(p.offset);
      const y = yOf(p.z);
      i === 0 ? c2d.moveTo(x, y) : c2d.lineTo(x, y);
    });
    c2d.stroke();

    c2d.fillStyle = '#64748b';
    c2d.fillText(`${xMin.toFixed(0)}`, padL - 8, H - 6);
    c2d.fillText(`${((xMin + xMax) / 2).toFixed(0)}`, W / 2 - 10, H - 6);
    c2d.fillText(`${xMax.toFixed(0)}`, W - padR - 24, H - 6);
    this.root.getElementById('zr')!.textContent = `高程 ${zMin.toFixed(2)} ~ ${zMax.toFixed(2)} m`;
  }
}
