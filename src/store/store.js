import { create } from 'zustand';
import { COMPONENTS, COMP_BY_ID } from '../data/surveyData';

// ---------------- 用户与角色 ----------------
export const USERS = [
  { key: 'frontdesk', name: '前台-小王', role: '前台' },
  { key: 'tech1', name: '张师傅', role: '维修师傅' },
  { key: 'tech2', name: '李师傅', role: '维修师傅' },
  { key: 'tech3', name: '王师傅', role: '维修师傅' },
  { key: 'qc', name: '质检-老刘', role: '质检员' },
];
export const TECHNICIANS = USERS.filter((u) => u.role === '维修师傅').map((u) => u.name);

const now = () => new Date().toLocaleString('zh-CN', { hour12: false });

// ---------------- 工单种子数据 ----------------
function pickComp(type, n) {
  return COMPONENTS.filter((c) => c.type === type)[n]?.id;
}
let seedSeq = 1000;
function seedOrder(componentId, desc, assignee, status, opts = {}) {
  seedSeq += 1;
  const h = [{ t: '2026-11-10 09:12', actor: '前台-小王', action: '登记故障' }];
  if (assignee) h.push({ t: '2026-11-10 09:30', actor: '前台-小王', action: `派单给 ${assignee}` });
  if (opts.submitCount) h.push({ t: '2026-11-11 14:05', actor: assignee, action: '提交维修结果' });
  if (opts.rejectCount) h.push({ t: '2026-11-12 10:20', actor: '质检-老刘', action: `抽查不合格,打回重做:${opts.qcNote || '处理不彻底'}` });
  if (status === 'done') h.push({ t: '2026-11-12 16:40', actor: '质检-老刘', action: '抽查合格,工单关闭' });
  return {
    id: `WO-${seedSeq}`, componentId, desc, priority: opts.priority || '普通',
    reporter: '前台-小王', assignee, status,
    submitCount: opts.submitCount || 0, rejectCount: opts.rejectCount || 0,
    createdAt: '2026-11-10 09:12', finishedAt: status === 'done' ? '2026-11-12 16:40' : null,
    history: h,
  };
}

const seedOrders = [
  seedOrder(pickComp('SP', 12), '喷淋头出水角度偏移,溅到步道', '张师傅', 'done', { submitCount: 1 }),
  seedOrder(pickComp('SP', 40), '喷淋头堵塞不出水', '张师傅', 'done', { submitCount: 1 }),
  seedOrder(pickComp('DR', 55), '排水篦子格栅断裂,有绊倒风险', '李师傅', 'done', { submitCount: 2, rejectCount: 1, priority: '紧急', qcNote: '更换后未固定螺栓' }),
  seedOrder(pickComp('LP', 8), '灯杆夜间闪烁', '王师傅', 'done', { submitCount: 1 }),
  seedOrder(pickComp('CAM', 3), '监控画面花屏', '张师傅', 'submitted', { submitCount: 1 }),
  seedOrder(pickComp('SP', 120), '喷淋头底座渗水', '李师傅', 'submitted', { submitCount: 2, rejectCount: 1, qcNote: '密封圈未更换' }),
  seedOrder(pickComp('DR', 200), '篦子周边地砖松动', '王师傅', 'assigned'),
  seedOrder(pickComp('LC', 5), '救生椅踏板开裂', '张师傅', 'assigned', { priority: '紧急', submitCount: 1, rejectCount: 1, qcNote: '仅捆绑未更换踏板' }),
  seedOrder(pickComp('LP', 30), '灯杆检修门缺失', null, 'pending'),
];

let orderSeq = seedSeq;

