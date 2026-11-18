import type { LineKey, SplineLine, Vec2, WorkspaceState } from './types';

type Listener = (s: WorkspaceState) => void;

const cloneLines = (lines: WorkspaceState['lines']): WorkspaceState['lines'] => ({
  center: { ...lines.center, controlPoints: lines.center.controlPoints.map((p) => ({ ...p })) },
  leftCrest: { ...lines.leftCrest, controlPoints: lines.leftCrest.controlPoints.map((p) => ({ ...p })) },
  rightCrest: { ...lines.rightCrest, controlPoints: lines.rightCrest.controlPoints.map((p) => ({ ...p })) }
});

function defaultLines(): WorkspaceState['lines'] {
  const mk = (key: LineKey, name: string, controlPoints: Vec2[], visible = true): SplineLine => ({
    key,
    name,
    controlPoints,
    visible
  });
  return {
    center: mk('center', '河道中心线', []),
    leftCrest: mk('leftCrest', '左堤顶线', []),
    rightCrest: mk('rightCrest', '右堤顶线', [], true)
  };
}

export function initialState(): WorkspaceState {
  return {
    projectCode: '',
    projectName: '',
    river: '',
    reach: '',
    points: [],
    boundaries: [],
    lines: defaultLines(),
    activeLine: 'center',
    terrain: { resolution: 10, idwPower: 2 },
    curvature: { threshold: 0.004, smoothWindow: 5 },
    offset: { enabled: false, distance: 30, corner: 'round', roundSegments: 12, miterLimit: 2.5 },
    colorMode: 'elevation',
    section: { station: 0, halfWidth: 120, visible: false },
    unfold: { side: 'left', stationStart: 0, stationEnd: 0 },
    unfoldResults: []
  };
}

/**
 * 轻量全局 store：订阅/发布 + 堤线编辑撤销重做。
 * 为避免每条拖拽事件都压栈，控制点移动采用 begin/commit 两段式。
 */
class Store {
  private state: WorkspaceState = initialState();
  private listeners = new Set<Listener>();
  private undoStack: WorkspaceState['lines'][] = [];
  private redoStack: WorkspaceState['lines'][] = [];
  private dragging = false;

  get(): WorkspaceState {
    return this.state;
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    fn(this.state);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    this.listeners.forEach((fn) => fn(this.state));
  }

  /** 通用 patch 更新 */
  update(patch: Partial<WorkspaceState>): void {
    this.state = { ...this.state, ...patch };
    this.emit();
  }

  reset(): void {
    this.state = initialState();
    this.undoStack = [];
    this.redoStack = [];
    this.emit();
  }

  // ---------- 堤线控制点编辑（带撤销） ----------

  private pushUndo(): void {
    this.undoStack.push(cloneLines(this.state.lines));
    if (this.undoStack.length > 100) this.undoStack.shift();
    this.redoStack = [];
  }

  beginLineEdit(): void {
    if (this.dragging) return;
    this.dragging = true;
    this.pushUndo();
  }

  commitLineEdit(): void {
    this.dragging = false;
    this.emit();
  }

  /** 拖拽过程中的高频更新（不压栈） */
  setControlPoint(key: LineKey, index: number, p: Vec2): void {
    const line = this.state.lines[key];
    const next = line.controlPoints.map((cp, i) => (i === index ? { ...p } : cp));
    this.state = {
      ...this.state,
      lines: { ...this.state.lines, [key]: { ...line, controlPoints: next } }
    };
    this.emit();
  }

  addControlPoint(key: LineKey, p: Vec2, index?: number): void {
    this.pushUndo();
    const line = this.state.lines[key];
    const next = line.controlPoints.map((q) => ({ ...q }));
    if (index === undefined || index >= next.length) next.push({ ...p });
    else next.splice(index + 1, 0, { ...p });
    this.state = {
      ...this.state,
      lines: { ...this.state.lines, [key]: { ...line, controlPoints: next } }
    };
    this.emit();
  }

  removeControlPoint(key: LineKey, index: number): void {
    const line = this.state.lines[key];
    if (line.controlPoints.length <= 2) return; // 样条至少保留 2 个控制点
    this.pushUndo();
    const next = line.controlPoints.filter((_, i) => i !== index);
    this.state = {
      ...this.state,
      lines: { ...this.state.lines, [key]: { ...line, controlPoints: next } }
    };
    this.emit();
  }

  setLinePoints(key: LineKey, points: Vec2[]): void {
    this.pushUndo();
    const line = this.state.lines[key];
    this.state = {
      ...this.state,
      lines: { ...this.state.lines, [key]: { ...line, controlPoints: points.map((p) => ({ ...p })) } }
    };
    this.emit();
  }

  undo(): void {
    const prev = this.undoStack.pop();
    if (!prev) return;
    this.redoStack.push(cloneLines(this.state.lines));
    this.state = { ...this.state, lines: prev };
    this.emit();
  }

  redo(): void {
    const next = this.redoStack.pop();
    if (!next) return;
    this.undoStack.push(cloneLines(this.state.lines));
    this.state = { ...this.state, lines: next };
    this.emit();
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }
  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }
}

export const store = new Store();
