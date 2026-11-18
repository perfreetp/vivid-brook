import { useSyncExternalStore } from 'react';
import type {
  EditorState,
  Feature,
  Layer,
  Pt,
  ToolType,
  Role,
  BooleanOp,
  WorkEntry,
  WorkStatus,
  FeatureKind,
} from '../types';
import { HistoryStack } from '../lib/history';
import {
  uid,
  runBoolean,
  offsetOpenPath,
  reversePoints,
  GRID_SIZE,
} from '../lib/geometry';
import { defaultLayers, demoFeatures, makeFeature, KIND_META } from '../lib/factory';

const STORAGE_KEY = 'saltfield-editor-state-v1';

function initialState(): EditorState {
  const layers = defaultLayers();
  const features = demoFeatures(layers);
  const now = new Date().toISOString();
  const deadline = new Date(Date.now() + 7 * 864e5).toISOString();
  return {
    project: {
      id: uid('proj'),
      name: '示例盐田整治项目',
      customer: '某盐业集团',
      createdAt: now,
      deadline,
      description: '客户下单后由制作员按条目加工，主管审核通过后打包交付。',
    },
    layers,
    features,
    entries: [
      {
        id: uid('entry'),
        title: '一号纳潮主渠与卤水池测绘',
        kind: 'intake',
        featureIds: [features[0].id, features[2].id],
        status: 'in_progress',
        reworkCount: 0,
        deadline,
        assignee: '制作员A',
        reviewNote: '',
        createdAt: now,
        updatedAt: now,
      },
    ],
    selectedIds: [],
    activeLayerId: layers[0].id,
    role: 'maker',
    currentTool: 'select',
  };
}

export class EditorStore {
  state: EditorState;
  history = new HistoryStack<EditorState>(100);
  private listeners = new Set<() => void>();
  /** 拖动手势期间保存快照一次，移动过程只做即时通知 */
  private gestureSnapshot: EditorState | null = null;

  constructor() {
    this.state = this.load() ?? initialState();
  }

  // ---- 订阅 ----
  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  getSnapshot = (): EditorState => this.state;
  private emit(): void {
    this.listeners.forEach((fn) => fn());
  }

  private clone(s: EditorState): EditorState {
    return JSON.parse(JSON.stringify(s)) as EditorState;
  }

  /** 普通可撤销操作：先存快照，再修改 */
  commit(label: string, mutator: (draft: EditorState) => void): void {
    this.history.push(this.clone(this.state));
    const draft = this.clone(this.state);
    mutator(draft);
    this.state = draft;
    this.persist();
    this.emit();
  }

  /** 拖动开始：记录一次快照 */
  beginGesture(): void {
    if (!this.gestureSnapshot) this.gestureSnapshot = this.clone(this.state);
  }
  /** 拖动中：直接改并通知，不入历史栈 */
  applyGesture(mutator: (draft: EditorState) => void): void {
    const draft = this.clone(this.state);
    mutator(draft);
    this.state = draft;
    this.emit();
  }
  /** 拖动结束：把开始前快照压栈 */
  endGesture(): void {
    if (this.gestureSnapshot) {
      this.history.push(this.gestureSnapshot);
      this.gestureSnapshot = null;
      this.persist();
    }
  }
  cancelGesture(): void {
    if (this.gestureSnapshot) {
      this.state = this.gestureSnapshot;
      this.gestureSnapshot = null;
      this.emit();
    }
  }

  undo(): void {
    const prev = this.history.undo(this.state);
    if (prev) {
      this.state = prev;
      this.persist();
      this.emit();
    }
  }
  redo(): void {
    const next = this.history.redo(this.state);
    if (next) {
      this.state = next;
      this.persist();
      this.emit();
    }
  }

