// 矢量几何工具：贝塞尔采样、轮廓展开、镜像、包围盒、点包含
export const EPS = 1e-6

export const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y)
export const dist2 = (a, b) => { const dx = a.x - b.x, dy = a.y - b.y; return dx * dx + dy * dy }

export function boundsOfPoints(pts) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const p of pts) {
    if (p.x < minX) minX = p.x; if (p.y < minY) minY = p.y
    if (p.x > maxX) maxX = p.x; if (p.y > maxY) maxY = p.y
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY, cx: (minX + maxX) / 2, cy: (minY + maxY) / 2 }
}

function cubicPoint(p0, p1, p2, p3, t) {
  const mt = 1 - t
  const a = mt * mt * mt, b = 3 * mt * mt * t, c = 3 * mt * t * t, d = t * t * t
  return { x: a * p0.x + b * p1.x + c * p2.x + d * p3.x, y: a * p0.y + b * p1.y + c * p2.y + d * p3.y }
}

// 路径节点 -> 采样轮廓；每个采样点带 smooth 标记（曲线内部点）
export function flattenPath(nodes, closed = true, subdiv = 14) {
  const out = []
  const n = nodes.length
  if (n === 0) return out
  if (n === 1) return [{ x: nodes[0].x, y: nodes[0].y, smooth: false, r: 0 }]
  const segCount = closed ? n : n - 1
  for (let i = 0; i < segCount; i++) {
    const p0 = nodes[i]
    const p1 = nodes[(i + 1) % n]
    out.push({ x: p0.x, y: p0.y, smooth: false, r: p0.r || 0 })
    const hasHandle = (p0.hout && (Math.abs(p0.hout.dx) + Math.abs(p0.hout.dy)) > EPS) ||
                      (p1.hin && (Math.abs(p1.hin.dx) + Math.abs(p1.hin.dy)) > EPS)
    if (hasHandle) {
      const c1 = { x: p0.x + (p0.hout?.dx || 0), y: p0.y + (p0.hout?.dy || 0) }
      const c2 = { x: p1.x + (p1.hin?.dx || 0), y: p1.y + (p1.hin?.dy || 0) }
      for (let k = 1; k <= subdiv; k++) {
        if (k === subdiv && i < segCount - 1) continue
        if (k === subdiv && closed) continue
        const q = cubicPoint(p0, c1, c2, p1, k / subdiv)
        out.push({ x: q.x, y: q.y, smooth: true, r: 0 })
      }
    } else if (i < segCount - 1 || closed) {
      // 直线段：终点由下一段起点负责，闭合时补回
      if (i === segCount - 1 && closed) out.push({ x: p1.x, y: p1.y, smooth: false, r: p1.r || 0 })
    }
  }
  if (!closed) out.push({ x: nodes[n - 1].x, y: nodes[n - 1].y, smooth: false, r: nodes[n - 1].r || 0 })
  return out
}

// 任意图形 -> 带元数据的单一外轮廓
export function shapeToContour(s) {
  if (s.type === 'rect') {
    const { x, y, width: w, height: h, cornerRadius: r = 0 } = s
    return [
      { x, y, r }, { x: x + w, y, r }, { x: x + w, y: y + h, r }, { x, y: y + h, r }
    ]
  }
  if (s.type === 'circle' || s.type === 'robot') {
    const cx = s.type === 'circle' ? s.x : s.x
    const cy = s.type === 'circle' ? s.y : s.y
    const rad = s.type === 'circle' ? s.radius : s.radius
    const pts = []
    const N = 72
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2
      pts.push({ x: cx + Math.cos(a) * rad, y: cy + Math.sin(a) * rad, smooth: true, r: 0 })
    }
    return pts
  }
  if (s.type === 'polygon') return s.points.map(p => ({ ...p, r: p.r || 0, smooth: !!p.smooth }))
  if (s.type === 'path') return flattenPath(s.nodes, s.closed !== false)
  return []
}

