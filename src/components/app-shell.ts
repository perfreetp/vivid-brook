import type { AppState } from '../lib/store';
import { store } from '../lib/store';
import { BaseElement } from '../lib/base';
import type { ScheduleKey } from '../types';
import {
  exportIlluminanceCsv,
  exportMapPng,
  exportProjectJson,
  importJsonFile,
} from '../lib/exporter';
import { scheduleName } from './side-panel';
import './map-view';
import './side-panel';
import './profile-view';

export class AppShell extends BaseElement {
  template(): string {
    return `
      <style>
        .layout { display:grid; grid-template-rows:52px 1fr 190px; grid-template-columns:1fr 380px;
          grid-template-areas:"top top" "map side" "profile side"; height:100%; gap:1px; background:var(--line); }
        header { grid-area:top; display:flex; align-items:center; gap:14px; padding:0 14px;
          background:var(--panel); }
        map-view { grid-area:map; min-height:0; }
        side-panel { grid-area:side; min-height:0; }
        profile-view { grid-area:profile; min-height:0; overflow:hidden; }
        .title { font-weight:700; font-size:15px; white-space:nowrap; }
        .group { display:flex; align-items:center; gap:6px; }
        .seg button { border-radius:0; }
        .seg button:first-child { border-radius:6px 0 0 6px; }
        .seg button:last-child { border-radius:0 6px 6px 0; }
        .seg button.on { background:var(--accent); color:#08131f; border-color:var(--accent); font-weight:600; }
        .layers { display:flex; gap:10px; flex-wrap:wrap; font-size:12px; color:var(--muted); }
        .layers label { display:flex; align-items:center; gap:3px; cursor:pointer; }
        .spacer { flex:1; }
        .stats { font-size:11px; color:var(--muted); white-space:nowrap; }
        .stats b { color:var(--text); }
      </style>
      <div class="layout">
        <header>
          <span class="title">🏔 山地步道夜间照明布光预览</span>
          <div class="group seg" id="schedule">
            <button data-key="weekday">平日</button>
            <button data-key="festival">节日</button>
            <button data-key="lateNight">深夜</button>
          </div>
          <div class="layers">
            <label><input type="checkbox" data-layer="steps">台阶</label>
            <label><input type="checkbox" data-layer="walls">挡墙</label>
            <label><input type="checkbox" data-layer="canopies">树冠</label>
            <label><input type="checkbox" data-layer="buildings">建筑</label>
            <label><input type="checkbox" data-layer="heat">热力</label>
            <label><input type="checkbox" data-layer="contours">等值线</label>
            <label><input type="checkbox" data-layer="dimZones">低照度</label>
            <label><input type="checkbox" data-layer="aim">投射方向</label>
          </div>
          <div class="spacer"></div>
          <div class="stats" id="stats"></div>
          <div class="group">
            <button id="export-png">导出布光图</button>
            <button id="export-csv">照度统计表</button>
            <button id="export-json">导出方案</button>
            <button id="import-json">导入数据</button>
            <input type="file" id="import-file" accept=".json,application/json" hidden>
          </div>
        </header>
        <map-view></map-view>
        <side-panel></side-panel>
        <profile-view></profile-view>
      </div>
    `;
  }

  mount(): void {
    this.$all('#schedule button').forEach((b) =>
      b.addEventListener('click', () => store.setSchedule((b as HTMLElement).dataset.key as ScheduleKey)),
    );
    this.$all('[data-layer]').forEach((n) =>
      n.addEventListener('change', () => store.toggleLayer((n as HTMLElement).dataset.layer as never)),
    );
    this.$('#export-png')!.addEventListener('click', async () => {
      const svg = document.querySelector('map-view')?.shadowRoot?.querySelector('svg') as SVGSVGElement;
      if (svg) await exportMapPng(svg, `${store.get().project.name}-布光图.png`);
    });
    this.$('#export-csv')!.addEventListener('click', () => {
      const { result, schedule, project } = store.get();
      if (result) exportIlluminanceCsv(result.grid, schedule, project.name);
    });
    this.$('#export-json')!.addEventListener('click', () => exportProjectJson(store.get().project));
    const file = this.$('#import-file') as HTMLInputElement;
    this.$('#import-json')!.addEventListener('click', () => file.click());
    file.addEventListener('change', () => importJsonFile(file, 'project', store));
  }

  onState(state: AppState): void {
    this.$all('#schedule button').forEach((b) =>
      b.classList.toggle('on', (b as HTMLElement).dataset.key === state.schedule),
    );
    this.$all('[data-layer]').forEach((n) => {
      const key = (n as HTMLElement).dataset.layer as keyof AppState['layers'];
      (n as HTMLInputElement).checked = state.layers[key];
    });
    const r = state.result;
    this.$('#stats')!.innerHTML = r
      ? `${scheduleName(state.schedule)} · 点亮 <b>${r.stats.activeLamps}</b> 盏 · 平均 <b>${r.stats.meanTrailLux.toFixed(1)}</b>lx · 最低 <b>${r.stats.minTrailLux.toFixed(1)}</b>lx · 低照度 <b class="${r.stats.dimCells > 0 ? 'danger-text' : 'ok-text'}">${r.stats.dimCells.toFixed(0)}㎡</b>`
      : '计算中…';
  }
}
