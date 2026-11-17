import { reactive, computed, watch } from 'vue'
import { booleanPolygons, mergeCloseNodes } from '../lib/boolean.js'
import { shapeToContour, mirrorShape, boundsOfShape, pointInPolygon } from '../lib/geometry.js'
import { loadMaterials, saveMaterials } from '../lib/library.js'

const SHOWS_KEY = 'rse-shows-v1'
const uid = (p = 'id') => p + '-' + Math.random().toString(36).slice(2, 9)

// 固定三层：层序不可更改，撤销/重做不影响层序
export const LAYER_DEFS = [
  { key: 'stage', name: '舞台层' },
  { key: 'path', name: '路径标线层' },
  { key: 'robot', name: '机器人位层' }
]

function defaultStage() {
  return { width: 960, height: 600, gridSize: 20, name: '主舞台' }
}

function seedShows() {
  const now = Date.now()
  return [
    {
      id: uid('show'), name: '星幕序曲', status: 'draft',
      stage: defaultStage(),
      schedule: { date: '2026-12-01', slot: '19:30-20:30', venue: '一号厅' },
      shapes: [
        { id: uid('s'), type: 'rect', layer: 'path', name: '候场区 A', x: 60, y: 420, width: 200, height: 120, cornerRadius: 14, fill: 'rgba(126,231,135,0.10)', stroke: '#7ee787', strokeWidth: 2, visible: true, beat: '00:00', actor: '群舞组' },
        { id: uid('s'), type: 'circle', layer: 'path', name: '中心集结圈', x: 480, y: 300, radius: 70, fill: 'rgba(210,168,255,0.10)', stroke: '#d2a8ff', strokeWidth: 2, visible: true, beat: '01:12', actor: 'B1 组' },
        {
          id: uid('s'), type: 'path', layer: 'path', name: '入场走位 P1', closed: false, visible: true,
          fill: 'none', stroke: '#58a6ff', strokeWidth: 2.5, beat: '00:18', actor: 'S1 组',
          nodes: [
            { x: 90, y: 540, hin: null, hout: { dx: 60, dy: -80 } },
            { x: 260, y: 360, hin: { dx: -40, dy: 30 }, hout: { dx: 90, dy: -10 } },
            { x: 430, y: 300, hin: { dx: -50, dy: 20 }, hout: null }
          ]
        },
        { id: uid('s'), type: 'robot', layer: 'robot', name: 'S1-01 位', model: 'rb-wheel-s', x: 90, y: 540, radius: 18, angle: 0, fill: 'rgba(88,166,255,0.18)', stroke: '#58a6ff', visible: true, beat: '00:00', actor: '一号演员' }
      ]
    },
    {
      id: uid('show'), name: '齿轮之舞', status: 'draft',
      stage: defaultStage(),
      schedule: { date: '2026-12-01', slot: '19:30-20:30', venue: '一号厅' },
      shapes: []
    }
  ]
}

function loadShows() {
  try {
    const raw = localStorage.getItem(SHOWS_KEY)
    if (raw) return JSON.parse(raw)
  } catch (e) { /* ignore */ }
  return seedShows()
}

export const store = reactive({
  view: 'shows',            // shows | canvas | library | admin
  shows: loadShows(),
  currentShowId: null,
  selection: [],            // 选中的 shape id
  snapMode: 'grid',         // grid | endpoint | midpoint | equidistant
  tool: 'select',           // select | rect | circle | polygon | path | node | robot
  robotModel: null,         // 当前拖入的机器人型号
  materials: loadMaterials(),
  history: { stacks: {}, index: {} }, // 按 showId 独立撤销栈
  toast: '',
  adminFilter: ''
})

export const currentShow = computed(() => store.shows.find(s => s.id === store.currentShowId) || null)

export function showToast(msg) {
  store.toast = msg
  setTimeout(() => { if (store.toast === msg) store.toast = '' }, 2600)
}

