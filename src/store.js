/**
 * store.js — 工单流全局状态（Solid store + localStorage 持久化）
 *
 * 工单状态机：
 *   new（待分派）→ assigned（设计中）→ submitted（待质检）
 *     → passed（合格入库）
 *     → rework（打回）→ assigned …（reworkCount 累加）
 */
import { createSignal, createMemo } from 'solid-js';
import { createStore, produce } from 'solid-js/store';
import { DEFAULT_PROFILE, DEFAULT_THRESHOLD, scaleToCapacity, revolveVolume } from './geometry.js';

const STORAGE_KEY = 'bottle-tool-v1';

export const DESIGNERS = ['李设计师', '王设计师', '赵设计师', '陈设计师'];
export const MATERIALS = ['PET 透明', 'PE 乳白', 'PP 磨砂', 'PCR 再生'];
export const STATUS_LABEL = {
  new: '待分派',
  assigned: '设计中',
  submitted: '待质检',
  rework: '打回返工',
  passed: '合格入库',
};

export function defaultLabel() {
  return {
    yMin: 40,
    yMax: 150,
    safeMm: 5,
    bleedMm: 3,
    refMode: 'auto', // auto | fixed
    refRadius: 35,
  };
}

export function defaultDesign(capacityMl) {
  // 种子/新单：将默认轮廓按目标容量缩放，保证初始体积即贴合工单要求
  const cps = scaleToCapacity(DEFAULT_PROFILE.map(p => ({ ...p })), capacityMl || 500);
  return {
    controlPoints: cps,
    threshold: DEFAULT_THRESHOLD,
    label: defaultLabel(),
    volumeMl: revolveVolume(cps),
    material: MATERIALS[0],
  };
}

function now() {
  return new Date().toLocaleString('zh-CN', { hour12: false });
}

function seedOrders() {
  const mk = (id, title, cap, mat, status, designer, rework, daysAgo, withDesign) => {
    const design = withDesign ? defaultDesign(cap) : null;
    return {
      id,
      title,
      capacityMl: cap,
      material: mat,
      note: '',
      status,
      designer: designer || '',
      reworkCount: rework,
      createdAt: shiftDate(daysAgo),
      updatedAt: shiftDate(Math.max(0, daysAgo - 1)),
      events: seedEvents(status, designer, rework, daysAgo),
      design,
      qcOpinion: '',
    };
  };
  return [
    mk('WO-20261114-001', '洗发水圆瓶标签改版', 500, 'PET 透明', 'passed', '李设计师', 1, 4, true),
    mk('WO-20261115-002', '沐浴露乳白瓶新品', 750, 'PE 乳白', 'submitted', '王设计师', 0, 3, true),
    mk('WO-20261116-003', '洁面乳磨砂瓶', 150, 'PP 磨砂', 'assigned', '赵设计师', 0, 2, true),
    mk('WO-20261117-004', '环保再生料分装瓶', 300, 'PCR 再生', 'rework', '陈设计师', 2, 1, true),
    mk('WO-20261118-005', '洗手液补充装瓶型', 1000, 'PE 乳白', 'new', '', 0, 0, false),
  ];
}

function shiftDate(daysAgo) {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  d.setHours(9 + (daysAgo % 8), 12 + (daysAgo % 35), 0, 0);
  return d.toLocaleString('zh-CN', { hour12: false });
}

function seedEvents(status, designer, rework, daysAgo) {
  const ev = [{ at: shiftDate(daysAgo), actor: '前台', action: 'create', text: '前台接单录入工单' }];
  if (designer) ev.push({ at: shiftDate(daysAgo), actor: '前台', action: 'assign', text: `分派给 ${designer}` });
  for (let k = 0; k < rework; k++) {
    ev.push({ at: shiftDate(Math.max(0, daysAgo - 1)), actor: designer, action: 'submit', text: '提交质检' });
    ev.push({ at: shiftDate(Math.max(0, daysAgo - 1)), actor: '质检员', action: 'reject', text: `第 ${k + 1} 次抽查不合格，打回返工` });
  }
  if (status === 'submitted' || status === 'passed') {
    ev.push({ at: shiftDate(Math.max(0, daysAgo - 1)), actor: designer, action: 'submit', text: '提交质检' });
  }
  if (status === 'passed') {
    ev.push({ at: shiftDate(Math.max(0, daysAgo - 2)), actor: '质检员', action: 'pass', text: '抽查合格，入库归档' });
  }
  return ev;
}

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const data = JSON.parse(raw);
      if (data?.orders?.length) return data;
    }
  } catch { /* 损坏数据则重建 */ }
  return { seq: 6, orders: seedOrders() };
}

const initial = load();
const [state, setState] = createStore({
  orders: initial.orders,
  seq: initial.seq,
  currentOrderId: initial.orders[2]?.id ?? initial.orders[0]?.id ?? null,
  currentDesigner: DESIGNERS[0],
  toast: '',
});

let persistTimer = 0;
function persist() {
  clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ orders: state.orders, seq: state.seq }));
  }, 200);
}

function pushEvent(orderId, actor, action, text) {
  setState('orders', o => o.id === orderId, produce(o => {
    o.events.push({ at: now(), actor, action, text });
    o.updatedAt = now();
  }));
}

