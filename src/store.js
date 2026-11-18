// 全局状态:图元 / 选择 / 历史(50步,可跳转任意节点) / 版本 / 批注
import { createStore, produce } from 'solid-js/store';
import { createMemo, createRoot } from 'solid-js';
import { makeEntity, decorate, serialize, deserialize, worldGeom, KINDS } from './entities';
import { union, difference, intersection, mirrorMP, rotateMP, uid } from './geometry';

const HISTORY_LIMIT = 50;
const LS_KEY = 'gating-editor-v1';

function emptyDoc() {
  return { entities: {}, order: [] };
}

function loadInitial() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      const s = JSON.parse(raw);
      return s;
    }
  } catch { /* ignore */ }
  return null;
}

const saved = loadInitial();

export const [state, setState] = createStore({
  doc: saved?.doc ?? emptyDoc(),
  selection: [],
  tool: 'select',            // select | annotate | edgeArray
  snap: { grid: true, endpoint: true, midpoint: true, guides: true },
  gridPitch: 25,             // 模架螺孔网格 mm
  demoldAngle: 0,            // 脱模方向(绕Z)
  history: saved?.history ?? [{ label: '初始', doc: emptyDoc() }],
  hIndex: saved?.hIndex ?? 0,
  versions: saved?.versions ?? [],
  annotations: saved?.annotations ?? [],
  compare: null,             // { a, b }
  preview3d: true,
  reviewOpen: true,
});

// ---------- 派生 ----------
export const { entityList, selectedEntities } = createRoot(() => {
  const entityList = createMemo(() =>
    state.doc.order.map((id) => state.doc.entities[id]).filter(Boolean).map(decorate)
  );
  const selectedEntities = createMemo(() =>
    entityList().filter((e) => state.selection.includes(e.id))
  );
  return { entityList, selectedEntities };
});

// ---------- 历史 ----------
function snapshotDoc() {
  return JSON.parse(JSON.stringify({ entities: state.doc.entities, order: state.doc.order }));
}

export function commit(label) {
  setState(produce((s) => {
    // 截掉 redo 分支
    s.history = s.history.slice(0, s.hIndex + 1);
    s.history.push({ label, doc: snapshotDoc() });
    if (s.history.length > HISTORY_LIMIT + 1) s.history.shift();
    s.hIndex = s.history.length - 1;
  }));
  persist();
}

export function jumpHistory(i) {
  const h = state.history[i];
  if (!h) return;
  setState(produce((s) => {
    s.hIndex = i;
    s.doc = JSON.parse(JSON.stringify(h.doc));
    s.selection = [];
  }));
  persist();
}

export const undo = () => jumpHistory(Math.max(0, state.hIndex - 1));
export const redo = () => jumpHistory(Math.min(state.history.length - 1, state.hIndex + 1));

// ---------- 图元操作(每次操作后 commit) ----------
export function addEntity(kind, x, y) {
  const e = makeEntity(kind, x, y);
  setState(produce((s) => {
    s.doc.entities[e.id] = serialize(e);
    s.doc.order.push(e.id);
    s.selection = [e.id];
  }));
  commit(`添加${KINDS[kind].name}`);
  return e.id;
}

export function updateEntity(id, patch, label = '修改图元', doCommit = true) {
  setState(produce((s) => {
    const cur = s.doc.entities[id];
    if (!cur) return;
    Object.assign(cur, JSON.parse(JSON.stringify(patch)));
  }));
  if (doCommit) commit(label);
}

export function moveEntities(ids, dx, dy, label = '移动') {
  setState(produce((s) => {
    for (const id of ids) {
      const e = s.doc.entities[id];
      if (!e || e.locked) continue;
      e.x += dx; e.y += dy;
      if (e.kind === 'composite') e.geom = translateMP(e.geom, dx, dy);
    }
  }));
  commit(label);
}

function translateMP(mp, dx, dy) {
  return mp.map((poly) => poly.map((ring) => ring.map(([x, y]) => [x + dx, y + dy])));
}

export function deleteSelected() {
  if (!state.selection.length) return;
  setState(produce((s) => {
    for (const id of state.selection) delete s.doc.entities[id];
    s.doc.order = s.doc.order.filter((id) => s.doc.entities[id]);
    s.selection = [];
  }));
  commit('删除图元');
}

// ---------- 布尔运算 ----------
export function booleanOp(op) {
  const sel = selectedEntities();
  if (sel.length < 2) return alert('请先选中至少两个图元');
  const geoms = sel.map((e) => e.geomWorld);
  let result;
  try {
    if (op === 'union') result = union(...geoms.map((g) => g));
    else if (op === 'subtract') result = difference(geoms[0], ...geoms.slice(1));
    else result = intersection(...geoms.map((g) => g));
  } catch (err) {
    return alert('布尔运算失败: ' + err.message);
  }
  if (!result || !result.length) return alert('结果为空');
  const b = { x0: Infinity, y0: Infinity };
  for (const poly of result) for (const [x, y] of poly[0]) {
    if (x < b.x0) b.x0 = x;
    if (y < b.y0) b.y0 = y;
  }
  const comp = makeEntity('composite', 0, 0, {
    geom: result,
    boolOp: op,
    // 记录来源,便于"拆开"
    sources: sel.map((e) => serialize(e)),
    params: { height: Math.max(...sel.map((e) => KINDS[e.kind].height)) },
  });
  setState(produce((s) => {
    for (const e of sel) delete s.doc.entities[e.id];
    s.doc.order = s.doc.order.filter((id) => s.doc.entities[id]);
    s.doc.entities[comp.id] = serialize(comp);
    s.doc.order.push(comp.id);
    s.selection = [comp.id];
  }));
  commit({ union: '并集', subtract: '差集', intersect: '交集' }[op]);
}

