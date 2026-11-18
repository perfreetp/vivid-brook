import { BasePanel } from './base';
import { store } from '../state/store';
import { ctx } from './context';
import { sampleSpline, splineLength } from '../math/spline';
import { buildEmbankmentStrip, flattenStrip, unfoldedContours } from '../math/unfold';
import type { UnfoldResult } from '../state/types';
import { sharedCss } from './styles';

/** 堤坡测地线展开：选侧别与里程区间，输出平面成果图、展开面积、坡长 */
export class UnfoldPanel extends BasePanel {
  constructor() {
    super('⑥ 堤坡测地线展开成果', 'unfold');
  }

  protected mount(): void {
    this.bindStoreRerender();
  }

  render(): void {
    const s = store.get();
    const b = this.body();
    b.innerHTML = '';

    const req = s.unfold ?? { side: 'left' as const, stationStart: 0, stationEnd: 0 };
    const side = req.side ?? 'left';
    const crestKey = side === 'left' ? 'leftCrest' : 'rightCrest';
    const crestSamples = sampleSpline(s.lines[crestKey].controlPoints, 24, s.curvature.smoothWindow);
    const len = splineLength(crestSamples);
    if (len <= 0) {
      b.append(this.el('div', { class: 'file-hint' }, '堤顶线控制点不足，无法展开堤坡。'));
      return;
    }
    const start = req.stationStart || 0;
    const end = req.stationEnd || len;

    const sideSel = this.el('select') as HTMLSelectElement;
    sideSel.append(new Option('左堤坡', 'left'), new Option('右堤坡', 'right'));
    sideSel.value = side;
    sideSel.addEventListener('change', () => {
      store.update({ unfold: { ...req, side: sideSel.value as 'left' | 'right', stationEnd: splineLength(sampleSpline(store.get().lines[sideSel.value === 'left' ? 'leftCrest' : 'rightCrest'].controlPoints, 24)) } });
      this.render();
    });

    const r1 = this.el('input', { type: 'range', min: '0', max: String(len), step: String(len / 200), value: String(start) }) as HTMLInputElement;
    const r1v = this.el('span', { class: 'value-pill' }, `${start.toFixed(1)}`);
    r1.addEventListener('input', () => {
      const v = Math.min(Number(r1.value), Number(r2.value));
      store.update({ unfold: { ...store.get().unfold!, stationStart: v } });
      r1v.textContent = v.toFixed(1);
    });
    const r2 = this.el('input', { type: 'range', min: '0', max: String(len), step: String(len / 200), value: String(end) }) as HTMLInputElement;
    const r2v = this.el('span', { class: 'value-pill' }, `${end.toFixed(1)}`);
    r2.addEventListener('input', () => {
      const v = Math.max(Number(r2.value), Number(r1.value));
      store.update({ unfold: { ...store.get().unfold!, stationEnd: v } });
      r2v.textContent = v.toFixed(1);
    });

    const runBtn = this.el('button', {}, '展开选中堤坡（测地线保距）');
    runBtn.addEventListener('click', () => ctx.runUnfold());

    b.append(
      this.el('label', {}, '堤坡侧别', sideSel),
      this.el('label', { class: 'row' }, this.el('div', { class: 'range-row', style: 'width:100%' },
        document.createTextNode('起始里程'), r1, r1v)),
      this.el('label', { class: 'row' }, this.el('div', { class: 'range-row', style: 'width:100%' },
        document.createTextNode('终止里程'), r2, r2v)),
      runBtn,
      this.el('div', { class: 'file-hint' },
        '展开以堤顶线为基准，将三维三角条带按实长逐排铺到平面（边长不变 ⇒ 展开面积即坡面实测面积）。')
    );

    if (s.unfoldResults.length) {
      const list = this.el('div', { class: 'scroll' });
      const table = this.el('table');
      table.innerHTML = `<tr><th>侧别</th><th>里程区间(m)</th><th>展开面积(m²)</th><th>坡长(m)</th><th>操作</th></tr>`;
      s.unfoldResults.slice().reverse().forEach((u) => {
        const tr = document.createElement('tr');
        tr.innerHTML = `<td>${u.side === 'left' ? '左' : '右'}</td>
          <td class="mono">${u.stationStart.toFixed(0)}~${u.stationEnd.toFixed(0)}</td>
          <td class="mono">${u.area.toFixed(1)}</td>
          <td class="mono">${u.slopeLength.toFixed(2)}</td><td></td>`;
        const viewBtn = this.el('button', { class: 'small ghost' }, '查看成果图');
        viewBtn.addEventListener('click', () => {
          ctx.scene?.showUnfoldOverlay(u);
          (this.root.querySelector('unfold-drawing') as UnfoldDrawing | null)?.setResult(u);
        });
        tr.lastElementChild!.append(viewBtn);
        table.append(tr);
      });
      list.append(table);
      const latest = s.unfoldResults[s.unfoldResults.length - 1];
      b.append(list, document.createElement('unfold-drawing'));
      requestAnimationFrame(() => {
        (this.root.querySelector('unfold-drawing') as UnfoldDrawing | null)?.setResult(latest);
      });
    }
  }
}

