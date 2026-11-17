// 样条曲线内核:锚点 + 切线手柄的三次有理贝塞尔(每锚点带权重)
// anchors: [{ x, y, hin:{x,y}, hout:{x,y}, weight }]

export function evalSeg(a0, a1, t) {
  const w0 = a0.weight ?? 1, w3 = a1.weight ?? 1
  const mt = 1 - t
  const b0 = mt * mt * mt, b1 = 3 * mt * mt * t, b2 = 3 * mt * t * t, b3 = t * t * t
  const den = b0 * w0 + b1 + b2 + b3 * w3 || 1e-12
  return {
    x: (b0 * w0 * a0.x + b1 * a0.hout.x + b2 * a1.hin.x + b3 * w3 * a1.x) / den,
    y: (b0 * w0 * a0.y + b1 * a0.hout.y + b2 * a1.hin.y + b3 * w3 * a1.y) / den
  }
}

function sampleAt(anchors, s, t, nSeg) {
  const eps = 1e-3
  const at = (sg, tt) => {
    if (tt < 0) { if (sg > 0) return evalSeg(anchors[sg - 1], anchors[sg], 1 + tt); tt = 0 }
    if (tt > 1) { if (sg < nSeg - 1) return evalSeg(anchors[sg + 1], anchors[sg + 2], tt - 1); tt = 1 }
    return evalSeg(anchors[sg], anchors[sg + 1], tt)
  }
  const p = evalSeg(anchors[s], anchors[s + 1], t)
  let dx, dy, ddx, ddy
  const canCentral = !(t - eps < 0 && s === 0) && !(t + eps > 1 && s === nSeg - 1)
  if (canCentral) {
    const pm = at(s, t - eps), pp = at(s, t + eps)
    dx = (pp.x - pm.x) / (2 * eps); dy = (pp.y - pm.y) / (2 * eps)
    ddx = (pp.x - 2 * p.x + pm.x) / (eps * eps); ddy = (pp.y - 2 * p.y + pm.y) / (eps * eps)
  } else if (t - eps < 0 && s === 0) {
    // 左端点:前向差分
    const p1 = at(s, t + eps), p2 = at(s, t + 2 * eps)
    dx = (-3 * p.x + 4 * p1.x - p2.x) / (2 * eps); dy = (-3 * p.y + 4 * p1.y - p2.y) / (2 * eps)
    ddx = (p.x - 2 * p1.x + p2.x) / (eps * eps); ddy = (p.y - 2 * p1.y + p2.y) / (eps * eps)
  } else {
    // 右端点:后向差分
    const p1 = at(s, t - eps), p2 = at(s, t - 2 * eps)
    dx = (3 * p.x - 4 * p1.x + p2.x) / (2 * eps); dy = (3 * p.y - 4 * p1.y + p2.y) / (2 * eps)
    ddx = (p.x - 2 * p1.x + p2.x) / (eps * eps); ddy = (p.y - 2 * p1.y + p2.y) / (eps * eps)
  }
  const sp = Math.pow(dx * dx + dy * dy, 1.5) || 1e-12
  const k = (dx * ddy - dy * ddx) / sp
  const len = Math.hypot(dx, dy) || 1e-12
  const tx = dx / len, ty = dy / len
  return { x: p.x, y: p.y, tx, ty, nx: -ty, ny: tx, k, seg: s, t, u: 0 }
}

// 按每段采样数采样整条样条,返回带切线/法线/曲率的采样点
export function sampleSpline(anchors, nPer = 24) {
  if (!anchors || anchors.length < 2) return []
  const nSeg = anchors.length - 1
  const pts = []
  for (let s = 0; s < nSeg; s++)
    for (let j = 0; j < nPer; j++) pts.push(sampleAt(anchors, s, j / nPer, nSeg))
  pts.push(sampleAt(anchors, nSeg - 1, 1, nSeg))
  pts.forEach((p, i) => (p.u = i / (pts.length - 1)))
  return pts
}

