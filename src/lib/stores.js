import { writable, derived } from 'svelte/store'
import { sampleSpline, defaultAnchors } from './geometry/spline.js'

// ---- 建模参数 ----
export const anchors = writable(defaultAnchors())

export const params = writable({
  density: 24,        // 每段采样数(采样密度,可调)
  offset: 3,          // 内衬等距偏移间距 mm
  kFactor: 0.4,       // 折弯补偿 K 因子
  thickness: 2,       // 硅胶料厚 mm
  seamU: 0,           // 缝合边位置(截面参数 0..1)
  allowance: 5,       // 缝份 mm
  pathLen: 60,        // 扫掠长度 mm
  taper0: 1,          // 起始端变截面比例
  taper1: 0.85,       // 末端变截面比例
  combScale: 30,      // 曲率梳缩放
  jumpThresh: 0.05,   // 曲率突变阈值 (1/mm)
  colorMode: 1,       // 曲面着色:0 素模 1 曲率热力
  unfoldNv: 24        // 扫掠方向细分数
})

// 截面采样(建模/展开共用)
export const samples = derived([anchors, params], ([$a, $p]) => sampleSpline($a, $p.density))

// ---- 设计库(保存/复用指腹截面设计) ----
function loadJSON(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback } catch { return fallback }
}

export const designs = writable(loadJSON('ff_designs', []))
designs.subscribe(v => { try { localStorage.setItem('ff_designs', JSON.stringify(v)) } catch {} })

export function saveDesign(name, anchorsVal, paramsVal) {
  designs.update(list => {
    const rec = { name, anchors: anchorsVal, params: paramsVal, savedAt: new Date().toISOString() }
    const i = list.findIndex(d => d.name === name)
    if (i >= 0) { const l = list.slice(); l[i] = rec; return l }
    return [...list, rec]
  })
}

// ---- 订单/项目流程 ----
// order: { id, title, customer, deadline, status, createdAt, deliveredAt,
//          items: [{ id, name, designName, qty, status, rework, note }] }
// item.status: 待制作 | 制作中 | 待审核 | 已通过
// order.status: 进行中 | 待打包 | 已交付
export const orders = writable(loadJSON('ff_orders', []))
orders.subscribe(v => { try { localStorage.setItem('ff_orders', JSON.stringify(v)) } catch {} })

// 当前角色:customer 客户 | maker 制作员 | lead 主管
export const role = writable('maker')

let seq = loadJSON('ff_seq', 1)
function nextId(prefix) {
  seq += 1
  try { localStorage.setItem('ff_seq', JSON.stringify(seq)) } catch {}
  return `${prefix}-${String(seq).padStart(4, '0')}`
}

export function createOrder(title, customer, deadline, items) {
  const order = {
    id: nextId('SO'), title, customer, deadline,
    status: '进行中', createdAt: new Date().toISOString(), deliveredAt: null,
    items: items.map(it => ({
      id: nextId('FP'), name: it.name, designName: it.designName,
      qty: Math.max(1, it.qty | 0), status: '待制作', rework: 0, note: ''
    }))
  }
  orders.update(list => [order, ...list])
  return order.id
}

export function updateItem(orderId, itemId, patch) {
  orders.update(list => list.map(o => {
    if (o.id !== orderId) return o
    const items = o.items.map(it => it.id === itemId ? { ...it, ...patch } : it)
    const done = items.every(it => it.status === '已通过')
    return { ...o, items, status: o.status === '已交付' ? o.status : (done ? '待打包' : '进行中') }
  }))
}

export function deliverOrder(orderId) {
  orders.update(list => list.map(o =>
    o.id === orderId && o.items.every(it => it.status === '已通过')
      ? { ...o, status: '已交付', deliveredAt: new Date().toISOString() }
      : o
  ))
}

export function isOverdue(order) {
  return order.status !== '已交付' && order.deadline && new Date(order.deadline) < new Date()
}
