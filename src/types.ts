// 全局类型定义 —— 盐田矢量编辑器
export interface Pt {
  x: number;
  y: number;
}

/** 要素类型：纳潮渠(开放)、排淡沟(开放)、卤水池(闭合) */
export type FeatureKind = 'intake' | 'drain' | 'pool';
/** 开放路径 / 闭合路径 */
export type PathType = 'open' | 'closed';
/** 由偏移生成的双侧沟沿标记 */
export type FeatureRole = 'main' | 'bank';

export interface FeatureStyle {
  stroke: string;
  fill: string;
}

export interface Feature {
  id: string;
  name: string;
  kind: FeatureKind;
  pathType: PathType;
  role: FeatureRole;
  /** 顶点（闭合路径不含重复闭合点，渲染时自动闭合） */
  points: Pt[];
  /** 孔洞（仅闭合多边形支持，每个孔洞为独立点环） */
  holes: Pt[][];
  layerId: string;
  /** 设计宽度（米），开放路径用于双侧偏移与布尔缓冲 */
  width: number;
  /** 边坡比 m（水平/垂直），影响沟沿偏移距离 */
  slope: number;
  /** 设计深度（米），3D 参考底图拉伸用 */
  depth: number;
  /** 备注 */
  note: string;
  /** 若为沟沿等派生要素，记录源要素 id */
  sourceId?: string;
  visible: boolean;
  locked: boolean;
}

export interface Layer {
  id: string;
  name: string;
  color: string;
  visible: boolean;
  locked: boolean;
}

export type WorkStatus = 'pending' | 'in_progress' | 'rework' | 'submitted' | 'approved' | 'rejected';

export interface WorkEntry {
  id: string;
  title: string;
  kind: FeatureKind;
  featureIds: string[];
  status: WorkStatus;
  /** 返工次数 */
  reworkCount: number;
  /** 截止时间（ISO 字符串） */
  deadline: string;
  assignee: string;
  /** 审核意见（退回/通过） */
  reviewNote: string;
  createdAt: string;
  updatedAt: string;
}

export type Role = 'customer' | 'maker' | 'supervisor';

export interface Project {
  id: string;
  name: string;
  customer: string;
  createdAt: string;
  deadline: string;
  description: string;
}

export interface EditorState {
  project: Project;
  layers: Layer[];
  features: Feature[];
  entries: WorkEntry[];
  selectedIds: string[];
  activeLayerId: string;
  role: Role;
  currentTool: ToolType;
}

export type ToolType = 'select' | 'intake' | 'drain' | 'pool' | 'pan';

export type SnapType = 'endpoint' | 'midpoint' | 'horizontal' | 'vertical' | 'grid';

export interface SnapResult {
  point: Pt;
  type: SnapType;
  /** 对齐辅助线（水平/垂直吸附时使用） */
  guideLine?: { a: Pt; b: Pt };
}

export interface SelfIntersection {
  p: Pt;
  segA: [number, number];
  segB: [number, number];
}

export type BooleanOp = 'union' | 'difference' | 'intersection';

export interface DistanceLabel {
  from: Pt;
  to: Pt;
  distance: number;
}