// ---------- 持久化 ----------
watch(() => store.shows, (v) => localStorage.setItem(SHOWS_KEY, JSON.stringify(v)), { deep: true })
watch(() => store.materials, (v) => saveMaterials(v), { deep: true })

// ---------- 剧目 ----------
export function createShow(name) {
  const show = {
    id: uid('show'), name: name || '未命名剧目', status: 'draft',
    stage: defaultStage(), schedule: { date: '', slot: '', venue: '' }, shapes: []
  }
  store.shows.push(show)
  return show
}
export function deleteShow(id) {
  const i = store.shows.findIndex(s => s.id === id)
  if (i >= 0) store.shows.splice(i, 1)
  if (store.currentShowId === id) store.currentShowId = null
}
export function openShow(id) {
  store.currentShowId = id
  store.selection = []
  store.view = 'canvas'
  if (!store.history.stacks[id]) {
    store.history.stacks[id] = [{ label: '初始状态', shapes: JSON.parse(JSON.stringify(store.shows.find(s => s.id === id).shapes)) }]
    store.history.index[id] = 0
  }
}

// ---------- 撤销栈：仅存 shapes 内容快照，层序永远来自 shape.layer ----------
function histStack(showId) {
  if (!store.history.stacks[showId]) { store.history.stacks[showId] = []; store.history.index[showId] = -1 }
  return { stack: store.history.stacks[showId], index: store.history.index[showId] }
}
export function canUndo(showId = store.currentShowId) {
  if (!showId) return false
  return (store.history.index[showId] ?? -1) > 0
}
export function canRedo(showId = store.currentShowId) {
  if (!showId) return false
  return (store.history.index[showId] ?? -1) < (store.history.stacks[showId]?.length ?? 0) - 1
}
export function pushHistory(label = '') {
  const show = currentShow.value
  if (!show) return
  const { stack } = histStack(show.id)
  let idx = store.history.index[show.id] ?? -1
  if (idx + 1 < stack.length) stack.splice(idx + 1)
  stack.push({ label, shapes: JSON.parse(JSON.stringify(show.shapes)) })
  if (stack.length > 60) stack.shift()
  store.history.index[show.id] = stack.length - 1
}
export function undo() {
  const show = currentShow.value
  if (!show || !canUndo(show.id)) return
  store.history.index[show.id]--
  const snap = store.history.stacks[show.id][store.history.index[show.id]]
  show.shapes = JSON.parse(JSON.stringify(snap.shapes))
  pruneSelection()
}
export function redo() {
  const show = currentShow.value
  if (!show || !canRedo(show.id)) return
  store.history.index[show.id]++
  const snap = store.history.stacks[show.id][store.history.index[show.id]]
  show.shapes = JSON.parse(JSON.stringify(snap.shapes))
  pruneSelection()
}
function pruneSelection() {
  const show = currentShow.value
  if (!show) return
  store.selection = store.selection.filter(id => show.shapes.some(s => s.id === id))
}

// ---------- 图形增删改 ----------
const PALETTE = {
  rect: { fill: 'rgba(88,166,255,0.10)', stroke: '#58a6ff' },
  circle: { fill: 'rgba(210,168,255,0.10)', stroke: '#d2a8ff' },
  polygon: { fill: 'rgba(126,231,135,0.10)', stroke: '#7ee787' },
  path: { fill: 'none', stroke: '#e6e9f2' }
}
export function addShape(partial, record = true) {
  const show = currentShow.value
  if (!show) return null
  const base = {
    id: uid('s'), visible: true, strokeWidth: 2, beat: '', actor: '', ...PALETTE[partial.type]
  }
  const s = Object.assign(base, partial)
  show.shapes.push(s)
  if (record) { pushHistory('添加 ' + s.name); store.selection = [s.id] }
  return s
}
export function removeShapes(ids) {
  const show = currentShow.value
  if (!show || !ids.length) return
  show.shapes = show.shapes.filter(s => !ids.includes(s.id))
  store.selection = store.selection.filter(id => !ids.includes(id))
  pushHistory('删除图形')
}
export function updateShape(id, patch, record = false) {
  const s = currentShow.value?.shapes.find(x => x.id === id)
  if (!s) return
  Object.assign(s, patch)
  if (record) pushHistory('修改 ' + (s.name || '图形'))
}
export function duplicateShapes(ids) {
  const show = currentShow.value
  if (!show) return
  const clones = []
  for (const id of ids) {
    const s = show.shapes.find(x => x.id === id)
    if (!s) continue
    const c = JSON.parse(JSON.stringify(s))
    c.id = uid('s'); c.name = (s.name || '图形') + ' 副本'
    if (c.type === 'rect') { c.x += 24; c.y += 24 }
    else if (c.type === 'circle' || c.type === 'robot') { c.x += 24; c.y += 24 }
    else (c.nodes || c.points).forEach(p => { p.x += 24; p.y += 24 })
    clones.push(c)
  }
  show.shapes.push(...clones)
  store.selection = clones.map(c => c.id)
  pushHistory('复制图形')
}

