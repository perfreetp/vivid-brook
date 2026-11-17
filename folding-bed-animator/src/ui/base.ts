import type { Store } from '../core/store.js';

let storeRef: Store | null = null;

export function setStore(s: Store): void { storeRef = s; }
export function getStore(): Store {
  if (!storeRef) throw new Error('Store 尚未初始化');
  return storeRef;
}

/** 所有自定义元素的基类：Shadow DOM + 共享样式 + 自动解绑 */
export abstract class BaseElement extends HTMLElement {
  protected root: ShadowRoot;
  protected unsubs: Array<() => void> = [];
  protected store: Store;

  constructor() {
    super();
    this.root = this.attachShadow({ mode: 'open' });
    this.store = getStore();
  }

  connectedCallback(): void {
    this.root.adoptedStyleSheets = [sharedSheet];
    this.render();
    this.bind();
  }

  disconnectedCallback(): void {
    this.unsubs.forEach((u) => u());
    this.unsubs = [];
  }

  /** 订阅 Store 事件，元素卸载时自动取消 */
  protected listen(event: string, fn: (payload?: any) => void): void {
    this.unsubs.push(this.store.on(event, fn));
  }

  protected abstract render(): void;
  protected bind(): void { /* 子类按需实现 */ }

  protected el<T extends HTMLElement = HTMLElement>(selector: string): T {
    return this.root.querySelector(selector) as T;
  }
  protected all<T extends HTMLElement = HTMLElement>(selector: string): T[] {
    return [...this.root.querySelectorAll(selector)] as T[];
  }
}

const styles = /* css */ `
:host {
  --bg: #10171e;
  --panel: #18222c;
  --panel2: #1f2c38;
  --border: #2c3c4a;
  --text: #dce6ee;
  --muted: #8aa0b0;
  --accent: #4fa3e3;
  --accent2: #7fd1a0;
  --warn: #ff9800;
  --danger: #e53935;
  --gold: #ffd54f;
  font-size: 13px;
  color: var(--text);
  box-sizing: border-box;
}
* { box-sizing: border-box; }
button {
  background: var(--panel2);
  color: var(--text);
  border: 1px solid var(--border);
  border-radius: 5px;
  padding: 5px 10px;
  cursor: pointer;
  font-size: 12px;
  line-height: 1.2;
}
button:hover { border-color: var(--accent); color: #fff; }
button.primary { background: var(--accent); border-color: var(--accent); color: #0b141c; font-weight: 600; }
button.danger { border-color: var(--danger); color: #ff8a80; }
button:disabled { opacity: .4; cursor: not-allowed; }
input, select, textarea {
  background: #0e151c;
  color: var(--text);
  border: 1px solid var(--border);
  border-radius: 5px;
  padding: 5px 8px;
  font-size: 12px;
  width: 100%;
}
input[type=range] { padding: 0; }
input[type=color] { padding: 2px; height: 28px; }
label { color: var(--muted); font-size: 11px; display: block; margin-bottom: 3px; }
.row { display: flex; gap: 8px; align-items: center; }
.col { display: flex; flex-direction: column; gap: 6px; }
.tag {
  display: inline-block; padding: 2px 8px; border-radius: 10px;
  font-size: 11px; font-weight: 600;
}
.tag.draft { background: #455a64; color: #fff; }
.tag.in_progress { background: #154360; color: #8ec6f0; }
.tag.review { background: #6d4c00; color: #ffd54f; }
.tag.rework { background: #5d1f1a; color: #ff8a80; }
.tag.done { background: #1b5e20; color: #a5d6a7; }
.muted { color: var(--muted); }
.scroll { overflow: auto; }
.scroll::-webkit-scrollbar { width: 9px; height: 9px; }
.scroll::-webkit-scrollbar-thumb { background: #33475a; border-radius: 5px; }
h3 { margin: 0 0 8px; font-size: 13px; color: var(--accent2); letter-spacing: .5px; }
h4 { margin: 12px 0 6px; font-size: 12px; color: var(--muted); text-transform: uppercase; letter-spacing: .8px; }
table { width: 100%; border-collapse: collapse; }
th, td { text-align: left; padding: 7px 8px; border-bottom: 1px solid var(--border); font-size: 12px; }
th { color: var(--muted); font-weight: 500; }
.clickable { cursor: pointer; }
.clickable:hover { background: var(--panel2); }
.field { margin-bottom: 8px; }
.grow { flex: 1; min-width: 0; min-height: 0; }
`;

let sharedSheet: CSSStyleSheet;
try {
  sharedSheet = new CSSStyleSheet();
  sharedSheet.replaceSync(styles);
} catch {
  // 旧浏览器回退：每个组件内联 style
  sharedSheet = { replaceSync() {}, replace() { return Promise.resolve(); } } as unknown as CSSStyleSheet;
}

export function fallbackStyleEl(): HTMLStyleElement {
  const s = document.createElement('style');
  s.textContent = styles;
  return s;
}
