// 吸附引擎：网格 / 端点 / 中点 / 等距（12px 内出现参考线）
import { boundsOfShape, dist } from './geometry.js'

export const SNAP_RADIUS = 12

// 生成图形可吸附的锚点
export function snapTargetsOfShape(s) {
  const b = boundsOfShape(s)
  const pts = [
    { x: b.x, y: b.y, kind: 'corner' }, { x: b.x + b.width, y: b.y, kind: 'corner' },
    { x: b.x + b.width, y: b.y + b.height, kind: 'corner' }, { x: b.x, y: b.y + b.height, kind: 'corner' },
    { x: b.cx, y: b.cy, kind: 'center' },
    { x: b.cx, y: b.y, kind: 'mid' }, { x: b.cx, y: b.y + b.height, kind: 'mid' },
    { x: b.x, y: b.cy, kind: 'mid' }, { x: b.x + b.width, y: b.cy, kind: 'mid' }
  ]
  if (s.type === 'path' || s.type === 'polygon') {
    const nodes = s.type === 'path' ? s.nodes : s.points
    for (const n of nodes) pts.push({ x: n.x, y: n.y, kind: 'node' })
  }
  return pts
}

function nearest(points, pos) {
  let best = null
  for (const t of points) {
    const d = dist(t, pos)
    if (d <= SNAP_RADIUS && (!best || d < best.d)) best = { ...t, d }
  }
  return best
}

// mode: grid | endpoint | midpoint | equidistant
// 返回 { dx, dy, guides:[{axis,pos,from,to}], hits:[...] }
export function computeSnap(pos, mode, ctx) {
  const { gridSize = 20, shapes = [], movingId = null, movingBounds = null } = ctx
  const guides = []
  const hits = []
  let dx = 0, dy = 0

  if (mode === 'grid') {
    const gx = Math.round(pos.x / gridSize) * gridSize
    const gy = Math.round(pos.y / gridSize) * gridSize
    if (Math.abs(gx - pos.x) <= SNAP_RADIUS) { dx = gx - pos.x; guides.push({ axis: 'x', pos: gx }) }
    if (Math.abs(gy - pos.y) <= SNAP_RADIUS) { dy = gy - pos.y; guides.push({ axis: 'y', pos: gy }) }
    return { dx, dy, guides, hits }
  }

  if (mode === 'endpoint' || mode === 'midpoint') {
    const want = mode === 'endpoint' ? ['corner', 'node', 'center'] : ['mid', 'center']
    const targets = []
    for (const s of shapes) {
      if (s.id === movingId) continue
      for (const t of snapTargetsOfShape(s)) if (want.includes(t.kind)) targets.push(t)
    }
    const hit = nearest(targets, pos)
    if (hit) {
      dx = hit.x - pos.x; dy = hit.y - pos.y
      guides.push({ axis: 'x', pos: hit.x, p: hit }, { axis: 'y', pos: hit.y, p: hit })
      hits.push(hit)
    }
    return { dx, dy, guides, hits }
  }

  // equidistant：等距参考线 —— 与其它图形边/中心对齐 + 间距等分
  const others = shapes.filter(s => s.id !== movingId).map(boundsOfShape)
  const mb = movingBounds
  let bestX = null, bestY = null
  const candX = [], candY = []
  for (const b of others) {
    for (const vx of [b.x, b.cx, b.x + b.width]) {
      const d = Math.abs(vx - pos.x)
      if (d <= SNAP_RADIUS) candX.push({ pos: vx, d })
    }
    for (const vy of [b.y, b.cy, b.y + b.height]) {
      const d = Math.abs(vy - pos.y)
      if (d <= SNAP_RADIUS) candY.push({ pos: vy, d })
    }
  }
  // 等距：移动体中心与两个相邻图形中心等间距
  if (mb && others.length >= 1) {
    const xs = others.map(b => b.cx).sort((a, b) => a - b)
    const ys = others.map(b => b.cy).sort((a, b) => a - b)
    for (let i = 0; i < xs.length - 1; i++) {
      const mid = (xs[i] + xs[i + 1]) / 2
      const d = Math.abs(mid - pos.x)
      if (d <= SNAP_RADIUS) candX.push({ pos: mid, d, equidistant: true })
    }
    for (let i = 0; i < ys.length - 1; i++) {
      const mid = (ys[i] + ys[i + 1]) / 2
      const d = Math.abs(mid - pos.y)
      if (d <= SNAP_RADIUS) candY.push({ pos: mid, d, equidistant: true })
    }
  }
  bestX = candX.sort((a, b) => a.d - b.d)[0]
  bestY = candY.sort((a, b) => a.d - b.d)[0]
  if (bestX) { dx = bestX.pos - pos.x; guides.push({ axis: 'x', pos: bestX.pos, equidistant: bestX.equidistant }) }
  if (bestY) { dy = bestY.pos - pos.y; guides.push({ axis: 'y', pos: bestY.pos, equidistant: bestY.equidistant }) }
  return { dx, dy, guides, hits }
}
