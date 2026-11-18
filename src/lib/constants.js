// 专业、舱室、标高、颜色等全局配置
export const PROFESSIONS = {
  water: { id: 'water', name: '给水', color: [0.20, 0.55, 0.95], bit: 0 },
  power: { id: 'power', name: '电力', color: [0.98, 0.75, 0.18], bit: 1 },
  comm: { id: 'comm', name: '通信', color: [0.36, 0.82, 0.45], bit: 2 },
  heat: { id: 'heat', name: '热力', color: [0.93, 0.42, 0.25], bit: 3 },
};

export const PROFESSION_LIST = Object.values(PROFESSIONS);

// 舱室：综合舱容纳给水/热力，电力舱、通信舱独立
export const CHAMBERS = {
  comp: { id: 'comp', name: '综合舱', width: 3.6, height: 3.2, floor: -8.0, professions: ['water', 'heat'] },
  power: { id: 'power', name: '电力舱', width: 2.6, height: 3.0, floor: -8.0, professions: ['power'] },
  comm: { id: 'comm', name: '通信舱', width: 2.2, height: 2.8, floor: -7.6, professions: ['comm'] },
};

export const CHAMBER_LIST = Object.values(CHAMBERS);

// 标高层（相对海平面的绝对标高，m，负值为地下）
export const LEVELS = [
  { id: 'L-3.5', name: '上层 · 标高 -3.50', elev: -3.5 },
  { id: 'L-5.5', name: '中层 · 标高 -5.50', elev: -5.5 },
  { id: 'L-7.0', name: '下层 · 标高 -7.00', elev: -7.0 },
];

// 每个专业占用的舱室与标高层
export const PROFESSION_LAYOUT = {
  water: { chamber: 'comp', level: 'L-7.0', radius: 0.22 },
  heat: { chamber: 'comp', level: 'L-3.5', radius: 0.20 },
  power: { chamber: 'power', level: 'L-5.5', radius: 0.12 },
  comm: { chamber: 'comm', level: 'L-5.5', radius: 0.08 },
};

export const CELL_SIZE = 10; // 空间分 Cell 尺寸（m），裁剪与缓冲组织单元
export const GALLERY_LENGTH = 1200; // 管廊总长（m）
export const LOD = {
  FAR: 0,   // 仅主廊结构 + 干管
  MID: 1,   // + 支管
  NEAR: 2,  // + 支架/附件
};

// 摄像机距离 -> LOD 阈值
export const LOD_DISTANCE = [90, 45]; // >90 FAR; 45~90 MID; <45 NEAR

// 图层树 bit 位分配：专业 4 位 + 舱室 3 位 + 标高 3 位
export const LAYER_BITS = {
  profession: { water: 1 << 0, power: 1 << 1, comm: 1 << 2, heat: 1 << 3 },
  chamber: { comp: 1 << 4, power: 1 << 5, comm: 1 << 6 },
  level: { 'L-3.5': 1 << 7, 'L-5.5': 1 << 8, 'L-7.0': 1 << 9 },
};
export const ALL_LAYER_MASK = 0x3ff; // 10 位全开
