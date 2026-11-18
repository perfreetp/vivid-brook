// 撤销/重做历史栈，容量至少 50 步（默认 100）
export class HistoryStack<T> {
  private past: T[] = [];
  private future: T[] = [];
  private capacity: number;

  constructor(capacity = 100) {
    this.capacity = Math.max(50, capacity);
  }

  /** 执行变更前压入当前快照 */
  push(snapshot: T): void {
    this.past.push(snapshot);
    if (this.past.length > this.capacity) this.past.shift();
    this.future = [];
  }

  undo(current: T): T | null {
    const prev = this.past.pop();
    if (prev === undefined) return null;
    this.future.push(current);
    return prev;
  }

  redo(current: T): T | null {
    const next = this.future.pop();
    if (next === undefined) return null;
    this.past.push(current);
    return next;
  }

  get canUndo(): boolean {
    return this.past.length > 0;
  }
  get canRedo(): boolean {
    return this.future.length > 0;
  }
  get depth(): number {
    return this.past.length;
  }
  clear(): void {
    this.past = [];
    this.future = [];
  }
}
