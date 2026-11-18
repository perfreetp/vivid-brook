/* @refresh reload */
import { render } from 'solid-js/web';
import { createSignal, onCleanup, Show } from 'solid-js';
import './styles.css';
import { ui } from './store';
if (typeof window !== 'undefined') window.__ui = ui;
import ReviewPage from './pages/ReviewPage';
import VersionsPage from './pages/VersionsPage';
import AnnotationsPage from './pages/AnnotationsPage';
import ComparePage from './pages/ComparePage';

const ROUTES = [
  { path: 'review', name: '三维审图台', comp: ReviewPage },
  { path: 'versions', name: '版本管理', comp: VersionsPage },
  { path: 'annotations', name: '批注管理', comp: AnnotationsPage },
  { path: 'compare', name: '版本比对', comp: ComparePage },
];

function currentRoute() {
  const h = location.hash.replace('#/', '').split('?')[0] || 'review';
  return ROUTES.find((r) => r.path === h) || ROUTES[0];
}

function Topbar() {
  const [route, setRoute] = createSignal(currentRoute());
  const onHash = () => setRoute(currentRoute());
  window.addEventListener('hashchange', onHash);
  onCleanup(() => window.removeEventListener('hashchange', onHash));
  const v = () => ui.versions.find((x) => x.vid === ui.currentVid());
  return (
    <header class="topbar">
      <div class="brand">
        地下综合管廊 · 三维分层审图台
        <small>SolidJS + WebGL2</small>
      </div>
      <nav class="nav">
        {ROUTES.map((r) => (
          <a href={`#/${r.path}`} class={route().path === r.path ? 'active' : ''}>{r.name}</a>
        ))}
      </nav>
      <div class="spacer" />
      <Show when={v()}>
        <div class="badge">当前版本 <b>{v().name}</b></div>
        <div class="badge">出图时间 {v().createdAt}</div>
      </Show>
    </header>
  );
}

function App() {
  const [route, setRoute] = createSignal(currentRoute());
  const onHash = () => setRoute(currentRoute());
  window.addEventListener('hashchange', onHash);
  onCleanup(() => window.removeEventListener('hashchange', onHash));
  const Page = () => route().comp;
  return (
    <div class="app-shell">
      <Topbar />
      {Page()({})}
    </div>
  );
}

render(() => <App />, document.getElementById('root'));
