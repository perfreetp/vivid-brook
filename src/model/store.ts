// ---------- 全局状态: 方案数据(持久化) + UI 状态 ----------

import { createStore } from 'solid-js/store';
import { createSignal } from 'solid-js';
import type { SceneState, Status, ReviewComment, Role, LightType, Building, Light, Block } from './types';
import { LIGHT_PRESETS, uid, nowStr } from './types';
import type { LightingResult, EnvParams } from '../engine/lighting';

export interface PersistState {
  scene: SceneState;
  status: Status;
  comments: ReviewComment[];
}

// ---------- 示例方案 ----------
function rect(x: number, y: number, w: number, h: number) {
  return [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }];
}

function demoScene(): SceneState {
  const buildings: Building[] = [
    { id: uid(), name: '沿街商铺A', floors: 2, polygon: rect(52, 34, 30, 10) },
    { id: uid(), name: '沿街商铺B', floors: 2, polygon: rect(88, 34, 26, 10) },
    { id: uid(), name: '转角楼', floors: 3, polygon: rect(120, 34, 24, 12) },
    { id: uid(), name: '民居1', floors: 2, polygon: rect(56, 58, 18, 12) },
    { id: uid(), name: '民居2', floors: 3, polygon: rect(82, 58, 16, 12) },
    { id: uid(), name: '民居3', floors: 2, polygon: rect(120, 60, 20, 12) },
    { id: uid(), name: '祠堂', floors: 1, polygon: rect(146, 58, 16, 14) },
    { id: uid(), name: '民居4', floors: 2, polygon: rect(58, 92, 22, 12) },
    { id: uid(), name: '民居5', floors: 2, polygon: rect(96, 94, 18, 12) },
    { id: uid(), name: '社区用房', floors: 4, polygon: rect(136, 92, 26, 14) },
  ];
  const lights: Light[] = [
    { id: uid(), type: 'street', name: '路灯1', pos: { x: 60, y: 50 }, ...LIGHT_PRESETS.street, on: true },
    { id: uid(), type: 'street', name: '路灯2', pos: { x: 110, y: 50 }, ...LIGHT_PRESETS.street, on: true },
    { id: uid(), type: 'street', name: '路灯3', pos: { x: 155, y: 50 }, ...LIGHT_PRESETS.street, on: true },
    { id: uid(), type: 'street', name: '路灯4', pos: { x: 90, y: 82 }, ...LIGHT_PRESETS.street, on: true },
    { id: uid(), type: 'courtyard', name: '庭院灯1', pos: { x: 108, y: 78 }, ...LIGHT_PRESETS.courtyard, on: true },
    { id: uid(), type: 'courtyard', name: '庭院灯2', pos: { x: 124, y: 82 }, ...LIGHT_PRESETS.courtyard, on: true },
    { id: uid(), type: 'wall', name: '洗墙灯1', pos: { x: 154, y: 76 }, ...LIGHT_PRESETS.wall, on: true },
    { id: uid(), type: 'wall', name: '洗墙灯2', pos: { x: 67, y: 48 }, ...LIGHT_PRESETS.wall, on: true },
  ];
  const blocks: Block[] = [
    { id: uid(), name: '东街街坊', polygon: rect(44, 28, 128, 88) },
  ];
  return { buildings, lights, blocks, annotations: [] };
}

function loadPersist(): PersistState {
  try {
    const raw = localStorage.getItem('heritage-light-v1');
    if (raw) {
      const p = JSON.parse(raw);
      if (p && p.scene && Array.isArray(p.scene.buildings)) return p;
    }
  } catch (e) { /* ignore */ }
  return { scene: demoScene(), status: 'draft', comments: [] };
}

const initial = loadPersist();

export const [store, setStore] = createStore<PersistState>(initial);

let saveTimer: any = null;
export function persist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem('heritage-light-v1', JSON.stringify({
        scene: store.scene, status: store.status, comments: store.comments,
      }));
    } catch (e) { /* ignore */ }
  }, 400);
}

export function resetDemo() {
  setStore({ scene: demoScene(), status: 'draft', comments: [] });
  persist();
}

// ---------- UI 状态 ----------
export type Tool = 'select' | 'draw-building' | 'draw-block' | 'add-street' | 'add-courtyard' | 'add-wall' | 'annotate';

export const [tool, setTool] = createSignal<Tool>('select');
export const [role, setRole] = createSignal<Role>('planner');
export const [selectedId, setSelectedId] = createSignal<string | null>(null);
export const [selectedKind, setSelectedKind] = createSignal<'building' | 'light' | 'block' | null>(null);

export const [env, setEnv] = createSignal<EnvParams>({ date: 'summer', hour: 20, latitude: 31.3 });
export const [exposure, setExposure] = createSignal(1.0);
export const [gamma, setGamma] = createSignal(2.2);

export const [layers, setLayers] = createStore({
  buildings: true, spots: true, heat: false, grid: true, blocks: true, annotations: true, values: true,
});

export const [result, setResult] = createSignal<LightingResult | null>(null);
export const [draftPoints, setDraftPoints] = createSignal<{ x: number; y: number }[]>([]);
export const [annotText, setAnnotText] = createSignal('');
export const [reviewText, setReviewText] = createSignal('');
export const [computing, setComputing] = createSignal(false);

// 是否可编辑场景
export function editable(): boolean {
  return store.status === 'draft' && role() === 'planner';
}

export function addComment(text: string, action: string) {
  const author = { planner: '规划员', reviewer: '审查人', public: '公众' }[role()];
  setStore('comments', store.comments.length, { id: uid(), text, author, time: nowStr(), action });
  persist();
}
