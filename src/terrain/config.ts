// 场地常量：40m 见方，64x64 格网（2.5m 区块，每区块 4x4 单元 / 5x5 顶点）
export const FIELD_SIZE = 40; // 米
export const GRID = 64; // 每边单元数
export const VERTS = GRID + 1; // 每边顶点数 65
export const CHUNK_CELLS = 4; // 每区块单元数
export const CHUNKS_PER_SIDE = GRID / CHUNK_CELLS; // 16
export const CHUNK_COUNT = CHUNKS_PER_SIDE * CHUNKS_PER_SIDE; // 256
export const CELL = FIELD_SIZE / GRID; // 0.625m
export const CHUNK_SIZE = CELL * CHUNK_CELLS; // 2.5m
export const TRIS_PER_CHUNK = CHUNK_CELLS * CHUNK_CELLS * 2; // 32
export const SCULPT_RADIUS_CELLS = 3;

/** 坡度档位 -> 坡度百分比（tan） */
export const SLOPE_GRADE_RATIOS = [0, 0.05, 0.1, 0.15, 0.2, 0.25];
export const SLOPE_GRADE_LABELS = ['平地', '5% (2.9°)', '10% (5.7°)', '15% (8.5°)', '20% (11.3°)', '25% (14.0°)'];

/** 特征带在世界坐标 z 方向的布局（互不重叠，各 8m 宽） */
export const BANDS = {
  slope: { z0: 0, z1: 8 },
  step: { z0: 8, z1: 16 },
  gravel: { z0: 16, z1: 24 },
  trench: { z0: 24, z1: 32 },
  water: { z0: 32, z1: 40 },
} as const;

export const FEATURE_KEYS = ['slope', 'step', 'gravel', 'trench', 'water'] as const;
export type FeatureKey = (typeof FEATURE_KEYS)[number];

export function featureEnabled(key: FeatureKey, p: {
  slopeGrade: number; stepHeight: number; gravelDensity: number; trenchWidth: number; waterDepth: number;
}): boolean {
  switch (key) {
    case 'slope': return p.slopeGrade > 0;
    case 'step': return p.stepHeight > 0;
    case 'gravel': return p.gravelDensity > 0;
    case 'trench': return p.trenchWidth > 0;
    case 'water': return p.waterDepth > 0;
  }
}
