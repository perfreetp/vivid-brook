import type { AppData, Order, Role, Shot, HistoryEntry, AnimProject, OrderStatus, ShotStatus } from '../types.js';
import { Emitter } from './emitter.js';
import { createDefaultProject } from './default-project.js';
import { uid } from './math.js';

const STORAGE_KEY = 'folding-bed-animator:v1';
const UNDO_LIMIT = 50;

export type StoreEvent =
  | 'data'           // 订单/角色等持久化数据变化
  | 'selection'      // 镜头/骨骼选择变化
  | 'playhead'       // 当前帧变化
  | 'playing'        // 播放状态变化
  | 'camera'         // 视图相机变化
  | 'project'        // 当前工程内容变化（撤销/编辑）
  | 'renderer';      // 渲染器后端变化

function seedData(): AppData {
  const demo = createDefaultProject();
  const orderId = uid('ord');
  const shotId = uid('shot');
  const now = Date.now();
  const shot: Shot = {
    id: shotId,
    name: '镜头01-开合全程',
    status: 'in_progress',
    reworkCount: 0,
    deadline: now + 7 * 86400000,
    project: demo,
    history: [{ at: now, by: 'customer', action: '客户下单并创建镜头' }],
  };
  const order: Order = {
    id: orderId,
    title: '示例项目：塑料折叠床 X100',
    client: '某家居品牌',
    createdAt: now,
    deadline: now + 14 * 86400000,
    status: 'in_progress',
    reworkCount: 0,
    note: '需要展开与收拢两段机构动画，突出铰点限位。',
    shots: [shot],
    history: [{ at: now, by: 'customer', action: '创建订单' }],
  };
  return { version: 1, role: 'artist', orders: [order] };
}

export class Store extends Emitter {
  data: AppData;
  currentOrderId: string | null = null;
  currentShotId: string | null = null;
  selectedBoneId: string | null = null;
  frame = 0;
  playing = false;
  loop = true;
  camera = { panX: 0, panY: 0, zoom: 1 };
  rendererKind: 'webgpu' | 'canvas2d' = 'webgpu';

  private undoStack: string[] = [];
  private redoStack: string[] = [];

  constructor() {
    super();
    this.data = this.load();
    const first = this.data.orders[0];
    if (first) {
      this.currentOrderId = first.id;
      this.currentShotId = first.shots[0]?.id ?? null;
      this.selectedBoneId = first.shots[0]?.project?.bones[1]?.id ?? null;
      if (first.shots[0]?.project) this.frame = 0;
    }
  }

  // ---------------- 持久化 ----------------

