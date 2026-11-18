import { BasePanel } from './base';
import { store } from '../state/store';
import type { LineKey } from '../state/types';
import { sampleSpline, splineLength } from '../math/spline';
import { ctx } from './context';

const LINE_OPTIONS: { key: LineKey; name: string }[] = [
  { key: 'center', name: '河道中心线' },
  { key: 'leftCrest', name: '左堤顶线' },
  { key: 'rightCrest', name: '右堤顶线' }
];

/** 堤线样条控制面板：选线、控制点增删、撤销重做、曲率阈值 */
export class LinePanel extends BasePanel {
  constructor() {
    super('② 堤线 / 中心线样条编辑', 'line');
  }

  protected mount(): void {
    this.bindStoreRerender();
  }

  render(): void {
    const s = store.get();
    const b = this.body();
    b.innerHTML = '';

    const select = this.el('select', {
      onchange: ((e: Event) => {
        store.update({ activeLine: (e.target as HTMLSelectElement).value as LineKey });
        ctx_refresh();
      }) as unknown as string
    });
    LINE_OPTIONS.forEach((o) => {
      const opt = this.el('option', { value: o.key }, o.name);
      if (o.key === s.activeLine) opt.setAttribute('selected', 'true');
      select.append(opt);
    });

    const active = s.lines[s.activeLine];
    const samples = sampleSpline(active.controlPoints, 24, s.curvature.smoothWindow);
    const len = splineLength(samples);
    const hotspots = samples.filter((q) => q.curvature >= s.curvature.threshold).length;
    const minRadius = samples.reduce((m, q) => (isFinite(q.radius) ? Math.min(m, q.radius) : m), Infinity);

    b.append(
      this.el('label', {}, '当前编辑线', select),
      this.el('div', { class: 'row-flex' },
        this.el('button', {
          class: 'small',
          onclick: (() => {
            const last = active.controlPoints[active.controlPoints.length - 1];
            if (last) store.addControlPoint(s.activeLine, { x: last.x + 60, y: last.y + 40 });
          }) as unknown as string
        }, '末尾加点'),
        this.el('button', {
          class: 'small ghost',
          onclick: (() => {
            const line = s.lines[s.activeLine];
            if (line.controlPoints.length > 2) store.removeControlPoint(s.activeLine, line.controlPoints.length - 1);
          }) as unknown as string
        }, '删除末点'),
        this.el('button', {
          class: 'small ghost',
          onclick: (() => store.undo()) as unknown as string,
        }, '撤销'),
        this.el('button', {
          class: 'small ghost',
          onclick: (() => store.redo()) as unknown as string
        }, '重做')
      ),
      this.el('div', { class: 'file-hint' },
        '交互：拖动黄色球移动控制点；在样条附近双击插入控制点；选中控制点后按 Delete 删除（至少保留 2 点）。'
      ),
      this.el('div', { class: 'sep' }),
      this.el('div', { class: 'row-flex' },
        this.el('span', { class: 'tag' }, `控制点 ${active.controlPoints.length}`),
        this.el('span', { class: 'tag' }, `线长 ${len.toFixed(1)} m`),
        this.el('span', { class: hotspots > 0 ? 'tag red' : 'tag green' }, `突变采样 ${hotspots}`),
        this.el('span', { class: 'tag warn' }, `最小曲率半径 ${isFinite(minRadius) ? minRadius.toFixed(1) + ' m' : '∞'}`)
      )
    );

    // 曲率阈值
    const th = this.el('input', { type: 'range', min: '0.0005', max: '0.02', step: '0.0005', value: String(s.curvature.threshold) }) as HTMLInputElement;
    const thVal = this.el('span', { class: 'value-pill' }, s.curvature.threshold.toFixed(4));
    th.addEventListener('input', () => {
      store.update({ curvature: { ...s.curvature, threshold: Number(th.value) } });
      thVal.textContent = Number(th.value).toFixed(4);
      ctx_refresh();
    });
    const sw = this.el('input', { type: 'range', min: '1', max: '15', step: '2', value: String(s.curvature.smoothWindow) }) as HTMLInputElement;
    const swVal = this.el('span', { class: 'value-pill' }, String(s.curvature.smoothWindow));
    sw.addEventListener('input', () => {
      store.update({ curvature: { ...s.curvature, smoothWindow: Number(sw.value) } });
      swVal.textContent = sw.value;
      ctx_refresh();
    });
    b.append(
      this.el('label', { class: 'row' },
        this.el('div', { class: 'range-row', style: 'width:100%' },
          document.createTextNode('曲率突变阈值 (1/m)'), th, thVal
        )
      ),
      this.el('label', { class: 'row' },
        this.el('div', { class: 'range-row', style: 'width:100%' },
          document.createTextNode('曲率平滑窗口'), sw, swVal
        )
      ),
      this.el('div', { class: 'sep' }),
      document.createElement('curvature-chart')
    );
  }
}

function ctx_refresh(): void {
  requestAnimationFrame(() => ctx.refreshScene());
}