export const useStore = create((set, get) => ({
  // -------- 地图视图状态 --------
  viewLevel: 'park', // park | zone | pool
  setViewLevel: (viewLevel) => set({ viewLevel }),
  layers: { device: true, pipeline: true, green: true, warn: true },
  toggleLayer: (k) => set((s) => ({ layers: { ...s.layers, [k]: !s.layers[k] } })),
  typeToggles: { SP: true, DR: true, LC: true, LP: true, CAM: true },
  toggleType: (t) => set((s) => ({ typeToggles: { ...s.typeToggles, [t]: !s.typeToggles[t] } })),

  selection: [],
  setSelection: (selection) => set({ selection }),
  focused: null,
  setFocused: (focused) => set({ focused }),
  popup: null, // {id, sx, sy}
  setPopup: (popup) => set({ popup }),

  flyTarget: null, // {x, y, worldWidth, nonce}
  flyTo: (t) => set({ flyTarget: { ...t, nonce: Math.random() } }),
  exportTick: 0,
  requestExport: () => set((s) => ({ exportTick: s.exportTick + 1 })),
  mapApi: null,
  setMapApi: (mapApi) => set({ mapApi }),

  // -------- 构件状态(覆盖底图默认值) --------
  statusOverrides: {},
  statusVersion: 0,
  setCompStatus: (ids, status) =>
    set((s) => {
      const statusOverrides = { ...s.statusOverrides };
      for (const id of ids) statusOverrides[id] = status;
      return { statusOverrides, statusVersion: s.statusVersion + 1 };
    }),

  // -------- 角色 --------
  userKey: 'frontdesk',
  setUserKey: (userKey) => set({ userKey }),

  // -------- 工单 --------
  orders: seedOrders,
  reportFault: ({ componentId, desc, priority }) =>
    set((s) => {
      orderSeq += 1;
      const o = {
        id: `WO-${orderSeq}`, componentId, desc, priority,
        reporter: USERS.find((u) => u.key === s.userKey)?.name || '前台-小王',
        assignee: null, status: 'pending',
        submitCount: 0, rejectCount: 0,
        createdAt: now(), finishedAt: null,
        history: [{ t: now(), actor: USERS.find((u) => u.key === s.userKey)?.name, action: '登记故障' }],
      };
      return { orders: [o, ...s.orders] };
    }),
  dispatchOrder: (id, assignee) =>
    set((s) => ({
      orders: s.orders.map((o) =>
        o.id === id
          ? { ...o, assignee, status: 'assigned', history: [...o.history, { t: now(), actor: '前台-小王', action: `派单给 ${assignee}` }] }
          : o),
    })),
  submitOrder: (id, note) =>
    set((s) => ({
      orders: s.orders.map((o) =>
        o.id === id
          ? { ...o, status: 'submitted', submitCount: o.submitCount + 1, resultNote: note, history: [...o.history, { t: now(), actor: o.assignee, action: `提交维修结果:${note || '已处理'}` }] }
          : o),
    })),
  qcPass: (id) =>
    set((s) => ({
      orders: s.orders.map((o) =>
        o.id === id
          ? { ...o, status: 'done', finishedAt: now(), history: [...o.history, { t: now(), actor: '质检-老刘', action: '抽查合格,工单关闭' }] }
          : o),
    })),
  qcReject: (id, note) =>
    set((s) => ({
      orders: s.orders.map((o) =>
        o.id === id
          ? { ...o, status: 'assigned', rejectCount: o.rejectCount + 1, history: [...o.history, { t: now(), actor: '质检-老刘', action: `抽查不合格,打回重做:${note || '处理不彻底'}` }] }
          : o),
    })),
  batchDispatch: (ids, desc) => {
    const s = get();
    ids.forEach((cid) => s.reportFault({ componentId: cid, desc, priority: '普通' }));
  },

  // -------- 派单面板预填 --------
  dispatchPrefill: null, // {componentId}
  setDispatchPrefill: (dispatchPrefill) => set({ dispatchPrefill }),
  sidebarTab: 'layers',
  setSidebarTab: (sidebarTab) => set({ sidebarTab }),
}));

export function statusOf(comp) {
  const o = useStore.getState().statusOverrides[comp.id];
  return o ?? comp.status;
}

export { COMP_BY_ID };
