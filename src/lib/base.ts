import type { AppState } from './store';
import { store } from './store';

/** 轻量 Web Component 基类：Shadow DOM + store 订阅 + 按需重渲染 */
export abstract class BaseElement extends HTMLElement {
  protected root: ShadowRoot;
  private unsub: (() => void) | null = null;
  private rendered = false;

  constructor() {
    super();
    this.root = this.attachShadow({ mode: 'open' });
  }

  connectedCallback(): void {
    if (!this.rendered) {
      this.rendered = true;
      this.root.innerHTML = this.template();
      this.mount(this.root);
    }
    this.unsub = store.subscribe((s) => this.onState(s));
    this.onState(store.get());
  }

  disconnectedCallback(): void {
    this.unsub?.();
    this.unsub = null;
  }

  protected abstract template(): string;
  protected mount(_root: ShadowRoot): void {}
  protected abstract onState(state: AppState): void;

  protected $(sel: string): HTMLElement | null {
    return this.root.querySelector(sel);
  }

  protected $all(sel: string): Element[] {
    return [...this.root.querySelectorAll(sel)];
  }
}

export { store };
