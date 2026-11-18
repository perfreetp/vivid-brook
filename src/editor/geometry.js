// 几何工具：圆周换算、三次贝塞尔展平、窄缝检测、吸附
export const MM = 1 // 内部坐标单位即 mm

export function circumference(diameterMm) {
  return Math.PI * diameterMm
}

// ---------- 三次贝塞尔 ----------
function cubicAt(p0, c1, c2, p3, t) {
  const mt = 1 - t
  const a = mt * mt * mt
  const b = 3 * mt * mt * t
  const c = 3 * mt * t * t
  const d = t * t * t
  return {
    x: a * p0.x + b * c1.x + c * c2.x + d * p3.x,
    y: a * p0.y + b * c1.y + c * c2.y + d * p3.y
  }
}

// 自适应细分，把三次贝塞尔展平为折线（容差 tol mm）
export function flattenCubic(p0, c1, c2, p3, tol = 0.02, depth = 0) {
  if (depth > 18) return [p3]
  // 控制点到弦的距离估算，距离都小于容差即视为直线
  const dx = p3.x - p0.x
  const dy = p3.y - p0.y
  const len2 = dx * dx + dy * dy || 1e-9
  const d1 = Math.abs(dy * c1.x - dx * c1.y + p3.x * p0.y - p3.y * p0.x) / Math.sqrt(len2)
  const d2 = Math.abs(dy * c2.x - dx * c2.y + p3.x * p0.y - p3.y * p0.x) / Math.sqrt(len2)
  if (d1 < tol && d2 < tol) return [p3]
  const t = 0.5
  const p01 = { x: (p0.x + c1.x) / 2, y: (p0.y + c1.y) / 2 }
  const p12 = { x: (c1.x + c2.x) / 2, y: (c1.y + c2.y) / 2 }
  const p23 = { x: (c2.x + p3.x) / 2, y: (c2.y + p3.y) / 2 }
  const p012 = { x: (p01.x + p12.x) / 2, y: (p01.y + p12.y) / 2 }
  const p123 = { x: (p12.x + p23.x) / 2, y: (p12.y + p23.y) / 2 }
  const p0123 = { x: (p012.x + p123.x) / 2, y: (p012.y + p123.y) / 2 }
  return [
    ...flattenCubic(p0, p01, p012, p0123, tol, depth + 1),
    ...flattenCubic(p0123, p123, p23, p3, tol, depth + 1)
  ]
}

// 把一条路径展平成若干条折线环（闭合路径一条环，开放路径一条链）
export function pathToPolylines(path, tol = 0.02) {
  const rings = []
  let current = []
  const nodes = path.nodes
  if (!nodes.length) return rings
  current.push({ x: nodes[0].x, y: nodes[0].y })
  const limit = path.closed ? nodes.length : nodes.length - 1
  for (let i = 0; i < limit; i++) {
    const a = nodes[i]
    const b = nodes[(i + 1) % nodes.length]
    const p0 = { x: a.x, y: a.y }
    const p3 = { x: b.x, y: b.y }
    const c1 = a.hout ? { x: a.x + a.hout.dx, y: a.y + a.hout.dy } : p0
    const c2 = b.hin ? { x: b.x + b.hin.dx, y: b.y + b.hin.dy } : p3
    if (!a.hout && !b.hin) {
      current.push(p3)
    } else {
      current.push(...flattenCubic(p0, c1, c2, p3, tol))
    }
  }
  rings.push(current)
  return rings
}

// ---------- 线段距离 ----------
function distPointSeg(px, py, ax, ay, bx, by) {
  const vx = bx - ax
  const vy = by - ay
  const l2 = vx * vx + vy * vy
  let t = l2 ? ((px - ax) * vx + (py - ay) * vy) / l2 : 0
  t = Math.max(0, Math.min(1, t))
  const cx = ax + t * vx
  const cy = ay + t * vy
  return Math.hypot(px - cx, py - cy)
}

function segSegDist(s1, s2) {
  return Math.min(
    distPointSeg(s1.a.x, s1.a.y, s2.a.x, s2.a.y, s2.b.x, s2.b.y),
    distPointSeg(s1.b.x, s1.b.y, s2.a.x, s2.a.y, s2.b.x, s2.b.y),
    distPointSeg(s2.a.x, s2.a.y, s1.a.x, s1.a.y, s1.b.x, s1.b.y),
    distPointSeg(s2.b.x, s2.b.y, s1.a.x, s1.a.y, s1.b.x, s1.b.y)
  )
}

