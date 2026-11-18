import './styles.css';
import { AppShell } from './components/app-shell';
import { MapView } from './components/map-view';
import { SidePanel } from './components/side-panel';
import { ProfileView } from './components/profile-view';
import { store } from './lib/store';

customElements.define('app-shell', AppShell);
customElements.define('map-view', MapView);
customElements.define('side-panel', SidePanel);
customElements.define('profile-view', ProfileView);

// 优先恢复本地缓存方案，否则用示例数据并立即算一次
if (!store.restore()) {
  store.scheduleRecompute();
}

// 调试与自动化测试入口
(window as unknown as { __store: typeof store }).__store = store;
