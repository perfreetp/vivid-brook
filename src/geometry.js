// 几何核心:多边形运算 / 吸附 / 对齐参考线
import pc from 'polygon-clipping';

const union = pc.union;
const intersection = pc.intersection;
const xor = pc.xor;
const difference = pc.difference;
export { union, intersection, xor, difference };

export const TAU = Math.PI * 2;
let _uid = 1;
export const uid = (p = 'e') => `${p}${(_uid++).toString(36)}${Date.now().toString(36).slice(-4)}`;

// ---------- 基础 ----------
export const deg = (d) => (d * Math.PI) / 180;
export function rot([x, y], a) {
  const c = Math.cos(a), s = Math.sin(a);
  return [x * c - y * s, x * s + y * c];
}
export const add = ([ax, ay], [bx, by]) => [ax + bx, ay + by];
export const sub = ([ax, ay], [bx, by]) => [ax - bx, ay - by];
export const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
export const lerp = (a, b, t) => a + (b - a) * t;

// MultiPolygon = [ Polygon ], Polygon = [ Ring ], Ring = [ [x,y], ... ]
export function circlePoly(cx, cy, r, n = 48) {
  const ring = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU;
    ring.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return [[ring]];
}

export function rectPoly(cx, cy, w, h, a = 0) {
  const hw = w / 2, hh = h / 2;
  const pts = [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].map((p) => add(rot(p, a), [cx, cy]));
  return [[pts]];
}

export function capsulePoly(cx, cy, len, w, a = 0, n = 24) {
  // 长条跑道形(流道截面扫掠平面形)
  const hl = Math.max(0, len / 2 - w / 2), r = w / 2;
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const t = -Math.PI / 2 + (i / n) * Math.PI;
    pts.push([hl + r * Math.cos(t), r * Math.sin(t)]);
  }
  for (let i = 0; i <= n; i++) {
    const t = Math.PI / 2 + (i / n) * Math.PI;
    pts.push([-hl + r * Math.cos(t), r * Math.sin(t)]);
  }
  return [[pts.map((p) => add(rot(p, a), [cx, cy]))]];
}

export function fanGatePoly(cx, cy, w1, w2, len, a = 0) {
  // 扇形浇口:窄端接流道,宽端接型腔
  const pts = [[0, -w1 / 2], [len, -w2 / 2], [len, w2 / 2], [0, w1 / 2]];
  return [[pts.map((p) => add(rot(p, a), [cx, cy]))]];
}

export function transformMP(mp, dx, dy, a = 0) {
  const c = Math.cos(a), s = Math.sin(a);
  return mp.map((poly) =>
    poly.map((ring) => ring.map(([x, y]) => [x * c - y * s + dx, x * s + y * c + dy]))
  );
}

export function mirrorMP(mp, axis, pivot) {
  // axis: 'h' 水平翻转(绕竖直轴 x=pivot) | 'v' 垂直翻转(绕水平轴 y=pivot)
  return mp.map((poly) =>
    poly.map((ring) =>
      ring.map(([x, y]) => (axis === 'h' ? [2 * pivot - x, y] : [x, 2 * pivot - y])).reverse()
    )
  );
}

export function rotateMP(mp, cx, cy, a) {
  return mp.map((poly) =>
    poly.map((ring) => ring.map((p) => add(rot(sub(p, [cx, cy]), a), [cx, cy])))
  );
}

export function mpBounds(mp) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const poly of mp)
    for (const ring of poly)
      for (const [x, y] of ring) {
        if (x < x0) x0 = x;
        if (y < y0) y0 = y;
        if (x > x1) x1 = x;
        if (y > y1) y1 = y;
      }
  return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 };
}

export function ringArea(ring) {
  let s = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x1, y1] = ring[i], [x2, y2] = ring[(i + 1) % ring.length];
    s += x1 * y2 - x2 * y1;
  }
  return s / 2;
}

export function pointInRing([px, py], ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function pointInMP(p, mp) {
  for (const poly of mp) {
    if (pointInRing(p, poly[0])) {
      let inHole = false;
      for (let i = 1; i < poly.length; i++) if (pointInRing(p, poly[i])) { inHole = true; break; }
      if (!inHole) return true;
    }
  }
  return false;
}

// ---------- 吸附 ----------
// 收集候选吸附点:端点 / 中点 / 网格
export function collectSnapPoints(entities, excludeIds) {
  const pts = [];
  for (const e of entities) {
    if (excludeIds.has(e.id) || e.hidden) continue;
    for (const p of e.anchors || []) pts.push({ p, type: 'endpoint', src: e.id });
    for (const p of e.midpoints || []) pts.push({ p, type: 'midpoint', src: e.id });
  }
  return pts;
}

export function nearestSnap(world, snapPts, tolPx, scale, gridOn, gridPitch) {
  let best = null;
  const tol = tolPx / scale;
  for (const s of snapPts) {
    const d = dist(world, s.p);
    if (d < tol && (!best || d < best.d)) best = { d, p: s.p, type: s.type };
  }
  if (best) return best;
  if (gridOn) {
    const gx = Math.round(world[0] / gridPitch) * gridPitch;
    const gy = Math.round(world[1] / gridPitch) * gridPitch;
    const d = dist(world, [gx, gy]);
    if (d < tol) return { d, p: [gx, gy], type: 'grid' };
  }
  return null;
}

// 对齐参考线:拖动点与其他图元锚点 x/y 对齐
export function alignmentGuides(world, entities, excludeIds, tolPx, scale) {
  const tol = tolPx / scale;
  let gx = null, gy = null;
  for (const e of entities) {
    if (excludeIds.has(e.id) || e.hidden) continue;
    for (const p of [...(e.anchors || []), ...(e.midpoints || []), ...(e.center ? [e.center] : [])]) {
      if (Math.abs(p[0] - world[0]) < tol) gx = { x: p[0], src: p };
      if (Math.abs(p[1] - world[1]) < tol) gy = { y: p[1], src: p };
    }
  }
  return { gx, gy };
}

// 沿边等距排列:返回 target 边上 n 个等距点(含两端或按 pitch)
export function edgePoints(mp, edgeIdx, n, includeEnds = true) {
  const ring = mp[0][0];
  const a = ring[edgeIdx % ring.length];
  const b = ring[(edgeIdx + 1) % ring.length];
  const pts = [];
  const div = includeEnds ? n - 1 : n + 1;
  for (let i = 0; i < n; i++) {
    const t = includeEnds ? i / Math.max(1, div) : (i + 1) / div;
    pts.push([lerp(a[0], b[0], t), lerp(a[1], b[1], t)]);
  }
  return { pts, a, b };
}

// 点到线段最近点(用于边上吸附/选边)
export function closestOnSegment(p, a, b) {
  const abx = b[0] - a[0], aby = b[1] - a[1];
  const len2 = abx * abx + aby * aby || 1e-9;
  let t = ((p[0] - a[0]) * abx + (p[1] - a[1]) * aby) / len2;
  t = Math.max(0, Math.min(1, t));
  return { p: [a[0] + abx * t, a[1] + aby * t], t };
}

export function nearestEdge(p, mp, tolPx, scale) {
  const tol = tolPx / scale;
  let best = null;
  const ring = mp[0][0];
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    const c = closestOnSegment(p, a, b);
    const d = dist(p, c.p);
    if (d < tol && (!best || d < best.d)) best = { d, edgeIdx: i, a, b, at: c.p };
  }
  return best;
}
