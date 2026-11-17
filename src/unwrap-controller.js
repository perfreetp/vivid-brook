/**
 * unwrap-controller.js — 展开稿渲染调度
 * 优先 module Worker + OffscreenCanvas；环境不支持（如 file:// 下模块 worker 受限）
 * 时自动降级为主线程同步绘制，功能完全等价。
 */
import { drawUnwrap } from './unwrap-draw.js';

export class UnwrapController {
  constructor(canvas) {
    this.canvas = canvas;
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.taskSeq = 0;
    this.pending = new Map();
    this.lastPayload = null;
    this.cssW = 0;
    this.cssH = 0;
    this.onStats = null;
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(canvas);
    this.startWorker();
  }

  startWorker() {
    try {
      this.worker = new Worker(new URL('./unwrap-worker.js', import.meta.url), { type: 'module' });
      const off = this.canvas.transferControlToOffscreen();
      this.worker.postMessage({ type: 'init', canvas: off, dpr: this.dpr }, [off]);
      this.worker.onmessage = e => {
        if (e.data.type === 'done') {
          const resolve = this.pending.get(e.data.taskId);
          this.pending.delete(e.data.taskId);
          this.painted = true; // worker 实际绘制完成
          this.onStats?.(e.data.stats);
          resolve?.(e.data.stats);
        }
      };
      this.worker.onerror = () => this.fallback();
      this.offscreenReady = true;
      this.canvas.dataset.renderMode = 'worker-offscreen';
    } catch {
      this.fallback();
    }
  }

  fallback() {
    if (this.fallbackMode) return;
    this.fallbackMode = true;
    this.worker?.terminate();
    this.worker = null;
    this.canvas.dataset.renderMode = 'main-fallback';
  }

  destroy() {
    this.ro.disconnect();
    this.worker?.terminate();
    clearTimeout(this.timer);
  }

  /** 重新测量可见尺寸；隐藏（display:none）时返回 false，等待可见后由 remeasure 补渲 */
  measure() {
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return false;
    const changed = rect.width !== this.cssW || rect.height !== this.cssH;
    this.cssW = rect.width;
    this.cssH = rect.height;
    if (!this.offscreenReady || this.fallbackMode) {
      this.canvas.width = Math.round(rect.width * this.dpr);
      this.canvas.height = Math.round(rect.height * this.dpr);
    } else if (changed) {
      this.worker?.postMessage({
        type: 'resize',
        cssW: rect.width,
        cssH: rect.height,
      });
    }
    return true;
  }

  resize() {
    if (this.measure() && this.lastPayload) this.request(this.lastPayload, true);
  }

  /** 阶段切换到展开页时调用：画布可能从隐藏变为可见 */
  remeasure() {
    if (this.measure() && this.lastPayload) return this.render(this.lastPayload);
    return Promise.resolve(null);
  }

  /** 防抖请求：轮廓连续拖拽时合并重算 */
  request(payload, immediate = false) {
    this.lastPayload = payload;
    return new Promise(resolve => {
      clearTimeout(this.timer);
      this.timer = setTimeout(() => resolve(this.render(payload)), immediate ? 0 : 120);
    });
  }

  render(payload) {
    if (!this.measure()) return Promise.resolve(null); // 画布隐藏，等 remeasure
    if (this.fallbackMode || !this.worker) {
      const ctx = this.canvas.getContext('2d');
      const stats = drawUnwrap(ctx, this.cssW, this.cssH, this.dpr, payload);
      this.painted = true;
      this.onStats?.(stats);
      return Promise.resolve(stats);
    }
    const taskId = ++this.taskSeq;
    return new Promise(resolve => {
      this.pending.set(taskId, resolve);
      // Solid store 数据是 Proxy，结构化克隆无法传输，先转为纯对象
      const plain = JSON.parse(JSON.stringify(payload));
      this.worker.postMessage({
        type: 'render', taskId,
        cssW: this.cssW, cssH: this.cssH,
        payload: plain,
      });
    });
  }
}
