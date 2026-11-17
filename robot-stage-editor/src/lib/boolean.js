// 多边形布尔运算（Greiner–Hormann 标准实现）
// 输入: subject/clip 为 [{x,y,smooth?,r?}] 闭合轮廓（顺时针归一化）
// 输出: { contours: [[{x,y,smooth,r}], ...] }
import { pointInPolygon, segmentIntersection, signedArea, EPS } from './geometry.js'

function makeVerts(poly) {
  return poly.map(p => ({
    x: p.x, y: p.y, smooth: !!p.smooth, r: p.r || 0,
    inter: false, entry: false, alpha: 0, next: null, prev: null, neighbor: null, visited: false
  }))
}
function link(verts) {
  for (let i = 0; i < verts.length; i++) {
    verts[i].next = verts[(i + 1) % verts.length]
    verts[i].prev = verts[(i - 1 + verts.length) % verts.length]
  }
}
// 在 anchor -> anchor.next 边上按 alpha 有序插入交点
function insertOnEdge(anchor, iv) {
  let node = anchor
  // 沿链寻找最后一个 alpha 不大于 iv.alpha 的交点
  while (node.next.inter && node.next !== anchor && node.next.alpha <= iv.alpha + EPS * 10) {
    if (Math.abs(node.next.alpha - iv.alpha) < EPS * 10) return node.next // 同点合并
    node = node.next
  }
  iv.prev = node
  iv.next = node.next
  node.next.prev = iv
  node.next = iv
  return iv
}

function noIntersectionCase(subject, clip, op) {
  const sIn = pointInPolygon(subject[0], clip)
  const cIn = pointInPolygon(clip[0], subject)
  if (op === 'union') {
    if (sIn) return [clip]
    if (cIn) return [subject]
    return [subject, clip]
  }
  if (op === 'intersect') {
    if (sIn) return [subject]
    if (cIn) return [clip]
    return []
  }
  // difference: subject - clip
  if (sIn) return []
  return [subject]
}

// 方向由几何判定：交点下一顶点相对另一多边形的内外关系决定
// - union: 下一顶点在外部 -> 取该方向(forward)；内部 -> 反向
// - intersect: 下一顶点在内部 -> forward；外部 -> 反向
// - difference: subject 上内部->反向、外部->forward；clip 上规则与 intersect 相反
function shouldForward(op, onSubject, v, otherPlain) {
  const probe = v.next
  const inside = pointInPolygon({ x: probe.x, y: probe.y }, otherPlain)
  if (op === 'union') return !inside
  if (op === 'intersect') return inside
  return onSubject ? !inside : inside
}

// 沿当前链按方向走到下一个交点（含沿途普通顶点）
function walkToNextInter(v, forward) {
  const pts = []
  let cur = forward ? v.next : v.prev
  let guard = 0
  while (!cur.inter && guard++ < 20000) {
    pts.push({ x: cur.x, y: cur.y, smooth: cur.smooth, r: cur.r, isIntersection: false })
    cur = forward ? cur.next : cur.prev
  }
  return { node: cur, pts }
}

function trace(S, C, op) {
  const contours = []
  const cPlain = C.filter(v => !v.inter).map(v => ({ x: v.x, y: v.y }))
  const sPlain = S.filter(v => !v.inter).map(v => ({ x: v.x, y: v.y }))
  const starts = []
  let n = S[0], g0 = 0
  do { if (n.inter && !n.visited) starts.push(n); n = n.next } while (n !== S[0] && ++g0 < 20000)

  for (const first of starts) {
    if (first.visited) continue
    const contour = []
    let cur = first
    let onSubject = true
    let guard = 0
    do {
      cur.visited = true
      if (cur.neighbor) cur.neighbor.visited = true // 两链上的同一交点同时消费
      contour.push({ x: cur.x, y: cur.y, smooth: cur.smooth, r: cur.r, isIntersection: true })
      const forward = shouldForward(op, onSubject, cur, onSubject ? cPlain : sPlain)
      const { node: nextInter, pts } = walkToNextInter(cur, forward)
      contour.push(...pts)
      cur = nextInter.neighbor // 换链
      onSubject = !onSubject
      if (++guard > 20000) break
    } while (cur !== first && cur.inter && guard < 20000)
    if (contour.length >= 3 && Math.abs(signedArea(contour)) > 1e-4) contours.push(contour)
  }
  return contours
}

