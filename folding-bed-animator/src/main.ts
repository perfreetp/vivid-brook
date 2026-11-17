import { Store } from './core/store.js';
import { setStore } from './ui/base.js';
import { registerElements } from './ui/app.js';

const store = new Store();
setStore(store);
registerElements();

// 暴露到 window 便于调试与自动化检查
declare global {
  interface Window { foldingBedStore: Store }
}
window.foldingBedStore = store;

console.log('%c折叠床骨骼动画台已启动', 'color:#4fa3e3;font-weight:bold');
console.log('调试入口：window.foldingBedStore');
