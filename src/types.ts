// 全局共享类型定义

/** 过程式生成参数：坡度档位 / 台阶高度 / 碎石密度 / 沟槽宽度 / 涉水深度 */
export interface TerrainParams {
  /** 坡度档位 0..5，对应 0%、5%、10%、15%、20%、25% */
  slopeGrade: number;
  /** 台阶高度，单位米，0 表示关闭台阶带 */
  stepHeight: number;
  /** 碎石密度 0..1，0 表示关闭碎石带 */
  gravelDensity: number;
  /** 沟槽宽度，单位米，0 表示关闭沟槽带 */
  trenchWidth: number;
  /** 涉水深度，单位米，0 表示关闭涉水带 */
  waterDepth: number;
}

export interface ChunkMeta {
  id: number;
  /** 受哪些参数特征影响（slope/step/gravel/trench/water），空数组表示只有基础起伏 */
  tags: string[];
  /** 锁定后不会被重新生成覆盖 */
  locked: boolean;
  /** 是否经过手动塑形（自动锁定） */
  sculpted: boolean;
  /** 最近一次生成耗时 ms（含边界过渡） */
  genMs: number;
}

export type OrderStatus = 'pending' | 'modeling' | 'qc' | 'passed' | 'rejected' | 'done';

export interface TerrainSnapshot {
  /** 量化到毫米的高度，Int16Array 长度 V*V，h_m = q/1000 */
  heights: number[];
  locked: boolean[];
  chunks: ChunkMeta[];
  checksum: string;
}

export interface FieldOrder {
  id: string;
  title: string;
  requirement: string;
  seed: number;
  params: TerrainParams;
  status: OrderStatus;
  createdBy: string;
  assignee: string | null;
  createdAt: number;
  updatedAt: number;
  /** 返工（打回）次数 */
  reworkCount: number;
  history: OrderEvent[];
  /** 建模员提交的快照 */
  submittedSnapshot: TerrainSnapshot | null;
  /** 质检最近一次重跑结果 */
  qcResult: QcResult | null;
}

export interface OrderEvent {
  at: number;
  user: string;
  action: string;
  detail?: string;
}

export interface QcResult {
  at: number;
  user: string;
  passed: boolean;
  /** 解锁区块重跑比对一致的数量 / 参与比对的数量 */
  matchedChunks: number;
  totalChunks: number;
  /** 每个区块的哈希，便于定位差异 */
  chunkHashes: Record<string, string>;
  expectedHashes: Record<string, string>;
  detail: string;
}

export interface UserProfile {
  name: string;
  role: 'sales' | 'modeler' | 'qc';
  label: string;
}