// ---------- 镜像：整条选中路径/图形镜像到舞台另一侧 ----------
export function mirrorSelection() {
  const show = currentShow.value
  if (!show || !store.selection.length) { showToast('请先选择要镜像的图形'); return }
  const cx = show.stage.width / 2
  const made = store.selection.map(id => {
    const s = show.shapes.find(x => x.id === id)
    return s ? mirrorShape(s, cx) : null
  }).filter(Boolean)
  show.shapes.push(...made)
  store.selection = made.map(m => m.id)
  pushHistory('镜像到舞台另一侧')
  showToast(`已镜像 ${made.length} 个图形`)
}

// ---------- 布尔运算：选两个形状 ----------
export function applyBoolean(op, idA, idB) {
  const show = currentShow.value
  if (!show) return
  const a = show.shapes.find(s => s.id === idA)
  const b = show.shapes.find(s => s.id === idB)
  if (!a || !b) { showToast('需要选择两个形状'); return }
  if (['robot'].includes(a.type) || ['robot'].includes(b.type)) { showToast('机器人位不参与布尔运算'); return }
  const ca = shapeToContour(a), cb = shapeToContour(b)
  if (ca.length < 3 || cb.length < 3) { showToast('形状轮廓不足，无法布尔'); return }
  const res = booleanPolygons(ca, cb, op)
  const merged = res.contours.map(c => mergeCloseNodes(c, 2)).filter(c => c.length >= 3)
  if (!merged.length) {
    if (op === 'difference') {
      // 差集为空：移除 A
      show.shapes = show.shapes.filter(s => s.id !== a.id && s.id !== b.id)
      pushHistory(`布尔${opName(op)}`)
      showToast('差集为空，两形状已移除')
      return
    }
    showToast('布尔结果为空'); return
  }
  const primary = merged[0]
  const poly = {
    id: uid('s'), type: 'polygon', layer: 'path',
    name: `${a.name || '形状'}${opSymbol(op)}${b.name || '形状'}`,
    points: primary.map(p => ({ x: Math.round(p.x * 100) / 100, y: Math.round(p.y * 100) / 100, r: p.r || 0, smooth: !!p.smooth })),
    fill: a.fill, stroke: a.stroke, strokeWidth: a.strokeWidth, visible: true,
    beat: a.beat || b.beat, actor: a.actor || b.actor
  }
  const removeIds = new Set([a.id, b.id])
  show.shapes = show.shapes.filter(s => !removeIds.has(s.id))
  show.shapes.push(poly)
  store.selection = [poly.id]
  pushHistory(`布尔${opName(op)}`)
  showToast(`${opName(op)}完成：圆角保留，重叠节点已自动合并`)
}
const opName = (op) => ({ union: '并集', intersect: '交集', difference: '差集' }[op])
const opSymbol = (op) => ({ union: '∪', intersect: '∩', difference: '−' }[op])