// 搭接流道合成一整条
export function mergeRunners() {
  const sel = selectedEntities().filter((e) => ['runner', 'sprue', 'fanGate', 'composite'].includes(e.kind));
  if (sel.length < 2) return alert('请选中至少两个流道类图元(主流道/分流道/扇形浇口)');
  booleanOp('union');
}

// 镶件挖让位孔:选中 1 个镶件 + N 个孔形(顶针/水路等),差集,原镶件保留为隐藏参考
export function punchInsert() {
  const sel = selectedEntities();
  const insert = sel.find((e) => e.kind === 'insert');
  const tools = sel.filter((e) => e.id !== insert?.id);
  if (!insert || !tools.length) return alert('请同时选中一个镶件和至少一个让位孔图元(顶针/水路等)');
  let result;
  try {
    result = difference(insert.geomWorld, ...tools.map((t) => t.geomWorld));
  } catch (err) {
    return alert('挖孔失败: ' + err.message);
  }
  if (!result?.length) return alert('结果为空');
  const comp = makeEntity('composite', 0, 0, {
    geom: result,
    boolOp: 'subtract',
    sources: [serialize(insert), ...tools.map(serialize)],
    params: { height: KINDS.insert.height },
    keepsOutline: true,
  });
  setState(produce((s) => {
    // 原镶件保留为隐藏参考(保留原外轮廓)
    const ref = s.doc.entities[insert.id];
    ref.hidden = true;
    for (const t of tools) delete s.doc.entities[t.id];
    s.doc.order = s.doc.order.filter((id) => s.doc.entities[id]);
    s.doc.entities[comp.id] = serialize(comp);
    s.doc.order.push(comp.id);
    s.selection = [comp.id];
  }));
  commit('镶件挖让位孔');
}

// 布尔结果拆开:恢复来源图元,可单独再改
export function splitComposite() {
  const sel = selectedEntities().filter((e) => e.kind === 'composite' && e.sources);
  if (!sel.length) return alert('请选中一个布尔结果图元');
  setState(produce((s) => {
    for (const comp of sel) {
      for (const src of comp.sources) {
        const ne = { ...JSON.parse(JSON.stringify(src)), id: uid(src.kind.slice(0, 3)), hidden: false };
        s.doc.entities[ne.id] = ne;
        s.doc.order.push(ne.id);
      }
      delete s.doc.entities[comp.id];
    }
    s.doc.order = s.doc.order.filter((id) => s.doc.entities[id]);
    s.selection = [];
  }));
  commit('拆开布尔结果');
}

// ---------- 镜像 / 环形阵列 ----------
export function mirrorSelected(axis) {
  const sel = selectedEntities();
  if (!sel.length) return;
  // 以选集包围盒中心为镜像轴
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const e of sel) {
    x0 = Math.min(x0, e.bounds.x0); x1 = Math.max(x1, e.bounds.x1);
    y0 = Math.min(y0, e.bounds.y0); y1 = Math.max(y1, e.bounds.y1);
  }
  const pivot = axis === 'h' ? (x0 + x1) / 2 : (y0 + y1) / 2;
  setState(produce((s) => {
    for (const e of sel) {
      const cur = s.doc.entities[e.id];
      if (cur.kind === 'composite') {
        cur.geom = mirrorMP(cur.geom, axis, pivot);
      } else {
        if (axis === 'h') { cur.x = 2 * pivot - cur.x; cur.rot = Math.PI - (cur.rot || 0); }
        else { cur.y = 2 * pivot - cur.y; cur.rot = -(cur.rot || 0); }
      }
    }
  }));
  commit(axis === 'h' ? '水平镜像' : '垂直镜像');
}

export function circularArray(count, totalDeg = 360, copiesIncludeSelf = true) {
  const sel = selectedEntities();
  if (!sel.length || count < 2) return;
  let cx = 0, cy = 0;
  for (const e of sel) { cx += e.center[0]; cy += e.center[1]; }
  cx /= sel.length; cy /= sel.length;
  const step = (totalDeg * Math.PI) / 180 / (totalDeg >= 360 ? count : count - 1);
  const newIds = [];
  setState(produce((s) => {
    for (let i = 1; i < count; i++) {
      const a = step * i;
      for (const e of sel) {
        const cur = JSON.parse(JSON.stringify(s.doc.entities[e.id]));
        const nid = uid(cur.kind.slice(0, 3));
        if (cur.kind === 'composite') {
          cur.geom = rotateMP(cur.geom, cx, cy, a);
        } else {
          const dx = cur.x - cx, dy = cur.y - cy;
          const c = Math.cos(a), sn = Math.sin(a);
          cur.x = cx + dx * c - dy * sn;
          cur.y = cy + dx * sn + dy * c;
          cur.rot = (cur.rot || 0) + a;
        }
        cur.id = nid;
        s.doc.entities[nid] = cur;
        s.doc.order.push(nid);
        newIds.push(nid);
      }
    }
    if (copiesIncludeSelf) s.selection = [...state.selection, ...newIds];
  }));
  commit(`环形阵列 ×${count}`);
}