// 曲率突变检测:相邻采样点曲率差超过阈值即标记(返回布尔数组,标在区间右端点上)
export function curvatureJumps(samples, thresh) {
  const flags = new Array(samples.length).fill(false)
  for (let i = 1; i < samples.length; i++)
    if (Math.abs(samples[i].k - samples[i - 1].k) > thresh) flags[i] = true
  return flags
}

// de Casteljau 在 seg 段 t 处插入新锚点(几何保持,权重近似为 1)
export function splitSegment(anchors, si, t) {
  const a0 = anchors[si], a1 = anchors[si + 1]
  const lerp = (a, b) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })
  const P0 = { x: a0.x, y: a0.y }, P3 = { x: a1.x, y: a1.y }
  const Q0 = lerp(P0, a0.hout), Q1 = lerp(a0.hout, a1.hin), Q2 = lerp(a1.hin, P3)
  const R0 = lerp(Q0, Q1), R1 = lerp(Q1, Q2)
  const S = lerp(R0, R1)
  const na = anchors.slice()
  na[si] = { ...a0, hout: Q0 }
  na[si + 1] = { ...a1, hin: Q2 }
  na.splice(si + 1, 0, { x: S.x, y: S.y, hin: R0, hout: R1, weight: 1 })
  return na
}

// 让选中锚点的两个手柄共线等长(光顺)
export function smoothAnchor(a) {
  const dx = a.hout.x - a.x, dy = a.hout.y - a.y
  const l1 = Math.hypot(dx, dy) || 1
  const l2 = Math.hypot(a.hin.x - a.x, a.hin.y - a.y) || 1
  return {
    ...a,
    hout: { x: a.x + (dx / l1) * l1, y: a.y + (dy / l1) * l1 },
    hin: { x: a.x - (dx / l1) * l2, y: a.y - (dy / l1) * l2 }
  }
}

// 找到样条上距 (x,y) 最近的 (seg, t),用于点击加点
export function closestOnSpline(anchors, x, y, coarse = 40) {
  const pts = sampleSpline(anchors, coarse)
  let best = null, bd = Infinity
  for (const p of pts) {
    const d = (p.x - x) ** 2 + (p.y - y) ** 2
    if (d < bd) { bd = d; best = p }
  }
  if (!best) return null
  // 在粗采样邻域内二分细化
  let s = best.seg, lo = Math.max(0, best.t - 1 / coarse), hi = Math.min(1, best.t + 1 / coarse)
  for (let it = 0; it < 24; it++) {
    const m1 = lo + (hi - lo) / 3, m2 = hi - (hi - lo) / 3
    const p1 = evalSeg(anchors[s], anchors[s + 1], m1)
    const p2 = evalSeg(anchors[s], anchors[s + 1], m2)
    if ((p1.x - x) ** 2 + (p1.y - y) ** 2 < (p2.x - x) ** 2 + (p2.y - y) ** 2) hi = m2
    else lo = m1
  }
  return { seg: s, t: (lo + hi) / 2 }
}

export function defaultAnchors() {
  // 默认指腹截面:手柄共线,型面光顺
  return [
    { x: -48, y: 0,  hin: { x: -60, y: 0 },    hout: { x: -42, y: 12 },  weight: 1 },
    { x: -34, y: 26, hin: { x: -45.8, y: 16.7 }, hout: { x: -22.2, y: 35.3 }, weight: 1 },
    { x: 0,   y: 38, hin: { x: -16, y: 38 },   hout: { x: 16, y: 38 },   weight: 1 },
    { x: 34,  y: 26, hin: { x: 22.2, y: 35.3 }, hout: { x: 45.8, y: 16.7 }, weight: 1 },
    { x: 48,  y: 0,  hin: { x: 42, y: 12 },    hout: { x: 60, y: 0 },    weight: 1 }
  ]
}