// ---------- 机器人投放 ----------
export function placeRobot(model, x, y) {
  return addShape({
    type: 'robot', layer: 'robot', name: model.name + ' 位', model: model.id,
    x, y, radius: model.radius, angle: 0,
    fill: hexA(model.color, 0.18), stroke: model.color
  })
}
function hexA(hex, a) {
  const n = parseInt(hex.slice(1), 16)
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`
}

// ---------- 素材库维护 ----------
export function upsertMaterial(m) {
  const i = store.materials.findIndex(x => x.id === m.id)
  if (i >= 0) store.materials[i] = { ...store.materials[i], ...m }
  else store.materials.push({ ...m, id: m.id || uid('rb') })
}
export function removeMaterial(id) {
  const i = store.materials.findIndex(x => x.id === id)
  if (i >= 0) store.materials.splice(i, 1)
}

// ---------- 节拍 / 演员标注 ----------
export function annotate(id, beat, actor) {
  const s = currentShow.value?.shapes.find(x => x.id === id)
  if (!s) return
  s.beat = beat; s.actor = actor
  pushHistory('标注节拍/演员')
}

// ---------- 后台：提交、冲突检测、统计 ----------
function slotsOverlap(a, b) {
  if (a.date !== b.date || a.venue !== b.venue) return false
  const toMin = (slot) => {
    const [s, e] = slot.split('-').map(t => { const [h, m] = t.split(':').map(Number); return h * 60 + m })
    return { s, e }
  }
  if (!a.slot || !b.slot || !a.slot.includes('-') || !b.slot.includes('-')) return false
  const x = toMin(a.slot), y = toMin(b.slot)
  return x.s < y.e && y.s < x.e
}

export function submitShow(id) {
  const show = store.shows.find(s => s.id === id)
  if (!show) return { ok: false, conflicts: [] }
  const conflicts = []
  for (const other of store.shows) {
    if (other.id === id || other.status !== 'scheduled') continue
    if (slotsOverlap(show.schedule, other.schedule)) {
      conflicts.push({ a: show.name, b: other.name, date: show.schedule.date, venue: show.schedule.venue, slot: show.schedule.slot })
    }
  }
  if (conflicts.length) return { ok: false, conflicts }
  show.status = 'scheduled'
  return { ok: true, conflicts: [] }
}

export const adminStats = computed(() => {
  const rows = store.shows.map(show => {
    const beats = show.shapes.map(s => s.beat).filter(Boolean)
    let seconds = 0
    for (const b of beats) {
      const [m, sec] = b.split(':').map(Number)
      if (!isNaN(m)) seconds = Math.max(seconds, m * 60 + (sec || 0))
    }
    return {
      id: show.id, name: show.name, status: show.status,
      sessions: show.status === 'scheduled' ? 1 : 0,
      durationSec: seconds,
      robotCount: show.shapes.filter(s => s.type === 'robot').length,
      pathCount: show.shapes.filter(s => s.layer === 'path').length
    }
  })
  return {
    rows,
    totalSessions: rows.reduce((n, r) => n + r.sessions, 0),
    totalDuration: rows.reduce((n, r) => n + r.durationSec, 0)
  }
})

export function hitTest(show, x, y) {
  // 自上而下：robot -> path -> stage
  for (const layer of ['robot', 'path', 'stage']) {
    const list = show.shapes.filter(s => s.layer === layer && s.visible !== false)
    for (let i = list.length - 1; i >= 0; i--) {
      if (shapeContainsPoint(list[i], x, y)) return list[i]
    }
  }
  return null
}
export function shapeContainsPoint(s, x, y) {
  const b = boundsOfShape(s)
  const pad = s.type === 'robot' || s.type === 'circle' ? 0 : 4
  if (x < b.x - pad || x > b.x + b.width + pad || y < b.y - pad || y > b.y + b.height + pad) return false
  if (s.type === 'circle' || s.type === 'robot') return Math.hypot(x - s.x, y - s.y) <= s.radius
  if (s.type === 'rect') return true
  const contour = shapeToContour(s)
  return pointInPolygon({ x, y }, contour)
}
