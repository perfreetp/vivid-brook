// ============================================================
// 核心数据类型定义
// ============================================================

export interface Vec2 { x: number; y: number }

/** 铰点(关节)旋转限位，单位：度，采用最小夹角比较，null 表示不限 */
export interface AngleLimit {
  min: number | null;
  max: number | null;
}

/** 骨骼：父子关系构成骨架树，restAngle 为装配姿态下的局部角(度)，length 为像素长度 */
export interface Bone {
  id: string;
  name: string;
  parentId: string | null;
  start: Vec2;          // 局部坐标系下骨骼起点（根骨骼即世界坐标）
  length: number;
  restAngle: number;    // 度，局部
  limit: AngleLimit;
}

export type PartType = 'panel' | 'link' | 'joint';

/** 独立部件：床板 / 连杆 / 铰点，逐个绑定到骨骼 */
export interface Part {
  id: string;
  name: string;
  type: PartType;
  boneId: string;       // 绑定的骨骼
  color: string;        // #rrggbb
  // panel / link 的几何（部件局部坐标，原点在绑定骨骼起点，x 轴沿骨骼方向）
  length: number;
  thickness: number;
  offsetX: number;
  offsetY: number;
  radius?: number;      // joint 用
}

export type EasingKind = 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out' | 'custom';

/** 关键帧：记录某帧上某骨骼的局部绝对角度（度）与缓动设置 */
export interface Keyframe {
  frame: number;
  angle: number;
  easing: EasingKind;
  /** custom 模式下的切线（角度/帧），决定进入/离开该帧的斜率 */
  inTangent: number;
  outTangent: number;
}

/** 动作段：展开 / 收拢 */
export interface Segment {
  id: string;
  name: string;
  startFrame: number;
  endFrame: number;
  color: string;
}

/** 一个镜头/动画工程的完整数据 */
export interface AnimProject {
  version: number;
  name: string;
  fps: number;
  frameCount: number;
  canvasW: number;
  canvasH: number;
  bones: Bone[];
  parts: Part[];
  /** 每根骨骼一条关键帧轨道 */
  tracks: Record<string, Keyframe[]>;
  segments: Segment[];
}

// ---------------- 订单工作流 ----------------

export type Role = 'customer' | 'artist' | 'supervisor';

export type OrderStatus =
  | 'draft'        // 客户刚下单
  | 'in_progress'  // 制作中
  | 'review'       // 待主管审核
  | 'rework'       // 审核退回
  | 'done';        // 通过并打包交付

export type ShotStatus = OrderStatus;

export interface HistoryEntry {
  at: number;
  by: Role;
  action: string;
}

export interface Shot {
  id: string;
  name: string;
  status: ShotStatus;
  reworkCount: number;
  deadline: number | null;      // epoch ms
  project: AnimProject | null;
  history: HistoryEntry[];
}

export interface Order {
  id: string;
  title: string;
  client: string;
  createdAt: number;
  deadline: number | null;
  status: OrderStatus;
  reworkCount: number;
  note: string;
  shots: Shot[];
  history: HistoryEntry[];
}

export interface AppData {
  version: number;
  role: Role;
  orders: Order[];
}

// ---------------- 渲染器 ----------------

export type PrimitiveType = 'line' | 'circle' | 'rect' | 'poly';

export interface RenderPrimitive {
  type: PrimitiveType;
  color: string;       // #rrggbb
  fill: boolean;
  width?: number;      // line 宽度
  // line / poly
  points?: Vec2[];
  // circle
  center?: Vec2;
  radius?: number;
  // rect（轴对齐，世界坐标）
  x?: number; y?: number; w?: number; h?: number;
}

export interface Camera {
  panX: number; panY: number; zoom: number;
}

export interface BoneWorld {
  bone: Bone;
  worldAngle: number;   // 度
  start: Vec2;          // 世界坐标
  end: Vec2;
  depth: number;
  /** 当前实际局部角与限位的关系 */
  overLimit: boolean;
  localAngle: number;
}

export interface EvaluatedScene {
  bones: BoneWorld[];
  byId: Map<string, BoneWorld>;
  frame: number;
}
