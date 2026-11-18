import { sharedCss } from './styles';
import { store } from '../state/store';

/**
 * Web Components 基类：
 * - Shadow DOM + 共享样式
 * - 可折叠面板
 * - 声明式 render()，局部更新时只重渲染 body
 */
export abstract class BasePanel extends HTMLElement {
  protected root: ShadowRoot;
  private collapsedKey = '';

  constructor(title: string, storageKey = '') {
    super();
    this.root = this.attachShadow({ mode: 'open' });
    this.collapsedKey = storageKey ? `river.panel.${storageKey}.collapsed` : '';
    const collapsed = this.collapsedKey ? localStorage.getItem(this.collapsedKey) === '1' : false;
    this.root.innerHTML = `
      <style>${sharedCss}</style>
      <section class="panel ${collapsed ? 'collapsed' : ''}">
        <header id="hd"><span>${title}</span><span class="chev">▼</span></header>
        <div class="body" id="body"></div>
      </section>`;
    this.root.getElementById('hd')!.addEventListener('click', () => {
      const panel = this.root.querySelector('.panel')!;
      panel.classList.toggle('collapsed');
      if (this.collapsedKey) {
        localStorage.setItem(this.collapsedKey, panel.classList.contains('collapsed') ? '1' : '0');
      }
    });
  }

  protected body(): HTMLElement {
    return this.root.getElementById('body')!;
  }

  connectedCallback(): void {
    this.mount();
  }

  disconnectedCallback(): void {
    this.unmount();
  }

  abstract render(): void;
  private storeUnsub: (() => void) | null = null;
  private rerenderQueued = false;

  protected mount(): void {
    this.render();
  }
  protected unmount(): void {
    this.storeUnsub?.();
  }

  /**
   * 订阅 store 自动重渲染（rAF 合并）。
   * 焦点在本面板表单控件内时跳过，避免拖动滑块时控件被重建而中断交互。
   */
  protected bindStoreRerender(): void {
    this.storeUnsub = store.subscribe(() => {
      if (this.body().contains(document.activeElement)) return;
      if (this.rerenderQueued) return;
      this.rerenderQueued = true;
      requestAnimationFrame(() => {
        this.rerenderQueued = false;
        this.render();
      });
    });
  }

  /** 工具：创建元素 */
  protected el<K extends keyof HTMLElementTagNameMap>(
    tag: K,
    attrs: Record<string, string> = {},
    ...children: (Node | string)[]
  ): HTMLElementTagNameMap[K] {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') node.className = v;
      else if (k.startsWith('on') && typeof v === 'function') {
        node.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
      } else node.setAttribute(k, v);
    }
    for (const c of children) node.append(typeof c === 'string' ? document.createTextNode(c) : c);
    return node;
  }
}