// 空间分桶加速的窄缝检测：返回所有间距 < thresholdMm 的线段对
export function findNarrowGaps(rings, thresholdMm) {
  const segs = []
  rings.forEach((ring, ri) => {
    for (let i = 0; i < ring.length - 1; i++) {
      segs.push({ a: ring[i], b: ring[i + 1], ri, si: i, key: `${ri}:${i}` })
    }
  })
  const cell = Math.max(thresholdMm, 0.5)
  const buckets = new Map()
  const keyOf = (x, y) => `${Math.floor(x / cell)},${Math.floor(y / cell)}`
  segs.forEach((s) => {
    const minX = Math.min(s.a.x, s.b.x) - thresholdMm
    const maxX = Math.max(s.a.x, s.b.x) + thresholdMm
    const minY = Math.min(s.a.y, s.b.y) - thresholdMm
    const maxY = Math.max(s.a.y, s.b.y) + thresholdMm
    const touched = new Set()
    for (let gx = Math.floor(minX / cell); gx <= Math.floor(maxX / cell); gx++) {
      for (let gy = Math.floor(minY / cell); gy <= Math.floor(maxY / cell); gy++) {
        touched.add(`${gx},${gy}`)
      }
    }
    s.buckets = touched
    touched.forEach((k) => {
      if (!buckets.has(k)) buckets.set(k, [])
      buckets.get(k).push(s)
    })
  })
  const results = []
  const seen = new Set()
  for (const s of segs) {
    const candidates = new Set()
    s.buckets.forEach((k) => (buckets.get(k) || []).forEach((o) => candidates.add(o)))
    for (const o of candidates) {
      if (o === s) continue
      const pairKey = s.key < o.key ? `${s.key}|${o.key}` : `${o.key}|${s.key}`
      if (seen.has(pairKey)) continue
      seen.add(pairKey)
      // 窄缝指不同轮廓（环）之间的间隙；同一环的段在节点处共端点，跳过
      if (s.ri === o.ri) continue
      const d = segSegDist(s, o)
      if (d < thresholdMm) {
        const mx = (s.a.x + s.b.x + o.a.x + o.b.x) / 4
        const my = (s.a.y + s.b.y + o.a.y + o.b.y) / 4
        results.push({ x: mx, y: my, distance: +d.toFixed(3), seg1: s.key, seg2: o.key })
      }
    }
  }
  return results.sort((a, b) => a.distance - b.distance)
}

// ---------- 吸附 ----------
export function buildSnapCandidates(doc) {
  const W = circumference(doc.shaft.diameterMm)
  const L = doc.shaft.lengthMm
  const out = []
  // 网格交点（环向等分线 × 轴向网格）
  if (doc.grid.snapGrid) {
    const div = doc.grid.divisions
    const yStep = doc.grid.axialStepMm
    for (let i = 0; i <= div; i++) {
      for (let y = 0; y <= L + 1e-6; y += yStep) {
        out.push({ x: (W * i) / div, y, kind: 'grid' })
      }
    }
  }
  // 中心线
  if (doc.grid.snapCenter) out.push({ x: W / 2, y: L / 2, kind: 'center' })
  // 拼缝边
  out.push({ x: 0, y: L / 2, kind: 'seam' }, { x: W, y: L / 2, kind: 'seam' })
  // 其它路径端点
  if (doc.grid.snapEndpoints) {
    doc.layers.forEach((layer) => {
      if (!layer.visible) return
      layer.paths.forEach((p) => {
        if (!p.nodes.length) return
        const first = p.nodes[0]
        const last = p.nodes[p.nodes.length - 1]
        out.push({ x: first.x, y: first.y, kind: 'endpoint', pathId: p.id })
        if (!p.closed && last !== first) out.push({ x: last.x, y: last.y, kind: 'endpoint', pathId: p.id })
      })
    })
  }
  return out
}

export function snapPoint(x, y, candidates, thresholdMm, excludePathId = null) {
  let best = null
  let bestD = thresholdMm
  for (const c of candidates) {
    if (c.pathId && c.pathId === excludePathId) continue
    const d = Math.hypot(c.x - x, c.y - y)
    if (d <= bestD) {
      bestD = d
      best = c
    }
  }
  return best ? { x: best.x, y: best.y, target: best, distance: +bestD.toFixed(3) } : null
}

// 限制在画布范围内
export function clampToCanvas(x, y, doc) {
  const W = circumference(doc.shaft.diameterMm)
  const L = doc.shaft.lengthMm
  return { x: Math.max(0, Math.min(W, x)), y: Math.max(0, Math.min(L, y)) }
}

// 在路径上找距离点击点最近的参数位置（用于点边加节点）
export function nearestPointOnPath(path, px, py) {
  let best = null
  const nodes = path.nodes
  const limit = path.closed ? nodes.length : nodes.length - 1
  for (let i = 0; i < limit; i++) {
    const a = nodes[i]
    const b = nodes[(i + 1) % nodes.length]
    const p0 = { x: a.x, y: a.y }
    const p3 = { x: b.x, y: b.y }
    const c1 = a.hout ? { x: a.x + a.hout.dx, y: a.y + a.hout.dy } : p0
    const c2 = b.hin ? { x: b.x + b.hin.dx, y: b.y + b.hin.dy } : p3
    const steps = 48
    for (let s = 0; s <= steps; s++) {
      const t = s / steps
      const pt = (!a.hout && !b.hin)
        ? { x: p0.x + (p3.x - p0.x) * t, y: p0.y + (p3.y - p0.y) * t }
        : cubicAt(p0, c1, c2, p3, t)
      const d = Math.hypot(pt.x - px, pt.y - py)
      if (!best || d < best.d) best = { d, index: i, t, point: pt }
    }
  }
  return best
}
