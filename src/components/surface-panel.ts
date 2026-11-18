import { BasePanel } from './base';
import { store } from '../state/store';
import { ctx } from './context';
import type { ColorMode } from '../state/types';
import { modeLabel } from '../math/terrain';
import { rampCss } from '../math/color';

const MODES: { key: ColorMode; name: string }[] = [
  { key: 'elevation', name: '高程着色' },
  { key: 'slope', name: '坡度着色' },
  { key: 'curvature', name: '曲率着色' }
];

/** 曲面着色切换 + 栅格参数 + 图例 */
export class SurfacePanel extends BasePanel {
  constructor() {
    super('④ 河床地形曲面', 'surface');
  }

  protected mount(): void {
    this.bindStoreRerender();
  }

  render(): void {
    const s = store.get();
    const b = this.body();
    b.innerHTML = '';

    const modeRow = this.el('div', { class: 'row-flex' });
    MODES.forEach((m) => {
      const btn = this.el('button', {
        class: s.colorMode === m.key ? 'small' : 'small ghost'
      }, m.name);
      btn.addEventListener('click', () => {
        store.update({ colorMode: m.key });
        ctx.scene?.refreshTerrainColor(m.key);
        this.render();
      });
      modeRow.append(btn);
    });

    // 图例
    const legend = this.el('div', { style: 'display:flex;flex-direction:column;gap:4px' });
    const bar = this.el('div', {
      style: 'height:14px;border-radius:4px;border:1px solid #94a3b8;background:linear-gradient(90deg,' +
        [0, 0.25, 0.5, 0.75, 1].map((t) => rampCss(t)).join(',') + ')'
    });
    const grid = ctx.scene?.getGrid() ?? null;
    let rangeText = '需先导入高程点';
    if (grid) {
      if (s.colorMode === 'elevation') rangeText = `${grid.zMin.toFixed(2)} m ~ ${grid.zMax.toFixed(2)} m`;
      else if (s.colorMode === 'slope') rangeText = `0° ~ ${grid.slopeMaxDeg.toFixed(2)}°`;
      else rangeText = `0 ~ ${grid.curvatureMax.toFixed(5)} 1/m`;
    }
    legend.append(
      this.el('div', { class: 'muted', style: 'font-size:11px' }, modeLabel(s.colorMode)),
      bar,
      this.el('div', { style: 'display:flex;justify-content:space-between;font-size:11px' },
        this.el('span', { class: 'mono' }, rangeText.split('~')[0].trim()),
        this.el('span', { class: 'mono' }, rangeText.includes('~') ? rangeText.split('~')[1].trim() : '')
      )
    );

    // 栅格参数
    const res = this.el('input', { type: 'range', min: '4', max: '40', step: '1', value: String(s.terrain.resolution) }) as HTMLInputElement;
    const resVal = this.el('span', { class: 'value-pill' }, `${s.terrain.resolution} m`);
    res.addEventListener('change', () => {
      store.update({ terrain: { ...store.get().terrain, resolution: Number(res.value) } });
      resVal.textContent = `${res.value} m`;
      const g = ctx.rebuildTerrain();
      ctx.scene?.setTerrainGrid(g);
      ctx.scene?.refreshTerrainColor(store.get().colorMode);
      ctx.refreshScene();
    });
    res.addEventListener('input', () => (resVal.textContent = `${res.value} m`));

    const power = this.el('input', { type: 'range', min: '1', max: '4', step: '0.1', value: String(s.terrain.idwPower) }) as HTMLInputElement;
    const powerVal = this.el('span', { class: 'value-pill' }, s.terrain.idwPower.toFixed(1));
    power.addEventListener('change', () => {
      store.update({ terrain: { ...store.get().terrain, idwPower: Number(power.value) } });
      const g = ctx.rebuildTerrain();
      ctx.scene?.setTerrainGrid(g);
      ctx.scene?.refreshTerrainColor(store.get().colorMode);
      this.render();
    });
    power.addEventListener('input', () => (powerVal.textContent = Number(power.value).toFixed(1)));

    b.append(
      modeRow,
      legend,
      this.el('div', { class: 'sep' }),
      this.el('label', { class: 'row' },
        this.el('div', { class: 'range-row', style: 'width:100%' },
          document.createTextNode('栅格分辨率（调整后重建）'), res, resVal
        )
      ),
      this.el('label', { class: 'row' },
        this.el('div', { class: 'range-row', style: 'width:100%' },
          document.createTextNode('IDW 幂参数'), power, powerVal
        )
      ),
      this.el('button', {
        class: 'ghost small',
        onclick: (() => ctx.scene?.fitView()) as unknown as string
      }, '视图居中适配')
    );
  }
}