function showToast(text) {
  setState('toast', text);
  setTimeout(() => setState('toast', ''), 2400);
}

/* ---------------- 工单动作 ---------------- */

export function createOrder(input) {
  const id = `WO-20261118-${String(state.seq).padStart(3, '0')}`;
  const order = {
    id,
    title: input.title,
    capacityMl: input.capacityMl,
    material: input.material,
    note: input.note || '',
    status: 'new',
    designer: '',
    reworkCount: 0,
    createdAt: now(),
    updatedAt: now(),
    events: [{ at: now(), actor: '前台', action: 'create', text: '前台接单录入工单' }],
    design: null,
    qcOpinion: '',
  };
  setState('orders', orders => [order, ...orders]);
  setState('seq', s => s + 1);
  persist();
  showToast(`工单 ${id} 已创建`);
  return id;
}

export function assignOrder(orderId, designer) {
  setState('orders', o => o.id === orderId, produce(o => {
    o.designer = designer;
    o.status = 'assigned';
    if (!o.design) o.design = defaultDesign(o.capacityMl);
  }));
  pushEvent(orderId, '前台', 'assign', `分派给 ${designer}`);
  persist();
  showToast(`已分派给 ${designer}`);
}

export function selectOrder(orderId) {
  setState('currentOrderId', orderId);
}

export function setCurrentDesigner(name) {
  setState('currentDesigner', name);
}

export function updateDesign(orderId, patch) {
  setState('orders', o => o.id === orderId, produce(o => {
    if (!o.design) o.design = defaultDesign(o.capacityMl);
    Object.assign(o.design, patch);
  }));
  persist();
}

export function updateControlPoints(orderId, controlPoints) {
  // 轮廓变化 → 体积自动重算（展开稿由工作台响应式触发重算）
  setState('orders', o => o.id === orderId, produce(o => {
    if (!o.design) o.design = defaultDesign(o.capacityMl);
    o.design.controlPoints = controlPoints;
    o.design.volumeMl = revolveVolume(controlPoints);
  }));
  persist();
}

export function updateLabel(orderId, labelPatch) {
  setState('orders', o => o.id === orderId, produce(o => {
    if (!o.design) o.design = defaultDesign(o.capacityMl);
    Object.assign(o.design.label, labelPatch);
  }));
  persist();
}

export function submitDesign(orderId) {
  setState('orders', o => o.id === orderId, 'status', 'submitted');
  pushEvent(orderId, state.currentDesigner, 'submit', `${state.currentDesigner} 提交设计稿待质检`);
  persist();
  showToast('设计稿已提交，等待质检抽查');
}

export function passOrder(orderId, opinion) {
  setState('orders', o => o.id === orderId, produce(o => {
    o.status = 'passed';
    o.qcOpinion = opinion || '抽查合格';
  }));
  pushEvent(orderId, '质检员', 'pass', `抽查合格：${opinion || '各项指标达标'}`);
  persist();
  showToast('质检合格，工单入库');
}

export function rejectOrder(orderId, opinion) {
  setState('orders', o => o.id === orderId, produce(o => {
    o.status = 'rework';
    o.reworkCount += 1;
    o.qcOpinion = opinion || '抽查不合格';
  }));
  pushEvent(orderId, '质检员', 'reject', `第 ${state.orders.find(o => o.id === orderId)?.reworkCount ?? 1} 次抽查不合格打回：${opinion || '未注明原因'}`);
  persist();
  showToast('已打回返工，返工次数 +1');
}

/** 返工后重新提交（rework → assigned → submitted 的设计师侧入口） */
export function resumeWork(orderId) {
  setState('orders', o => o.id === orderId, 'status', 'assigned');
  pushEvent(orderId, state.currentDesigner, 'resume', '设计师接收返工任务，重新编辑');
  persist();
}

export function resetAll() {
  localStorage.removeItem(STORAGE_KEY);
  const fresh = { seq: 6, orders: seedOrders() };
  setState('orders', fresh.orders);
  setState('seq', fresh.seq);
  setState('currentOrderId', fresh.orders[0].id);
  showToast('已恢复演示数据');
}

/* ---------------- 查询 ---------------- */

export const currentOrder = createMemo(() =>
  state.orders.find(o => o.id === state.currentOrderId) ?? null
);

export const dashboardStats = createMemo(() => {
  const orders = state.orders;
  const total = orders.length;
  const passed = orders.filter(o => o.status === 'passed').length;
  const reworkEvents = orders.reduce((s, o) => s + o.reworkCount, 0);
  const submissions = orders.reduce((s, o) =>
    s + o.events.filter(e => e.action === 'submit').length, 0);
  const reworkRate = submissions ? reworkEvents / submissions : 0;
  const pending = orders.filter(o => o.status === 'new' || o.status === 'assigned' || o.status === 'rework').length;
  const qcQueue = orders.filter(o => o.status === 'submitted').length;
  const byDesigner = DESIGNERS.map(d => {
    const mine = orders.filter(o => o.designer === d);
    const done = mine.filter(o => o.status === 'passed').length;
    const rew = mine.reduce((s, o) => s + o.reworkCount, 0);
    return { designer: d, total: mine.length, done, rework: rew };
  });
  return { total, passed, reworkEvents, reworkRate, pending, qcQueue, byDesigner };
});

export { state, setState };