  private load(): AppData {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return JSON.parse(raw) as AppData;
    } catch (e) {
      console.warn('读取本地数据失败，使用示例数据', e);
    }
    return seedData();
  }

  save(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.data));
    } catch (e) {
      console.warn('保存失败（存储空间不足？）', e);
    }
    this.emit('data');
  }

  // ---------------- 选择与播放 ----------------

  get order(): Order | null {
    return this.data.orders.find((o) => o.id === this.currentOrderId) ?? null;
  }

  get shot(): Shot | null {
    return this.order?.shots.find((s) => s.id === this.currentShotId) ?? null;
  }

  get project(): AnimProject | null {
    return this.shot?.project ?? null;
  }

  selectOrder(id: string): void {
    this.currentOrderId = id;
    const o = this.data.orders.find((x) => x.id === id);
    this.currentShotId = o?.shots[0]?.id ?? null;
    this.selectedBoneId = o?.shots[0]?.project?.bones[1]?.id ?? null;
    this.frame = 0;
    this.undoStack = [];
    this.redoStack = [];
    this.emit('selection');
  }

  selectShot(id: string): void {
    this.currentShotId = id;
    this.selectedBoneId = this.shot?.project?.bones[1]?.id ?? null;
    this.frame = 0;
    this.undoStack = [];
    this.redoStack = [];
    this.emit('selection');
  }

  selectBone(id: string | null): void {
    this.selectedBoneId = id;
    this.emit('selection');
  }

  setFrame(frame: number): void {
    const p = this.project;
    this.frame = p ? Math.max(0, Math.min(p.frameCount - 1, Math.round(frame))) : 0;
    this.emit('playhead');
  }

  setPlaying(playing: boolean): void {
    this.playing = playing;
    this.emit('playing');
  }

  setCamera(cam: Partial<typeof this.camera>): void {
    Object.assign(this.camera, cam);
    this.emit('camera');
  }

  setRendererKind(kind: 'webgpu' | 'canvas2d'): void {
    this.rendererKind = kind;
    this.emit('renderer');
  }

  // ---------------- 工程编辑（带撤销） ----------------

  /** 结构/姿势编辑前压栈 */
  pushUndo(): void {
    if (!this.shot?.project) return;
    this.undoStack.push(JSON.stringify(this.shot.project));
    if (this.undoStack.length > UNDO_LIMIT) this.undoStack.shift();
    this.redoStack = [];
  }

  mutateProject(fn: (p: AnimProject) => void): void {
    const p = this.project;
    if (!p) return;
    this.pushUndo();
    fn(p);
    this.save();
    this.emit('project');
  }

  undo(): void {
    const p = this.project;
    if (!p || this.undoStack.length === 0) return;
    this.redoStack.push(JSON.stringify(p));
    const snap = this.undoStack.pop()!;
    this.shot!.project = JSON.parse(snap);
    this.save();
    this.emit('project');
  }

  redo(): void {
    const p = this.project;
    if (!p || this.redoStack.length === 0) return;
    this.undoStack.push(JSON.stringify(p));
    const snap = this.redoStack.pop()!;
    this.shot!.project = JSON.parse(snap);
    this.save();
    this.emit('project');
  }

  // ---------------- 订单工作流（角色权限） ----------------

  private logOrder(order: Order, by: Role, action: string): void {
    const entry: HistoryEntry = { at: Date.now(), by, action };
    order.history.push(entry);
  }

  private logShot(shot: Shot, by: Role, action: string): void {
    shot.history.push({ at: Date.now(), by, action });
  }

  private assertRole(role: Role | Role[], action: string): void {
    const roles = Array.isArray(role) ? role : [role];
    if (!roles.includes(this.data.role)) throw new Error(`当前角色无权执行：${action}`);
  }

  createOrder(input: { title: string; client: string; note: string; deadline: number | null }): Order {
    this.assertRole('customer', '下单');
    const now = Date.now();
    const order: Order = {
      id: uid('ord'),
      title: input.title,
      client: input.client,
      note: input.note,
      deadline: input.deadline,
      createdAt: now,
      status: 'draft',
      reworkCount: 0,
      shots: [],
      history: [],
    };
    this.logOrder(order, 'customer', '客户下单');
    this.data.orders.unshift(order);
    this.save();
    return order;
  }

  createShot(orderId: string, name: string, deadline: number | null): Shot {
    this.assertRole(['customer', 'artist'], '创建镜头');
    const order = this.data.orders.find((o) => o.id === orderId)!;
    const shot: Shot = {
      id: uid('shot'),
      name,
      status: 'in_progress',
      reworkCount: 0,
      deadline,
      project: createDefaultProject(),
      history: [],
    };
    this.logShot(shot, this.data.role, '创建镜头并生成默认工程');
    order.shots.push(shot);
    if (order.status === 'draft') order.status = 'in_progress';
    this.save();
    return shot;
  }

  /** 制作员提交审核 */
  submitShot(shotId: string): void {
    this.assertRole('artist', '提交审核');
    const { order, shot } = this.resolve(shotId);
    shot.status = 'review';
    this.logShot(shot, 'artist', '提交主管审核');
    this.recomputeOrderStatus(order);
    this.save();
  }

  /** 主管审核退回（记录返工） */
  reworkShot(shotId: string, reason: string): void {
    this.assertRole('supervisor', '审核退回');
    const { order, shot } = this.resolve(shotId);
    shot.status = 'rework';
    shot.reworkCount += 1;
    order.reworkCount += 1;
    this.logShot(shot, 'supervisor', `审核退回：${reason}`);
    this.recomputeOrderStatus(order);
    this.save();
  }

  /** 主管审核通过 */
  approveShot(shotId: string): void {
    this.assertRole('supervisor', '审核通过');
    const { order, shot } = this.resolve(shotId);
    shot.status = 'done';
    this.logShot(shot, 'supervisor', '审核通过，可打包交付');
    this.recomputeOrderStatus(order);
    this.save();
  }

  /** 制作员返工后重新提交 */
  resubmitShot(shotId: string): void {
    this.assertRole('artist', '返工提交');
    const { order, shot } = this.resolve(shotId);
    shot.status = 'review';
    this.logShot(shot, 'artist', '返工完成，重新提交审核');
    this.recomputeOrderStatus(order);
    this.save();
  }

  markDelivered(orderId: string): void {
    this.assertRole(['supervisor', 'artist'], '打包交付');
    const order = this.data.orders.find((o) => o.id === orderId)!;
    if (!order.shots.every((s) => s.status === 'done')) {
      throw new Error('仍有镜头未通过审核，无法交付');
    }
    order.status = 'done';
    this.logOrder(order, this.data.role, '打包交付完成');
    this.save();
  }

  private resolve(shotId: string): { order: Order; shot: Shot } {
    const order = this.data.orders.find((o) => o.shots.some((s) => s.id === shotId));
    if (!order) throw new Error('找不到镜头所属订单');
    const shot = order.shots.find((s) => s.id === shotId)!;
    return { order, shot };
  }

  private recomputeOrderStatus(order: Order): void {
    if (order.shots.length === 0) { order.status = 'draft'; return; }
    if (order.shots.some((s) => s.status === 'rework')) order.status = 'rework';
    else if (order.shots.every((s) => s.status === 'done')) order.status = 'done';
    else if (order.shots.some((s) => s.status === 'review')) order.status = 'review';
    else order.status = 'in_progress';
  }
}

export const STATUS_LABEL: Record<OrderStatus | ShotStatus, string> = {
  draft: '待制作',
  in_progress: '制作中',
  review: '待审核',
  rework: '返工中',
  done: '已通过/交付',
};