  // ---- 选择 / 工具 ----
  setTool(tool: ToolType): void {
    this.commit('切换工具', (d) => {
      d.currentTool = tool;
      if (tool !== 'select') d.selectedIds = [];
    });
  }
  setRole(role: Role): void {
    this.commit('切换角色', (d) => {
      d.role = role;
    });
  }
  select(ids: string[], additive = false): void {
    this.commit('选择', (d) => {
      d.selectedIds = additive ? Array.from(new Set([...d.selectedIds, ...ids])) : ids;
    });
  }
  setSelectionLive(ids: string[]): void {
    // 框选过程中的即时更新（不入历史）
    this.state = { ...this.state, selectedIds: ids };
    this.emit();
  }
  clearSelection(): void {
    this.commit('清除选择', (d) => {
      d.selectedIds = [];
    });
  }

  // ---- 要素增删改 ----
  addFeatureFromPoints(kind: FeatureKind, points: Pt[]): Feature {
    const feature = makeFeature(kind, this.state.activeLayerId, points);
    this.commit(`新建${KIND_META[kind].label}`, (d) => {
      d.features.push(feature);
      d.selectedIds = [feature.id];
      d.currentTool = 'select';
    });
    return feature;
  }

  updateFeature(id: string, patch: Partial<Feature>): void {
    this.commit('修改要素', (d) => {
      const f = d.features.find((x) => x.id === id);
      if (f) Object.assign(f, patch);
    });
  }

  /** 拖动顶点（手势期间调用，不入历史） */
  moveVertexGesture(featureId: string, vertexIndex: number, p: Pt): void {
    this.applyGesture((d) => {
      const f = d.features.find((x) => x.id === featureId);
      if (f && !f.locked) f.points[vertexIndex] = p;
    });
  }
  moveFeatureGesture(featureId: string, delta: Pt): void {
    this.applyGesture((d) => {
      const f = d.features.find((x) => x.id === featureId);
      if (f && !f.locked) f.points = f.points.map((p) => ({ x: p.x + delta.x, y: p.y + delta.y }));
    });
  }

  deleteSelected(): void {
    const ids = new Set(this.state.selectedIds);
    if (ids.size === 0) return;
    this.commit('删除要素', (d) => {
      d.features = d.features.filter((f) => !ids.has(f.id) && f.sourceId !== undefined && ids.has(f.sourceId) === false);
      // 同时删除被删要素派生的沟沿
      d.features = d.features.filter((f) => !(f.sourceId && ids.has(f.sourceId)));
      d.selectedIds = [];
      d.entries.forEach((e) => {
        e.featureIds = e.featureIds.filter((id) => !ids.has(id));
      });
    });
  }

