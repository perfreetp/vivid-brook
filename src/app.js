/**
 * app.js — 应用外壳：四个界面的标签路由与挂载
 */
import { render } from 'solid-js/web';
import html from 'solid-js/html';
import { createSignal, Show, For } from 'solid-js';
import { state } from './store.js';
import OrdersView from './views/orders.js';
import WorkbenchView from './views/workbench.js';
import QcView from './views/qc.js';
import DashboardView from './views/dashboard.js';

const TABS = [
  { key: 'orders', name: '前台接单' },
  { key: 'workbench', name: '设计工作台' },
  { key: 'qc', name: '质检抽查' },
  { key: 'dashboard', name: '统计看板' },
];

function App() {
  const [tab, setTab] = createSignal('workbench');
  const go = key => setTab(key);

  return html`
    <header class="app-header">
      <div class="brand">
        <span class="logo">瓶</span>
        <span>瓶型曲面建模 · 标签展开</span>
      </div>
      <nav class="nav-tabs">
        <${For} each=${TABS}>${t => html`
          <button class=${() => 'nav-tab' + (tab() === t.key ? ' active' : '')}
            onClick=${() => setTab(t.key)}>${t.name}</button>`}<//>
      </nav>
      <div class="header-meta">
        日化包装瓶厂 · 设计生产协同<br/>
        <span class="mono">SolidJS + Canvas2D + OffscreenCanvas</span>
      </div>
    </header>

    <main>
      <${Show} when=${() => tab() === 'orders'}><${OrdersView} go=${go} /><//>
      <${Show} when=${() => tab() === 'workbench'}><${WorkbenchView} go=${go} /><//>
      <${Show} when=${() => tab() === 'qc'}><${QcView} /><//>
      <${Show} when=${() => tab() === 'dashboard'}><${DashboardView} /><//>
    </main>

    <${Show} when=${() => state.toast}>
      <div class="toast">${() => state.toast}</div>
    <//>
  `;
}

render(App, document.getElementById('app'));