export function booleanPolygons(subjectIn, clipIn, op) {
  if (!['union', 'intersect', 'difference'].includes(op)) throw new Error('未知布尔运算: ' + op)
  const subject = subjectIn.map(p => ({ ...p }))
  const clip = clipIn.map(p => ({ ...p }))
  if (signedArea(subject) < 0) subject.reverse()
  if (signedArea(clip) < 0) clip.reverse()

  const S = makeVerts(subject), C = makeVerts(clip)
  link(S); link(C)
  // 同点交点去重（顶点接触会被相邻两条边同时检测到）
  const keyOf = (p) => `${Math.round(p.x * 1e5)},${Math.round(p.y * 1e5)}`
  const sMap = new Map(), cMap = new Map()

  let hasInter = false
  for (let i = 0; i < S.length; i++) {
    const a = S[i], b = S[(i + 1) % S.length]
    for (let j = 0; j < C.length; j++) {
      const c = C[j], d = C[(j + 1) % C.length]
      const hits = segmentIntersection(a, b, c, d)
      if (!hits) continue
      const list = Array.isArray(hits) ? hits : [hits]
      for (const hit of list) {
        // 仅当交点同时落在两条边的顶点上（顶点-顶点接触）才忽略；
        // 顶点落在对方边内部的交点必须保留，否则追踪链断裂
        const tAtVert = hit.t <= EPS || hit.t >= 1 - EPS
        const uAtVert = hit.u <= EPS || hit.u >= 1 - EPS
        if (tAtVert && uAtVert) continue
        hasInter = true
        const k = keyOf(hit.p)
        let ivS = sMap.get(k), ivC = cMap.get(k)
        if (!ivS) {
          // 交点继承边起点的圆角/平滑元数据，保证布尔结果轮廓保留圆角风格
          ivS = { x: hit.p.x, y: hit.p.y, inter: true, entry: false, alpha: hit.t, next: null, prev: null, neighbor: null, visited: false, smooth: a.smooth, r: a.r || 0 }
          insertOnEdge(a, ivS); sMap.set(k, ivS)
        }
        if (!ivC) {
          ivC = { x: hit.p.x, y: hit.p.y, inter: true, entry: false, alpha: hit.u, next: null, prev: null, neighbor: null, visited: false, smooth: c.smooth, r: c.r || 0 }
          insertOnEdge(c, ivC); cMap.set(k, ivC)
        }
        ivS.neighbor = ivC; ivC.neighbor = ivS
        // 两条来源边任一带有圆角，交点即保留圆角
        ivS.r = Math.max(ivS.r, a.r || 0); ivC.r = Math.max(ivC.r, c.r || 0)
        ivS.smooth = ivS.smooth || a.smooth; ivC.smooth = ivC.smooth || c.smooth
      }
    }
  }

  if (!hasInter) return { contours: noIntersectionCase(subject, clip, op) }

  let contours = trace(S, C, op)
  if (!contours.length) {
    const fb = noIntersectionCase(subject, clip, op)
    return { contours: fb }
  }
  contours = contours.map(c => signedArea(c) < 0 ? (c.reverse(), c) : c)
  return { contours }
}

// 合并距离过近的重叠节点，保留圆角信息
export function mergeCloseNodes(contour, tol = 2) {
  const out = []
  for (const p of contour) {
    const last = out[out.length - 1]
    if (last && Math.hypot(last.x - p.x, last.y - p.y) < tol) {
      last.smooth = last.smooth || p.smooth
      last.r = Math.max(last.r || 0, p.r || 0)
    } else out.push({ ...p })
  }
  if (out.length > 1) {
    const f = out[0], l = out[out.length - 1]
    if (Math.hypot(f.x - l.x, f.y - l.y) < tol) {
      f.smooth = f.smooth || l.smooth
      f.r = Math.max(f.r || 0, l.r || 0)
      out.pop()
    }
  }
  return out
}