  insertVertex(featureId: string, p: Pt): void {
    this.commit('插入顶点', (d) => {
      const f = d.features.find((x) => x.id === featureId);
      if (!f) return;
      const pts = f.points;
      let best: { i: number; d: number } | null = null;
      const segN = f.pathType === 'closed' ? pts.length : pts.length - 1;
      for (let i = 0; i < segN; i++) {
        const a = pts[i];
        const b = pts[(i + 1) % pts.length];
        const dd = Math.hypot((a.x + b.x) / 2 - p.x, (a.y + b.y) / 2 - p.y);
        if (!best || dd < best.d) best = { i, d: dd };
      }
      if (best) {
        const a = pts[best.i];
        const b = pts[(best.i + 1) % pts.length];
        pts.splice(best.i + 1, 0, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
      }
    });
  }

  reverseSelected(): void {
    const ids = this.state.selectedIds;
    if (ids.length === 0) return;
    this.commit('反转方向', (d) => {
      d.features.forEach((f) => {
        if (ids.includes(f.id)) f.points = reversePoints(f.points);
      });
    });
  }

  /** 断开：开放路径在指定顶点拆成两条；闭合路径在该顶点打开 */
  splitAt(featureId: string, vertexIndex: number): void {
    this.commit('断开路径', (d) => {
      const f = d.features.find((x) => x.id === featureId);
      if (!f || f.locked) return;
      if (f.pathType === 'closed') {
        const opened = [...f.points.slice(vertexIndex), ...f.points.slice(0, vertexIndex)];
        f.points = opened;
        f.pathType = 'open';
      } else {
        if (vertexIndex === 0 || vertexIndex === f.points.length - 1) return;
        const p1 = f.points.slice(0, vertexIndex + 1);
        const p2 = f.points.slice(vertexIndex);
        const a = makeFeature(f.kind, f.layerId, p1);
        a.name = `${f.name}-a`;
        a.width = f.width;
        a.slope = f.slope;
        const b = makeFeature(f.kind, f.layerId, p2);
        b.name = `${f.name}-b`;
        b.width = f.width;
        b.slope = f.slope;
        d.features = d.features.filter((x) => x.id !== f.id);
        d.features.push(a, b);
        d.selectedIds = [a.id, b.id];
      }
    });
  }

  /** 合并：多条同类开放路径首尾拼接为一条 */
  mergeSelected(): void {
    const selected = this.state.features.filter((f) => this.state.selectedIds.includes(f.id));
    if (selected.length < 2) return;
    this.commit('合并路径', (d) => {
      const open = selected.filter((f) => f.pathType === 'open');
      if (open.length < 2) return;
      // 贪心：每次找端点距离最近的两条拼接
      let chain = open[0].points.map((p) => ({ ...p }));
      const rest = open.slice(1).map((f) => f.points.map((p) => ({ ...p })));
      while (rest.length) {
        let best: { idx: number; rev: boolean; head: boolean; d: number } | null = null;
        const head = chain[0];
        const tail = chain[chain.length - 1];
        rest.forEach((pts, idx) => {
          const cand: [number, boolean, boolean][] = [
            [Math.hypot(tail.x - pts[0].x, tail.y - pts[0].y), false, false],
            [Math.hypot(tail.x - pts[pts.length - 1].x, tail.y - pts[pts.length - 1].y), true, false],
            [Math.hypot(head.x - pts[pts.length - 1].x, head.y - pts[pts.length - 1].y), false, true],
            [Math.hypot(head.x - pts[0].x, head.y - pts[0].y), true, true],
          ];
          cand.forEach(([dd, rev, toHead]) => {
            if (!best || dd < best.d) best = { idx, rev, head: toHead, d: dd };
          });
        });
        const pick = best!;
        let pts = rest.splice(pick.idx, 1)[0];
        if (pick.rev) pts = pts.reverse();
        if (pick.head) chain = [...pts.slice(0, -1), ...chain];
        else chain = [...chain.slice(0, -1), ...pts];
      }
      const merged = makeFeature(open[0].kind, open[0].layerId, chain);
      merged.name = `${open[0].name}-合并`;
      merged.width = open[0].width;
      merged.slope = open[0].slope;
      const removeIds = new Set(open.map((f) => f.id));
      d.features = d.features.filter((f) => !removeIds.has(f.id));
      d.features.push(merged);
      d.selectedIds = [merged.id];
    });
  }

  // ---- 双侧沟沿（等距偏移） ----
  generateBanks(featureId: string): void {
    const f = this.state.features.find((x) => x.id === featureId);
    if (!f || f.pathType !== 'open') return;
    this.commit('生成双侧沟沿', (d) => {
      // 重新生成：先删除旧沟沿
      d.features = d.features.filter((x) => x.sourceId !== featureId);
      const target = d.features.find((x) => x.id === featureId)!;
      // 偏移距离 = 半宽 + 深度 × 边坡比（边坡水平投影）
      const offset = target.width / 2 + target.depth * target.slope;
      const { left, right } = offsetOpenPath(target.points, offset);
      const mk = (pts: Pt[], side: string): Feature => {
        const bank = makeFeature(target.kind, target.layerId, pts);
        bank.role = 'bank';
        bank.sourceId = featureId;
        bank.name = `${target.name}-${side}沟沿`;
        bank.width = 0;
        bank.visible = true;
        return bank;
      };
      d.features.push(mk(left, '左'), mk(right, '右'));
    });
  }

  // ---- 布尔运算 ----
  applyBoolean(op: BooleanOp): void {
    const selected = this.state.features.filter((f) => this.state.selectedIds.includes(f.id));
    if (selected.length < 2) return;
    this.commit(`布尔${op}`, (d) => {
      const operands = selected.map((s) => d.features.find((f) => f.id === s.id)!).filter(Boolean);
      const { polygons } = runBoolean(op, operands);
      if (polygons.length === 0) {
        d.selectedIds = [];
        return;
      }
      const removeIds = new Set(operands.map((f) => f.id));
      // 沟沿等派生要素一并移除
      d.features = d.features.filter((f) => !removeIds.has(f.id) && !(f.sourceId && removeIds.has(f.sourceId)));
      const baseKind = operands[0].kind;
      const created: Feature[] = polygons.map((rings, i) => {
        const nf = makeFeature(baseKind, operands[0].layerId, rings[0]);
        nf.holes = rings.slice(1);
        nf.pathType = 'closed';
        nf.name = `${KIND_META[baseKind].label}-${op === 'union' ? '并集' : op === 'difference' ? '差集' : '交集'}${polygons.length > 1 ? i + 1 : ''}`;
        nf.width = operands[0].width;
        nf.slope = operands[0].slope;
        nf.depth = operands[0].depth;
        return nf;
      });
      d.features.push(...created);
      d.selectedIds = created.map((f) => f.id);
    });
  }

  // ---- 图层 ----
  toggleLayerLock(layerId: string): void {
    this.commit('图层锁定', (d) => {
      const l = d.layers.find((x) => x.id === layerId);
      if (l) l.locked = !l.locked;
    });
  }
  toggleLayerVisible(layerId: string): void {
    this.commit('图层可见', (d) => {
      const l = d.layers.find((x) => x.id === layerId);
      if (l) l.visible = !l.visible;
    });
  }
  toggleFeatureLock(id: string): void {
    this.commit('锁定要素', (d) => {
      const f = d.features.find((x) => x.id === id);
      if (f) f.locked = !f.locked;
    });
  }
  setActiveLayer(layerId: string): void {
    this.commit('当前图层', (d) => {
      d.activeLayerId = layerId;
    });
  }
  addLayer(): void {
    this.commit('新建图层', (d) => {
      const colors = ['#8b5cf6', '#ec4899', '#0ea5e9', '#84cc16'];
      const l: Layer = {
        id: uid('layer'),
        name: `图层 ${d.layers.length + 1}`,
        color: colors[d.layers.length % colors.length],
        visible: true,
        locked: false,
      };
      d.layers.push(l);
      d.activeLayerId = l.id;
    });
  }

  isLayerLocked(layerId: string): boolean {
    return this.state.layers.find((l) => l.id === layerId)?.locked ?? false;
  }

  // ---- 工单流程 ----
  createEntry(title: string, kind: FeatureKind, assignee: string, deadline: string, featureIds: string[]): void {
    const now = new Date().toISOString();
    const entry: WorkEntry = {
      id: uid('entry'),
      title,
      kind,
      featureIds,
      status: 'pending',
      reworkCount: 0,
      deadline,
      assignee,
      reviewNote: '',
      createdAt: now,
      updatedAt: now,
    };
    this.commit('客户下单', (d) => {
      d.entries.push(entry);
    });
  }

  updateEntryStatus(id: string, status: WorkStatus, note = ''): void {
    this.commit('工单状态', (d) => {
      const e = d.entries.find((x) => x.id === id);
      if (!e) return;
      if (status === 'rejected') {
        e.reworkCount += 1;
        e.status = 'rework';
      } else {
        e.status = status;
      }
      if (note) e.reviewNote = note;
      e.updatedAt = new Date().toISOString();
    });
  }

  // ---- 持久化 ----
  private persist(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
    } catch {
      /* 存储满或被禁用时忽略 */
    }
  }
  private load(): EditorState | null {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? (JSON.parse(raw) as EditorState) : null;
    } catch {
      return null;
    }
  }
  resetProject(): void {
    this.history = new HistoryStack<EditorState>(100);
    this.state = initialState();
    this.persist();
    this.emit();
  }
}

export const store = new EditorStore();

export function useEditor(): EditorState {
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}

export { GRID_SIZE };
