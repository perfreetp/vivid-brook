import { sharedCss } from './styles';
import { store } from '../state/store';
import { sampleSpline, splineLength } from '../math/spline';
import { ctx } from './context';

/** 应用整体布局：顶部工具条 + 左侧控制面板 + 三维视口 + 底部状态栏 */
export class AppShell extends HTMLElement {
  private root: ShadowRoot;
  private unsub: (() => void) | null = null;

  constructor() {
    super();
    this.root = this.attachShadow({ mode: 'open' });
    this.root.innerHTML = `
      <style>${sharedCss}
        :host { all: initial; }
        * { box-sizing: border-box; }
        .app { display:flex; flex-direction:column; height:100vh; width:100vw; background:#eef2f7;
          font-family:"Microsoft YaHei","Segoe UI",sans-serif; color:#1e293b; }
        header.top {
          height:52px; background:linear-gradient(90deg,#0f2a6e,#1d4ed8); color:#fff;
          display:flex; align-items:center; padding:0 18px; gap:16px; flex-shrink:0;
          box-shadow:0 2px 6px rgba(0,0,0,.18); z-index:5;
        }
        header.top h1 { font-size:16px; margin:0; font-weight:700; letter-spacing:1px; }
        header.top .sub { font-size:11.5px; opacity:.85; }
        header.top .spacer { flex:1; }
        header.top button { background:rgba(255,255,255,.16); border:1px solid rgba(255,255,255,.45); color:#fff; }
        header.top button:hover { background:rgba(255,255,255,.28); }
        .main { flex:1; display:flex; min-height:0; }
        .sidebar { width:380px; min-width:340px; overflow-y:auto; padding:4px 0; background:#eef2f7; }
        .viewport { flex:1; position:relative; min-width:0; }
        #scene-host { position:absolute; inset:0; }
        .hud { position:absolute; right:14px; top:12px; background:rgba(255,255,255,.92);
          border:1px solid #cbd5e1; border-radius:8px; padding:8px 12px; font-size:11.5px; line-height:1.7;
          box-shadow:0 2px 8px rgba(0,0,0,.1); pointer-events:none; max-width:240px; }
        .hud b { color:#1d4ed8; }
        footer.status {
          height:30px; background:#1e293b; color:#cbd5e1; display:flex; align-items:center;
          padding:0 14px; gap:22px; font-size:11.5px; flex-shrink:0;
        }
        footer.status b { color:#fbbf24; font-weight:600; }
        .legend-hot { color:#dc2626; font-weight:600; }
      </style>
      <div class="app">
        <header class="top">
          <h1>河道地形曲面与堤线建模台</h1>
          <span class="sub">水利测绘院 · 断面高程点导入 / 样条堤线 / 测地线展开 / 档案版本管理</span>
          <span class="spacer"></span>
          <button id="btn-undo" class="small">撤销</button>
          <button id="btn-redo" class="small">重做</button>
          <button id="btn-fit" class="small">视图适配</button>
        </header>
        <div class="main">
          <aside class="sidebar">
            <import-panel></import-panel>
            <line-panel></line-panel>
            <offset-panel></offset-panel>
            <surface-panel></surface-panel>
            <section-panel></section-panel>
            <unfold-panel></unfold-panel>
            <archive-panel></archive-panel>
          </aside>
          <div class="viewport">
            <div id="scene-host"></div>
            <div class="hud" id="hud"></div>
          </div>
        </div>
        <footer class="status" id="statusbar"></footer>
      </div>`;
  }

  connectedCallback(): void {
    this.root.getElementById('btn-undo')!.addEventListener('click', () => store.undo());
    this.root.getElementById('btn-redo')!.addEventListener('click', () => store.redo());
    this.root.getElementById('btn-fit')!.addEventListener('click', () => ctx.scene?.fitView());
    this.unsub = store.subscribe((s) => this.updateStatus(s));
  }

  disconnectedCallback(): void {
    this.unsub?.();
  }

  private updateStatus(s: ReturnType<typeof store.get>): void {
    const center = sampleSpline(s.lines.center.controlPoints, 24, s.curvature.smoothWindow);
    const hot = center.filter((q) => q.curvature >= s.curvature.threshold).length;
    const bar = this.root.getElementById('statusbar')!;
    bar.innerHTML = `
      <span>项目：<b>${s.projectCode || '未建档'}</b></span>
      <span>河段：${s.reach || '—'}</span>
      <span>高程点：<b>${s.points.length}</b></span>
      <span>中心线长：<b>${splineLength(center).toFixed(1)} m</b></span>
      <span>着色：${s.colorMode === 'elevation' ? '高程' : s.colorMode === 'slope' ? '坡度' : '曲率'}</span>
      <span class="${hot > 0 ? 'legend-hot' : ''}">曲率突变采样：${hot} 段（阈值 ${s.curvature.threshold}）</span>
      <span style="flex:1"></span>
      <span>偏移线：${s.offset.enabled ? s.offset.distance + 'm ' + (s.offset.corner === 'round' ? '圆角' : '尖角') : '关'}</span>
      <span>展开成果：${s.unfoldResults.length} 项</span>`;

    const hud = this.root.getElementById('hud')!;
    const active = s.lines[s.activeLine];
    const samples = sampleSpline(active.controlPoints, 24, s.curvature.smoothWindow);
    const minR = samples.reduce((m, q) => (isFinite(q.radius) ? Math.min(m, q.radius) : m), Infinity);
    hud.innerHTML = `
      <div><b>操作提示</b></div>
      <div>左键拖动：旋转视角；滚轮：缩放</div>
      <div>拖拽黄球：移动控制点</div>
      <div>双击样条：就近插入控制点</div>
      <div>Delete：删除选中线末点</div>
      <div style="margin-top:4px">当前线：${active.name}</div>
      <div>最小曲率半径：${isFinite(minR) ? minR.toFixed(1) + ' m' : '∞'}</div>`;
  }
}
