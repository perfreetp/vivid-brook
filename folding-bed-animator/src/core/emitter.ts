type Handler = (payload?: any) => void;

/** 极简事件发射器，供全局 Store 与各 Web Component 使用 */
export class Emitter {
  private map = new Map<string, Set<Handler>>();

  on(event: string, fn: Handler): () => void {
    if (!this.map.has(event)) this.map.set(event, new Set());
    this.map.get(event)!.add(fn);
    return () => this.off(event, fn);
  }

  off(event: string, fn: Handler): void {
    this.map.get(event)?.delete(fn);
  }

  emit(event: string, payload?: any): void {
    this.map.get(event)?.forEach((fn) => {
      try { fn(payload); } catch (e) { console.error(`[event:${event}]`, e); }
    });
  }
}