// 沿边等距排列:把选中图元沿目标图元指定边等距排开
export function distributeAlongEdge(targetId, movingIds, edgeIdx = null) {
  const target = decorate(state.doc.entities[targetId]);
  const ring = target.geomWorld[0][0];
  let edge = null;
  if (edgeIdx != null) {
    const a = ring[edgeIdx % ring.length], b = ring[(edgeIdx + 1) % ring.length];
    edge = { a, b };
  } else {
    // 默认最长边
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], b = ring[(i + 1) % ring.length];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (!edge || len > edge.len) edge = { a, b, len };
    }
  }
  const n = movingIds.length;
  const div = n + 1;
  setState(produce((s) => {
    for (let k = 0; k < n; k++) {
      const t = (k + 1) / div;
      const px = edge.a[0] + (edge.b[0] - edge.a[0]) * t;
      const py = edge.a[1] + (edge.b[1] - edge.a[1]) * t;
      const e = s.doc.entities[movingIds[k]];
      if (!e) continue;
      if (e.kind === 'composite') {
        const b0 = decorate(e).bounds;
        e.geom = translateMP(e.geom, px - b0.cx, py - b0.cy);
      } else { e.x = px; e.y = py; }
    }
  }));
  commit('沿边等距排列');
}

// ---------- 版本 ----------
export function commitVersion(name) {
  const v = {
    id: uid('v'),
    name: name || `V${state.versions.length + 1}`,
    time: new Date().toLocaleString('zh-CN'),
    doc: snapshotDoc(),
  };
  setState(produce((s) => { s.versions.push(v); }));
  persist();
  return v.id;
}

// ---------- 批注 ----------
export function addAnnotation(x, y, text, author = '审核人') {
  const a = {
    id: uid('a'), x, y, text, author,
    versionId: state.versions[state.versions.length - 1]?.id ?? null,
    time: new Date().toLocaleString('zh-CN'),
    status: 'open',
    replies: [],
  };
  setState(produce((s) => { s.annotations.push(a); }));
  persist();
}

export function replyAnnotation(id, text, author = '制作方') {
  setState(produce((s) => {
    const a = s.annotations.find((x) => x.id === id);
    if (a) a.replies.push({ text, author, time: new Date().toLocaleString('zh-CN') });
  }));
  persist();
}

export function toggleAnnotationStatus(id) {
  setState(produce((s) => {
    const a = s.annotations.find((x) => x.id === id);
    if (a) a.status = a.status === 'open' ? 'done' : 'open';
  }));
  persist();
}

// ---------- 差异 ----------
export function diffVersions(aId, bId) {
  const a = state.versions.find((v) => v.id === aId);
  const b = state.versions.find((v) => v.id === bId);
  if (!a || !b) return null;
  const ea = a.doc.entities, eb = b.doc.entities;
  const added = [], removed = [], modified = [];
  for (const id in eb) {
    if (!ea[id]) added.push(eb[id]);
    else if (JSON.stringify(ea[id]) !== JSON.stringify(eb[id])) modified.push(eb[id]);
  }
  for (const id in ea) if (!eb[id]) removed.push(ea[id]);
  return { a, b, added, removed, modified };
}

// ---------- 持久化 ----------
let persistTimer = null;
export function persist() {
  clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify({
        doc: state.doc, history: state.history, hIndex: state.hIndex,
        versions: state.versions, annotations: state.annotations,
      }));
    } catch { /* 容量超限时静默 */ }
  }, 300);
}

// 演示数据:没有存档时给一套初始布局
if (!saved) {
  const sprue = makeEntity('sprue', 0, -60);
  const r1 = makeEntity('runner', 0, 0, { rot: Math.PI / 2 });
  const g1 = makeEntity('fanGate', -30, 40, { rot: Math.PI });
  const g2 = makeEntity('fanGate', 30, 40, { rot: 0 });
  const insert = makeEntity('insert', 0, 40);
  const p1 = makeEntity('pin', -45, 65);
  const p2 = makeEntity('pin', 45, 65);
  const c1 = makeEntity('cooling', -60, 20);
  const c2 = makeEntity('cooling', 60, 20);
  setState(produce((s) => {
    for (const e of [sprue, r1, g1, g2, insert, p1, p2, c1, c2]) {
      s.doc.entities[e.id] = serialize(e);
      s.doc.order.push(e.id);
    }
  }));
  setState(produce((s) => {
    s.history = [{ label: '初始布局', doc: snapshotDoc() }];
    s.hIndex = 0;
  }));
}
