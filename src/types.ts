// 全局类型定义

/** 设施类型 */
export type FacilityType = 'gasCabinet' | 'fumeHood' | 'eyeWash' | 'pipeline';

/** 图层分组（消防 / 气防 / 危化品 / 水电） */
export type LayerGroup = 'fire' | 'gas' | 'chem' | 'util';

/** 角色 */
export type Role = 'teacher' | 'student';

/** 单体设施 */
export interface Facility {
  id: string;
  /** 设备编号，如 F3-GC-0218 */
  code: string;
  type: FacilityType;
  group: LayerGroup;
  building: string;
  floor: number;
  roomId: string;
  roomName: string;
  /** 平面图世界坐标（米） */
  x: number;
  y: number;
  /** 同编号关联设备（同一套系统，如通风橱与配套管线） */
  linkedCode: string;
  /** 管线专用：折线路径点 */
  path?: { x: number; y: number }[];
  spec: string;
  status: '正常' | '待检' | '停用';
  installDate: string;
}

/** 房间 */
export interface Room {
  id: string;
  name: string;
  building: string;
  floor: number;
  x: number;
  y: number;
  w: number;
  h: number;
  usage: string;
}

/** 楼层信息 */
export interface FloorInfo {
  building: string;
  floor: number;
  label: string;
}

export interface BuildingData {
  name: string;
  floors: number;
  rooms: Room[];
  facilities: Facility[];
  floorList: FloorInfo[];
}

/** 聚合块（楼栋级同层同类合并） */
export interface Cluster {
  key: string;
  type: FacilityType;
  group: LayerGroup;
  floor: number;
  x: number;
  y: number;
  count: number;
  ids: string[];
}

/** 视口状态 */
export interface ViewState {
  /** 世界坐标中心 */
  cx: number;
  cy: number;
  /** 正交相机半高（世界单位/米） */
  halfH: number;
  floor: number;
}

/** 图层可见性 */
export type LayerVisibility = Record<LayerGroup, boolean>;

/** 识图题目 */
export interface QuizQuestion {
  id: string;
  type: FacilityType;
  /** 要求点选数量 */
  count: number;
  floor: number;
  /** 标准答案（设施 id 集合） */
  answerIds: string[];
  /** 题目说明 */
  label: string;
}

/** 学员单题作答 */
export interface AnswerRecord {
  questionId: string;
  pickedIds: string[];
  /** 系统自动判定：坐标+类型命中数 */
  autoCorrect: number;
  /** 老师复核后的最终得分（满分=count） */
  finalScore: number | null;
  /** 老师复核备注 */
  reviewNote: string;
  reviewed: boolean;
}

export interface QuizPaper {
  id: string;
  title: string;
  createdBy: string;
  createdAt: number;
  questions: QuizQuestion[];
  /** 班级 -> 学员 -> 作答 */
  submissions: Record<string, Record<string, AnswerRecord[]>>;
}

export const GROUP_META: Record<LayerGroup, { name: string; color: string }> = {
  fire: { name: '消防', color: '#ef4444' },
  gas: { name: '气防', color: '#f59e0b' },
  chem: { name: '危化品', color: '#a855f7' },
  util: { name: '水电', color: '#3b82f6' }
};

export const TYPE_META: Record<FacilityType, { name: string; short: string; group: LayerGroup; color: string }> = {
  gasCabinet: { name: '气瓶柜', short: '气', group: 'gas', color: '#f59e0b' },
  fumeHood: { name: '通风橱', short: '通', group: 'chem', color: '#a855f7' },
  eyeWash: { name: '洗眼器', short: '洗', group: 'fire', color: '#ef4444' },
  pipeline: { name: '管线', short: '管', group: 'util', color: '#3b82f6' }
};

/** 命中优先级：同位置叠放时按楼层和类别优先级命中 */
export const TYPE_PRIORITY: Record<FacilityType, number> = {
  eyeWash: 4,
  gasCabinet: 3,
  fumeHood: 2,
  pipeline: 1
};