/** 展开平面成果图：轮廓、尺寸标注、等高程线、面积与坡长注记 */
export class UnfoldDrawing extends HTMLElement {
  private root: ShadowRoot;
  private result: UnfoldResult | null = null;

  constructor() {
    super();
    this.root = this.attachShadow({ mode: 'open' });
    this.root.innerHTML = `
      <style>${sharedCss}
        .title { font-weight:600; margin:4px 0; color:#1e3a8a; }
        canvas { width:100%; height:260px; border:1px solid #94a3b8; border-radius:6px; background:#fff; }
        .meta { display:flex; gap:10px; flex-wrap:wrap; margin-top:4px; }
      </style>
      <div class="title">堤坡展开平面成果图</div>
      <canvas width="560" height="260"></canvas>
      <div class="meta" id="meta"></div>`;
  }

  setResult(r: UnfoldResult): void {
    this.result = r;
    this.draw();
  }

  private draw(): void {
    const r = this.result;
    const cv = this.root.querySelector('canvas')!;
    const c = cv.getContext('2d')!;
    const W = cv.width;
    const H = cv.height;
    c.clearRect(0, 0, W, H);
    if (!r) {
      c.fillStyle = '#94a3b8';
      c.font = '12px sans-serif';
      c.fillText('点击“展开选中堤坡”生成成果图', 20, H / 2);
      return;
    }

    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    r.outline.forEach((p) => {
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y);
      maxY = Math.max(maxY, p.y);
    });
    const pad = 42;
    const sx = (W - pad * 2) / (maxX - minX || 1);
    const sy = (H - pad * 2) / (maxY - minY || 1);
    const sc = Math.min(sx, sy);
    const ox = pad - minX * sc;
    const oy = pad - minY * sc;
    const P = (p: { x: number; y: number }) => ({ x: p.x * sc + ox, y: p.y * sc + oy });

    // 等高程线
    c.strokeStyle = '#0891b2';
    c.lineWidth = 1;
    c.setLineDash([4, 3]);
    r.contours.forEach((cvLine) => {
      cvLine.paths.forEach((path) => {
        c.beginPath();
        path.forEach((p, i) => {
          const q = P(p);
          i === 0 ? c.moveTo(q.x, q.y) : c.lineTo(q.x, q.y);
        });
        c.stroke();
      });
    });
    c.setLineDash([]);

    // 轮廓填充与描边
    c.beginPath();
    r.outline.forEach((p, i) => {
      const q = P(p);
      i === 0 ? c.moveTo(q.x, q.y) : c.lineTo(q.x, q.y);
    });
    c.closePath();
    c.fillStyle = 'rgba(245,158,11,0.16)';
    c.fill();
    c.strokeStyle = '#9a3412';
    c.lineWidth = 2;
    c.stroke();

    // 尺寸标注：堤顶长、坡长
    c.strokeStyle = '#334155';
    c.fillStyle = '#334155';
    c.lineWidth = 1;
    c.font = '11px Consolas';
    const crestA = P(r.outline[0]);
    const crestB = P({ x: r.crestLength, y: 0 });
    c.beginPath();
    c.moveTo(crestA.x, crestA.y - 16);
    c.lineTo(crestB.x, crestB.y - 16);
    c.stroke();
    c.fillText(`堤顶长 ${r.crestLength.toFixed(1)} m`, (crestA.x + crestB.x) / 2 - 48, crestA.y - 20);
    c.fillText(`坡长(均) ${r.slopeLength.toFixed(2)} m`, crestA.x + 6, (crestA.y + P({ x: 0, y: r.slopeLength }).y) / 2);

    // 图签
    c.font = 'bold 12px sans-serif';
    c.fillStyle = '#1e3a8a';
    c.fillText(
      `${r.side === 'left' ? '左' : '右'}堤坡  K${r.stationStart.toFixed(0)}~K${r.stationEnd.toFixed(0)}`,
      pad,
      18
    );
    c.font = '11px sans-serif';
    c.fillStyle = '#0891b2';
    c.fillText('虚线：等高程线', W - 110, 18);

    this.root.getElementById('meta')!.innerHTML = `
      <span class="tag green">展开面积 ${r.area.toFixed(2)} m²</span>
      <span class="tag">平均坡长 ${r.slopeLength.toFixed(2)} m</span>
      <span class="tag">堤顶长 ${r.crestLength.toFixed(2)} m</span>
      <span class="tag">坡脚长 ${r.toeLength.toFixed(2)} m</span>`;
  }
}
