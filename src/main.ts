import { AppShell } from './components/app-shell';
import { ImportPanel } from './components/import-panel';
import { LinePanel } from './components/line-panel';
import { CurvatureChart } from './components/curvature-chart';
import { OffsetPanel } from './components/offset-panel';
import { SurfacePanel } from './components/surface-panel';
import { SectionPanel, SectionCanvas } from './components/section-panel';
import { UnfoldPanel, UnfoldDrawing } from './components/unfold-panel';
import { ArchivePanel } from './components/archive-panel';
import { store } from './state/store';
import { SceneManager } from './three/SceneManager';
import { ctx } from './components/context';
import { buildTerrainGrid, type TerrainGrid } from './math/terrain';
import { sampleSpline, splineLength } from './math/spline';
import { buildEmbankmentStrip, flattenStrip, unfoldedContours } from './math/unfold';
import type { LineKey, UnfoldResult } from './state/types';

// 注册全部 Web Components
customElements.define('app-shell', AppShell);
customElements.define('import-panel', ImportPanel);
customElements.define('line-panel', LinePanel);
customElements.define('curvature-chart', CurvatureChart);
customElements.define('offset-panel', OffsetPanel);
customElements.define('surface-panel', SurfacePanel);
customElements.define('section-panel', SectionPanel);
customElements.define('section-canvas', SectionCanvas);
customElements.define('unfold-panel', UnfoldPanel);
customElements.define('unfold-drawing', UnfoldDrawing);
customElements.define('archive-panel', ArchivePanel);

function boot(): void {
  const host = document.querySelector('app-shell')!.shadowRoot!.getElementById('scene-host') as HTMLElement;

  const scene = new SceneManager(host, store.get(), {
    onDragStart: () => store.beginLineEdit(),
    onDragMove: (key: LineKey, index, p) => {
      store.setControlPoint(key, index, p);
      scene.scheduleLinesUpdate();
    },
    onDragEnd: () => store.commitLineEdit(),
    onInsert: (key, p, index) => store.addControlPoint(key, p, index)
  });
  ctx.scene = scene;

  // 地形重建
  ctx.rebuildTerrain = (): TerrainGrid | null => {
    const s = store.get();
    const grid = buildTerrainGrid(s.points, s.boundaries, s.terrain.resolution, s.terrain.idwPower);
    scene.setTerrainGrid(grid);
    return grid;
  };

  // 场景全量刷新（堤线、偏移线、断面）
  ctx.refreshScene = () => {
    scene.setState(store.get());
    scene.updateAllLines();
  };

  // 测地线展开流程编排
  ctx.runUnfold = (): void => {
    const s = store.get();
    if (!s.unfold) {
      alert('请先在展开面板选择堤坡侧别与里程区间。');
      return;
    }
    const side = s.unfold.side ?? 'left';
    const crestKey: LineKey = side === 'left' ? 'leftCrest' : 'rightCrest';
    const crestSamples = sampleSpline(s.lines[crestKey].controlPoints, 24, s.curvature.smoothWindow);
    if (crestSamples.length < 2) {
      alert('堤顶线控制点不足，无法展开。');
      return;
    }
    const len = splineLength(crestSamples);
    const start = Math.max(0, Math.min(s.unfold.stationStart, len));
    const end = Math.max(start, Math.min(s.unfold.stationEnd || len, len));
    if (end - start < 1) {
      alert('展开里程区间过短。');
      return;
    }
    const sideSign = side === 'left' ? 1 : -1;
    const strip = buildEmbankmentStrip(crestSamples, sideSign, start, end, scene.getGrid());
    const flat = flattenStrip(strip);
    const contours = unfoldedContours(flat.rows, 6);
    const result: UnfoldResult = {
      id: `uf-${Date.now()}`,
      createdAt: new Date().toISOString(),
      side,
      stationStart: start,
      stationEnd: end,
      area: flat.area,
      slopeLength: flat.slopeLength,
      crestLength: flat.crestLength,
      toeLength: flat.toeLength,
      outline: flat.outline,
      contours
    };
    store.update({ unfoldResults: [...store.get().unfoldResults, result] });
    scene.showStripPreview(flat.rows);
    alert(
      `展开完成：\n展开面积 ${result.area.toFixed(2)} m²\n平均坡长 ${result.slopeLength.toFixed(2)} m\n堤顶长 ${result.crestLength.toFixed(2)} m / 坡脚长 ${result.toeLength.toFixed(2)} m`
    );
  };

  // 全局状态广播 → 场景同步
  store.subscribe((s) => {
    scene.setState(s);
  });

  // 删除控制点事件（SceneManager 派发，保持其与 store 解耦）
  window.addEventListener('river:delete-point', ((e: CustomEvent<{ key: LineKey; index: number }>) => {
    store.removeControlPoint(e.detail.key, e.detail.index);
    scene.updateAllLines();
  }) as EventListener);

  // 首次自适应
  setTimeout(() => scene.fitView(), 300);
}

// 等待 app-shell 完成 Shadow DOM 构建
if (customElements.whenDefined) {
  customElements.whenDefined('app-shell').then(() => requestAnimationFrame(boot));
} else {
  window.addEventListener('DOMContentLoaded', boot);
}
