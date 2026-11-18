import { createSignal, createMemo, createRoot } from 'solid-js';
import { createStore, produce } from 'solid-js/store';
import { ALL_LAYER_MASK, LAYER_BITS } from './lib/constants';
import { buildModel, planEdits } from './lib/model';

const LS_VERSIONS = 'ugr.versions.v1';
const LS_ANNOTATIONS = 'ugr.annotations.v1';
const LS_UI = 'ugr.ui.v1';
const BASE_SEED = 20261119;

function load(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}
function save(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* 配额满时静默 */ }
}

// ---------- 版本 ----------
const seedVersions = () => {
  const v1 = { vid: 1, name: 'V1 初版出图', createdAt: '2026-11-10 09:20', note: '管廊机电综合初版，四专业管线入廊', seed: BASE_SEED, edits: [] };
  const base = buildModel(v1);
  const v2 = {
    vid: 2, name: 'V2 深化修订', createdAt: '2026-11-14 15:42',
    note: '局部给水管径调整，支管避让综合支架，增设两处闸阀',
    seed: BASE_SEED, edits: planEdits(2, base.groups, BASE_SEED),
  };
  return [v1, v2];
};

const [versions, setVersions] = createStore(load(LS_VERSIONS, null) ?? seedVersions());
const [currentVid, setCurrentVid] = createSignal(load(LS_UI, {}).currentVid ?? 2);

// ---------- 批注 ----------
const seedAnnotations = () => [
  {
    id: 'a1', vid: 2, x: 60, y: -7.0, z: -0.75,
    author: '审核人·王工', text: '此处给水管与热力支管净距不足 0.3m，请复核碰撞。',
    createdAt: '2026-11-15 10:02', status: 'open',
    replies: [{ author: '制作方·李工', text: '已调整该段热力支管走向，净距改为 0.45m，见 V3。', at: '2026-11-15 16:20', status: 'replied' }],
  },
  {
    id: 'a2', vid: 2, x: 120, y: -5.5, z: -4.15,
    author: '审核人·王工', text: '电力排管支架间距偏大，建议加密至 2m 一副。',
    createdAt: '2026-11-15 11:18', status: 'replied',
    replies: [{ author: '制作方·李工', text: '按规范加密，下一版更新模型。', at: '2026-11-15 17:05', status: 'replied' }],
  },
  {
    id: 'a3', vid: 2, x: 200, y: -3.5, z: 0.75,
    author: '审核人·赵工', text: '热力回水管阀门操作空间被横梁占用，请调整横梁标高。',
    createdAt: '2026-11-16 09:40', status: 'open', replies: [],
  },
];
const [annotations, setAnnotations] = createStore(load(LS_ANNOTATIONS, null) ?? seedAnnotations());

// ---------- 图层 ----------
const [layerMask, setLayerMask] = createSignal(ALL_LAYER_MASK);
const toggleBits = (bits) => setLayerMask((m) => (m & bits) ? (m & ~bits) : (m | bits));

// ---------- 剖切 / 选中 / 悬停 / LOD ----------
const [sliceX, setSliceX] = createSignal(null);
const [selectedId, setSelectedId] = createSignal(null);
const [hoveredId, setHoveredId] = createSignal(null);
const [lodLevel, setLodLevel] = createSignal(0);
const [stats, setStats] = createSignal({ drawn: 0, cells: 0, instances: 0, fps: 0 });
const [annotateMode, setAnnotateMode] = createSignal(false);

// ---------- 持久化 ----------
function persist() {
  save(LS_VERSIONS, versions);
  save(LS_ANNOTATIONS, annotations);
  save(LS_UI, { currentVid: currentVid() });
}

// ---------- 动作 ----------
let nextVid = Math.max(0, ...versions.map((v) => v.vid)) + 1;

export function submitVersion(note) {
  const prev = versions.find((v) => v.vid === currentVid());
  const baseModel = buildModel(prev);
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
  const v = {
    vid: nextVid, name: `V${nextVid} 出图修订`, createdAt: stamp,
    note: note || '出图提交', seed: BASE_SEED,
    edits: planEdits(nextVid, baseModel.groups, BASE_SEED),
  };
  nextVid++;
  setVersions(versions.length, v);
  setCurrentVid(v.vid);
  setSelectedId(null);
  persist();
  return v;
}

export function switchVersion(vid) {
  setCurrentVid(vid);
  setSelectedId(null);
  persist();
}

export function addAnnotation(worldPos, text, author = '审核人·王工') {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const ann = {
    id: `a${Date.now()}`, vid: currentVid(),
    x: +worldPos[0].toFixed(2), y: +worldPos[1].toFixed(2), z: +worldPos[2].toFixed(2),
    author, text, createdAt: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`,
    status: 'open', replies: [],
  };
  setAnnotations(annotations.length, ann);
  persist();
  return ann;
}

export function replyAnnotation(annId, text, author = '制作方·李工') {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  setAnnotations(
    (a) => a.id === annId,
    produce((a) => {
      a.replies.push({
        author, text,
        at: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`,
        status: 'replied',
      });
      a.status = 'replied';
    }),
  );
  persist();
}

export function setAnnotationStatus(annId, status) {
  setAnnotations((a) => a.id === annId, 'status', status);
  persist();
}

export function resetData() {
  localStorage.removeItem(LS_VERSIONS);
  localStorage.removeItem(LS_ANNOTATIONS);
  location.reload();
}

export const currentModel = createRoot(() => createMemo(() => buildModel(versions.find((v) => v.vid === currentVid()))));
export const currentAnnotations = createRoot(() => createMemo(() => annotations.filter((a) => a.vid === currentVid())));

export const ui = {
  versions, currentVid, annotations, currentAnnotations, currentModel,
  layerMask, toggleBits, sliceX, setSliceX,
  selectedId, setSelectedId, hoveredId, setHoveredId,
  lodLevel, setLodLevel, stats, setStats, annotateMode, setAnnotateMode,
  LAYER_BITS,
  submitVersion, switchVersion, addAnnotation, replyAnnotation, setAnnotationStatus, resetData,
};
