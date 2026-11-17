import { BaseElement, fallbackStyleEl } from './base.js';
import { ViewportElement } from './viewport.js';
import { TimelineElement } from './timeline.js';
import { TransportElement } from './transport.js';
import { InspectorElement } from './inspector.js';
import { OrdersElement } from './orders.js';

export class AppRoot extends BaseElement {
  private view: 'editor' | 'orders' = 'editor';

  protected render(): void {
    this.root.innerHTML = /* html */ `
      ${fallbackStyleEl().outerHTML}
      <style>
        :host { display: flex; flex-direction: column; height: 100vh; background: var(--bg); }
        header {
          display: flex; align-items: center; gap: 14px; padding: 0 16px;
          height: 48px; background: var(--panel); border-bottom: 1px solid var(--border); flex-shrink: 0;
        }
        .logo { font-weight: 700; color: var(--accent); letter-spacing: .5px; white-space: nowrap; }
        nav { display: flex; gap: 4px; }
        nav button { border: none; background: transparent; padding: 7px 14px; border-radius: 6px; }
        nav button.on { background: var(--panel2); color: var(--accent2); font-weight: 600; }
        .crumb { color: var(--muted); font-size: 12px; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        main { flex: 1; min-height: 0; display: flex; flex-direction: column; }
        #editorView { flex: 1; min-height: 0; display: flex; flex-direction: column; }
        .work { flex: 1 1 auto; min-height: 260px; display: flex; }
        .inspector-col { width: 300px; flex-shrink: 0; border-left: 1px solid var(--border); min-height: 0; display: flex; }
        .viewport-col { flex: 1 1 auto; min-width: 0; min-height: 0; display: flex; }
        .timeline-col { flex: 0 1 320px; min-height: 180px; display: flex; }
        .timeline-col > *, .inspector-col > *, .viewport-col > * { flex: 1 1 auto; min-width: 0; min-height: 0; }
        #ordersView { flex: 1 1 0; min-height: 0; display: none; }
        #ordersView > * { flex: 1 1 0; min-height: 0; }
        :host([data-view="orders"]) #editorView { display: none; }
        :host([data-view="orders"]) #ordersView { display: flex; flex-direction: column; }
      </style>
      <header>
        <span class="logo">🛏 折叠床骨骼动画台</span>
        <nav>
          <button id="navEditor" class="on">动画编辑器</button>
          <button id="navOrders">订单工作流</button>
        </nav>
        <span class="crumb" id="crumb"></span>
        <span class="muted" id="backendHint" style="font-size:11px"></span>
      </header>
      <main>
        <div id="editorView">
          <transport-bar></transport-bar>
          <div class="work">
            <div class="viewport-col"><viewport-canvas></viewport-canvas></div>
            <div class="inspector-col"><inspector-panel></inspector-panel></div>
          </div>
          <div class="timeline-col"><timeline-panel></timeline-panel></div>
        </div>
        <div id="ordersView"><orders-page></orders-page></div>
      </main>
    `;
  }

  protected bind(): void {
    this.setAttribute('data-view', 'editor');
    this.el('#navEditor').addEventListener('click', () => this.switchView('editor'));
    this.el('#navOrders').addEventListener('click', () => this.switchView('orders'));
    this.listen('nav', (v: string) => this.switchView(v as 'editor' | 'orders'));
    // 支持 URL 深链：#orders 直接打开订单工作流
    if (location.hash === '#orders') this.switchView('orders');
    window.addEventListener('hashchange', () => {
      this.switchView(location.hash === '#orders' ? 'orders' : 'editor');
    });
    this.listen('selection', () => this.updateCrumb());
    this.listen('data', () => this.updateCrumb());
    this.listen('renderer', () => {
      this.el('#backendHint').textContent =
        this.store.rendererKind === 'webgpu' ? 'WebGPU' : 'Canvas2D 回退';
    });
    this.updateCrumb();

    window.addEventListener('keydown', this.onKey);
    this.unsubs.push(() => window.removeEventListener('keydown', this.onKey));
  }

  private switchView(v: 'editor' | 'orders'): void {
    this.view = v;
    this.setAttribute('data-view', v);
    this.el('#navEditor').classList.toggle('on', v === 'editor');
    this.el('#navOrders').classList.toggle('on', v === 'orders');
    const wantHash = v === 'orders' ? '#orders' : '';
    if (location.hash !== wantHash) history.replaceState(null, '', '#' + wantHash);
  }

  private updateCrumb(): void {
    const o = this.store.order;
    const s = this.store.shot;
    this.el('#crumb').textContent = o ? `${o.title} ${s ? '／ ' + s.name : ''}` : '未选择订单';
  }

  private onKey = (e: KeyboardEvent): void => {
    if (this.view !== 'editor') return;
    const tag = (e.target as HTMLElement)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      this.store.undo();
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
      e.preventDefault();
      this.store.redo();
    } else if (e.key === ' ') {
      e.preventDefault();
      this.store.setPlaying(!this.store.playing);
    } else if (e.key.toLowerCase() === 'k') {
      this.root.querySelector<TimelineElement>('timeline-panel')?.['addKeyframe']?.();
    } else if (e.key === 'ArrowLeft') {
      this.store.setFrame(this.store.frame - (e.shiftKey ? 10 : 1));
    } else if (e.key === 'ArrowRight') {
      this.store.setFrame(this.store.frame + (e.shiftKey ? 10 : 1));
    } else if (e.key === 'Home') {
      this.store.setFrame(0);
    } else if (e.key === 'End') {
      this.store.setFrame((this.store.project?.frameCount ?? 1) - 1);
    }
  };
}

export function registerElements(): void {
  customElements.define('viewport-canvas', ViewportElement);
  customElements.define('timeline-panel', TimelineElement);
  customElements.define('transport-bar', TransportElement);
  customElements.define('inspector-panel', InspectorElement);
  customElements.define('orders-page', OrdersElement);
  customElements.define('app-root', AppRoot);
}
