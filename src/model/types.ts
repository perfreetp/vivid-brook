// ---------- 基础数据模型 ----------

export interface Vec {
  x: number; // 米, 向东为正
  y: number; // 米, 向南为正(屏幕坐标)
}

export interface Building {
  id: string;
  name: string;
  polygon: Vec[]; // 建筑轮廓(俯视)
  floors: number; // 层数, 层高 3m
}

export type LightType = 'street' | 'courtyard' | 'wall';

export interface Light {
  id: string;
  type: LightType;
  name: string;
  pos: Vec;
  height: number;    // 挂高 m
  radius: number;    // 作用半径 m
  kelvin: number;    // 色温 K
  intensity: number; // 光强(任意标定, 与照度换算见引擎)
  on: boolean;
}

export interface Block {
  id: string;
  name: string;
  polygon: Vec[];
}

export interface Annotation {
  id: string;
  pos: Vec;
  text: string;
  author: string;
  time: string;
}

export interface ReviewComment {
  id: string;
  text: string;
  author: string;
  time: string;
  action: string; // 提交送审 / 退回 / 通过并公示 ...
}

export type Status = 'draft' | 'review' | 'published';
export type Role = 'planner' | 'reviewer' | 'public';

export interface SceneState {
  buildings: Building[];
  lights: Light[];
  blocks: Block[];
  annotations: Annotation[];
}

export const LIGHT_PRESETS: Record<LightType, { label: string; height: number; radius: number; kelvin: number; intensity: number; size: number }> = {
  street:    { label: '路灯',   height: 6,   radius: 18, kelvin: 3000, intensity: 2600, size: 0.4 },
  courtyard: { label: '庭院灯', height: 3.5, radius: 11, kelvin: 2700, intensity: 1000, size: 0.25 },
  wall:      { label: '洗墙灯', height: 4,   radius: 9,  kelvin: 3000, intensity: 1300, size: 0.6 },
};

export const LIGHT_TYPE_LABEL: Record<LightType, string> = {
  street: '路灯', courtyard: '庭院灯', wall: '洗墙灯',
};

export const STATUS_LABEL: Record<Status, string> = {
  draft: '草稿', review: '送审中', published: '公示',
};

export const ROLE_LABEL: Record<Role, string> = {
  planner: '规划员', reviewer: '审查人', public: '公众',
};

export function uid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

export function nowStr(): string {
  return new Date().toLocaleString('zh-CN', { hour12: false });
}
