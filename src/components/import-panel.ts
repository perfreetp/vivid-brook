import { BasePanel } from './base';
import { store } from '../state/store';
import { parseBoundaryCsv, parseElevationCsv, readFileText } from '../data/csv';
import { generateSampleReach } from '../data/sample';
import { ctx } from './context';
import type { LineKey } from '../state/types';

/** 数据导入面板：断面高程点 CSV、河道边界 CSV、内置示例河段 */
export class ImportPanel extends BasePanel {
  constructor() {
    super('① 数据导入 / 项目信息', 'import');
  }

  protected mount(): void {
    this.bindStoreRerender();
  }

  render(): void {
    const s = store.get();
    const b = this.body();
    b.innerHTML = '';

    const grid = this.el('div', { class: 'grid2' });
    grid.append(
      this.el('label', {}, '项目编号', this.el('input', { type: 'text', value: s.projectCode, placeholder: '建档后自动生成', disabled: 'true' })),
      this.el('label', {}, '项目名称', this.el('input', {
        type: 'text', value: s.projectName,
        oninput: ((e: Event) => store.update({ projectName: (e.target as HTMLInputElement).value })) as unknown as string
      })),
      this.el('label', {}, '河流名称', this.el('input', {
        type: 'text', value: s.river,
        oninput: ((e: Event) => store.update({ river: (e.target as HTMLInputElement).value })) as unknown as string
      })),
      this.el('label', {}, '河段', this.el('input', {
        type: 'text', value: s.reach,
        oninput: ((e: Event) => store.update({ reach: (e.target as HTMLInputElement).value })) as unknown as string
      }))
    );
    b.append(grid);

    // 高程点导入
    const elevInput = this.el('input', { type: 'file', accept: '.csv,.txt', style: 'display:none' }) as HTMLInputElement;
    elevInput.addEventListener('change', async () => {
      const f = elevInput.files?.[0];
      if (!f) return;
      const text = await readFileText(f);
      const points = parseElevationCsv(text);
      if (points.length === 0) {
        alert('未解析到有效的 x,y,z 高程点，请检查 CSV 格式');
        return;
      }
      store.update({ points });
      ctx.rebuildTerrain();
      ctx.scene?.showPointCloud();
      this.render();
    });
    const bndInput = this.el('input', { type: 'file', accept: '.csv,.txt', style: 'display:none' }) as HTMLInputElement;
    bndInput.addEventListener('change', async () => {
      const f = bndInput.files?.[0];
      if (!f) return;
      const text = await readFileText(f);
      const boundaries = parseBoundaryCsv(text);
      if (boundaries.length === 0) {
        alert('未解析到有效的边界折线，请检查 CSV 格式');
        return;
      }
      store.update({ boundaries });
      ctx.rebuildTerrain();
      ctx.scene?.showBoundaries();
      this.render();
    });

    b.append(
      this.el('div', { class: 'row-flex' },
        this.el('button', {
          onclick: (() => elevInput.click()) as unknown as string
        }, '导入断面高程点 CSV'),
        this.el('button', {
          class: 'ghost',
          onclick: (() => bndInput.click()) as unknown as string
        }, '导入河道边界 CSV'),
        elevInput, bndInput
      ),
      this.el('div', { class: 'file-hint' },
        '高程点格式：每行 x,y,z（米），允许带表头/点号列；',
        this.el('br'),
        '边界格式：每行 名称,x,y 或 x,y，多组名称自动分组。',
        this.el('br'),
        this.el('a', { href: 'samples/断面高程点.csv', download: '断面高程点.csv', style: 'color:#1d4ed8' }, '下载高程点样例 CSV'),
        document.createTextNode('　'),
        this.el('a', { href: 'samples/河道边界.csv', download: '河道边界.csv', style: 'color:#1d4ed8' }, '下载边界样例 CSV')
      ),
      this.el('button', {
        onclick: (() => this.loadSample()) as unknown as string
      }, '载入示例河段（2.4km 蜿蜒河道，含高程点/边界/堤线）'),
      this.el('div', { class: 'sep' }),
      this.el('div', { class: 'row-flex' },
        this.el('span', { class: 'tag green' }, `高程点 ${s.points.length}`),
        this.el('span', { class: 'tag' }, `边界 ${s.boundaries.length} 组`),
        this.el('span', { class: 'tag' }, `控制点 ${s.lines.center.controlPoints.length}/${s.lines.leftCrest.controlPoints.length}/${s.lines.rightCrest.controlPoints.length}`)
      )
    );
  }

  private loadSample(): void {
    const ds = generateSampleReach();
    store.update({
      points: ds.points,
      boundaries: ds.boundaries,
      projectName: store.get().projectName || '示例河道治理工程',
      river: store.get().river || '示例河',
      reach: store.get().reach || 'K0+000~K2+400'
    });
    store.setLinePoints('center' as LineKey, ds.centerControls);
    store.setLinePoints('leftCrest' as LineKey, ds.leftCrestControls);
    store.setLinePoints('rightCrest' as LineKey, ds.rightCrestControls);
    ctx.rebuildTerrain();
    ctx.scene?.showPointCloud();
    ctx.scene?.showBoundaries();
    ctx.scene?.fitView();
    this.render();
  }
}