export function boundsOfShape(s) {
  if (s.type === 'rect') return { x: s.x, y: s.y, width: s.width, height: s.height, cx: s.x + s.width / 2, cy: s.y + s.height / 2 }
  if (s.type === 'circle' || s.type === 'robot') return { x: s.x - s.radius, y: s.y - s.radius, width: s.radius * 2, height: s.radius * 2, cx: s.x, cy: s.y }
  const pts = s.type === 'path' ? s.nodes : s.points
  return boundsOfPoints(pts)
}

export function pointInPolygon(p, poly) {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j]
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside
  }
  return inside
}

// 线段交点；返回 {t,u,p} 或 null（含共线判定）
export function segmentIntersection(a, b, c, d) {
  const r = { x: b.x - a.x, y: b.y - a.y }
  const q = { x: d.x - c.x, y: d.y - c.y }
  const denom = r.x * q.y - r.y * q.x
  if (Math.abs(denom) < EPS) {
    // 共线重叠：返回端点作为交点（布尔时按容差合并）
    const cross = (c.x - a.x) * r.y - (c.y - a.y) * r.x
    if (Math.abs(cross) > EPS) return null
    const on = (p) => Math.min(a.x, b.x) - EPS <= p.x && p.x <= Math.max(a.x, b.x) + EPS &&
                      Math.min(a.y, b.y) - EPS <= p.y && p.y <= Math.max(a.y, b.y) + EPS
    const hits = []
    if (on(c)) hits.push({ t: hypotT(a, r, c), u: 0, p: c })
    if (on(d)) hits.push({ t: hypotT(a, r, d), u: 1, p: d })
    return hits.length ? hits : null
  }
  const t = ((c.x - a.x) * q.y - (c.y - a.y) * q.x) / denom
  const u = ((c.x - a.x) * r.y - (c.y - a.y) * r.x) / denom
  if (t < -EPS || t > 1 + EPS || u < -EPS || u > 1 + EPS) return null
  return { t: Math.max(0, Math.min(1, t)), u: Math.max(0, Math.min(1, u)), p: { x: a.x + r.x * t, y: a.y + r.y * t } }
}
function hypotT(a, r, p) {
  const len2 = r.x * r.x + r.y * r.y
  return len2 < EPS ? 0 : ((p.x - a.x) * r.x + (p.y - a.y) * r.y) / len2
}

// 以舞台垂直中线 x=cx 镜像一个图形（返回深拷贝）
export function mirrorShape(s, cx) {
  const m = JSON.parse(JSON.stringify(s))
  m.id = m.id + '-m' + Math.random().toString(36).slice(2, 7)
  m.name = (m.name || '图形') + '·镜像'
  const mx = (x) => 2 * cx - x
  if (m.type === 'rect') { m.x = mx(m.x + m.width) }
  else if (m.type === 'circle' || m.type === 'robot') { m.x = mx(m.x); if (m.type === 'robot') m.angle = 180 - (m.angle || 0) }
  else {
    const key = m.type === 'path' ? 'nodes' : 'points'
    for (const p of m[key]) {
      p.x = mx(p.x)
      if (p.hin) p.hin.dx = -p.hin.dx
      if (p.hout) p.hout.dx = -p.hout.dx
    }
  }
  return m
}

export function signedArea(pts) {
  let a = 0
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length]
    a += p.x * q.y - q.x * p.y
  }
  return a / 2
}

// 在轮廓边上按位置 t 插入节点（用于路径编辑）
export function insertNodeOnPath(nodes, edgeIndex, t) {
  const i = edgeIndex
  const p0 = nodes[i], p1 = nodes[(i + 1) % nodes.length]
  const hasHandle = (p0.hout || p1.hin)
  let np
  if (hasHandle) {
    const c1 = { x: p0.x + (p0.hout?.dx || 0), y: p0.y + (p0.hout?.dy || 0) }
    const c2 = { x: p1.x + (p1.hin?.dx || 0), y: p1.y + (p1.hin?.dy || 0) }
    np = cubicPoint(p0, c1, c2, p1, t)
  } else {
    np = { x: p0.x + (p1.x - p0.x) * t, y: p0.y + (p1.y - p0.y) * t }
  }
  const node = { x: np.x, y: np.y, hin: null, hout: null, type: 'corner' }
  nodes.splice(i + 1, 0, node)
  return node
}
