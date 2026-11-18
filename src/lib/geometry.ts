import type { Pt, SnapResult, SnapType, SelfIntersection, Feature, BooleanOp, DistanceLabel } from '../types';
import polygonClipping, { type MultiPolygon, type Polygon, type Pair } from 'polygon-clipping';

export const GRID_SIZE = 20; // 20 米网格
export const SNAP_PIXEL = 12; // 吸附屏幕像素阈值

let idCounter = 0;
export const uid = (prefix = 'id'): string =>
  `${prefix}_${Date.now().toString(36)}_${(idCounter++).toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;

export const pt = (x: number, y: number): Pt => ({ x, y });
export const add = (a: Pt, b: Pt): Pt => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a: Pt, b: Pt): Pt => ({ x: a.x - b.x, y: a.y - b.y });
export const scale = (a: Pt, s: number): Pt => ({ x: a.x * s, y: a.y * s });
export const dot = (a: Pt, b: Pt): number => a.x * b.x + a.y * b.y;
export const cross = (a: Pt, b: Pt): number => a.x * b.y - a.y * b.x;
export const len = (a: Pt): number => Math.hypot(a.x, a.y);
export const dist = (a: Pt, b: Pt): number => Math.hypot(a.x - b.x, a.y - b.y);
export const mid = (a: Pt, b: Pt): Pt => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
export const norm = (a: Pt): Pt => {
  const l = len(a) || 1;
  return { x: a.x / l, y: a.y / l };
};
export const round2 = (v: number): number => Math.round(v * 100) / 100;
export const fmtDist = (v: number): string => `${v >= 100 ? v.toFixed(0) : v.toFixed(1)} m`;

/** 视图变换：世界坐标(米) ↔ 屏幕坐标(像素)，y 轴翻转（测量坐标北朝上） */
export interface ViewTransform {
  scale: number; // 像素/米
  ox: number; // 屏幕原点
  oy: number;
  width: number;
  height: number;
}

export const worldToScreen = (p: Pt, vt: ViewTransform): Pt => ({
  x: p.x * vt.scale + vt.ox,
  y: -p.y * vt.scale + vt.oy,
});
export const screenToWorld = (p: Pt, vt: ViewTransform): Pt => ({
  x: (p.x - vt.ox) / vt.scale,
  y: -(p.y - vt.oy) / vt.scale,
});

// ---------- 线段交点 ----------
/** 两线段交点，返回参数 t/u 与交点；无交点返回 null */
export function segIntersection(p1: Pt, p2: Pt, p3: Pt, p4: Pt): { p: Pt; t: number; u: number } | null {
  const r = sub(p2, p1);
  const s = sub(p4, p3);
  const denom = cross(r, s);
  if (Math.abs(denom) < 1e-12) return null;
  const qp = sub(p3, p1);
  const t = cross(qp, s) / denom;
  const u = cross(qp, r) / denom;
  if (t < -1e-9 || t > 1 + 1e-9 || u < -1e-9 || u > 1 + 1e-9) return null;
  return { p: add(p1, scale(r, t)), t, u };
}

/** 点到线段的最近点与距离 */
export function pointSegDist(p: Pt, a: Pt, b: Pt): { nearest: Pt; distance: number; t: number } {
  const ab = sub(b, a);
  const l2 = dot(ab, ab);
  if (l2 < 1e-12) return { nearest: a, distance: dist(p, a), t: 0 };
  const t = Math.min(1, Math.max(0, dot(sub(p, a), ab) / l2));
  const nearest = add(a, scale(ab, t));
  return { nearest, distance: dist(p, nearest), t };
}

/** 闭合路径自交检测（含边相邻的共享端点不算自交） */
export function findSelfIntersections(points: Pt[]): SelfIntersection[] {
  const n = points.length;
  if (n < 4) return [];
  const out: SelfIntersection[] = [];
  const segCount = n; // 闭合：首尾相连
  for (let i = 0; i < segCount; i++) {
    const a = points[i];
    const b = points[(i + 1) % n];
    for (let j = i + 1; j < segCount; j++) {
      // 相邻边共享端点，跳过
      if (j === i + 1 || (i === 0 && j === segCount - 1)) continue;
      const c = points[j];
      const d = points[(j + 1) % n];
      const hit = segIntersection(a, b, c, d);
      if (hit && hit.t > 1e-6 && hit.t < 1 - 1e-6 && hit.u > 1e-6 && hit.u < 1 - 1e-6) {
        out.push({ p: hit.p, segA: [i, (i + 1) % n], segB: [j, (j + 1) % n] });
      }
    }
  }
  return out;
}

// ---------- 吸附 ----------
type SnapCandidate = { p: Pt; dpx: number; type: SnapType; guide?: { a: Pt; b: Pt } };
const PRIORITY: Record<SnapType, number> = {
  endpoint: 0,
  midpoint: 1,
  horizontal: 2,
  vertical: 2,
  grid: 3,
};

/**
 * 收集候选吸附点并按优先级返回：端点 > 中点 > 水平/垂直对齐 > 20m 网格。
 * 同优先级内取屏幕距离最近者。
 */
export function snapPoint(
  raw: Pt,
  features: Feature[],
  editingId: string | null,
  vt: ViewTransform,
): SnapResult | null {
  const tol = SNAP_PIXEL / vt.scale; // 世界坐标容差（米）
  const sp = worldToScreen(raw, vt);
  const candidates: SnapCandidate[] = [];

  const consider = (p: Pt, type: SnapType, guide?: { a: Pt; b: Pt }) => {
    const dpx = dist(worldToScreen(p, vt), sp);
    if (dpx <= SNAP_PIXEL) candidates.push({ p, dpx, type, guide });
  };

  // 端点 & 中点（其它要素）
  for (const f of features) {
    if (!f.visible || f.id === editingId) continue;
    const pts = f.points;
    for (const v of pts) consider(v, 'endpoint');
    const segN = f.pathType === 'closed' ? pts.length : pts.length - 1;
    for (let i = 0; i < segN; i++) {
      consider(mid(pts[i], pts[(i + 1) % pts.length]), 'midpoint');
    }
  }
  // 正在编辑要素自身的其它顶点也可吸附
  if (editingId) {
    const self = features.find((f) => f.id === editingId);
    if (self) {
      for (const v of self.points) {
        if (dist(v, raw) > 1e-6) consider(v, 'endpoint');
      }
    }
  }

  // 水平 / 垂直对齐（与其它顶点 x 或 y 相同）
  for (const f of features) {
    if (!f.visible) continue;
    for (const v of f.points) {
      if (Math.abs(v.x - raw.x) <= tol) {
        const aligned = { x: v.x, y: raw.y };
        consider(aligned, 'vertical', { a: { x: v.x, y: v.y }, b: aligned });
      }
      if (Math.abs(v.y - raw.y) <= tol) {
        const aligned = { x: raw.x, y: v.y };
        consider(aligned, 'horizontal', { a: { x: v.x, y: v.y }, b: aligned });
      }
    }
  }

  // 20m 网格（优先级最低，兜底）
  consider(
    {
      x: Math.round(raw.x / GRID_SIZE) * GRID_SIZE,
      y: Math.round(raw.y / GRID_SIZE) * GRID_SIZE,
    },
    'grid',
  );

  if (candidates.length === 0) return null;
  candidates.sort((a, b) => PRIORITY[a.type] - PRIORITY[b.type] || a.dpx - b.dpx);
  const chosen = candidates[0];
  return { point: chosen.p, type: chosen.type, guideLine: chosen.guide };
}

// ---------- 开放路径双侧等距偏移 ----------
/**
 * 沿开放折线按给定距离做双侧偏移，生成两条平行沟沿折线。
 * 采用逐顶点 miter 接头；world 坐标系 y 朝北，屏幕渲染时再翻转。
 */
export function offsetOpenPath(points: Pt[], distance: number): { left: Pt[]; right: Pt[] } {
  const n = points.length;
  if (n < 2) return { left: points.map((p) => ({ ...p })), right: points.map((p) => ({ ...p })) };

  const left: Pt[] = [];
  const right: Pt[] = [];

  for (let i = 0; i < n; i++) {
    const prev = points[Math.max(0, i - 1)];
    const next = points[Math.min(n - 1, i + 1)];
    const dir = norm(sub(next, prev));
    // 法线（左侧 / 右侧）
    const normalL = { x: -dir.y, y: dir.x };
    if (i === 0 || i === n - 1) {
      left.push(add(points[i], scale(normalL, distance)));
      right.push(add(points[i], scale(normalL, -distance)));
    } else {
      // miter: 用相邻两段法线的平均方向，按转角修正长度
      const d1 = norm(sub(points[i], prev));
      const d2 = norm(sub(next, points[i]));
      const n1 = { x: -d1.y, y: d1.x };
      const n2 = { x: -d2.y, y: d2.x };
      const bisector = norm(add(n1, n2));
      const denom = Math.max(0.2, dot(bisector, n1)); // 限制极端尖角
      const miterLen = Math.min(distance / denom, distance * 4);
      left.push(add(points[i], scale(bisector, miterLen)));
      right.push(add(points[i], scale(bisector, -miterLen)));
    }
  }
  return { left, right };
}

/** 闭合多边形等距外扩/内缩（简化 miter 环） */
export function offsetClosedRing(points: Pt[], distance: number): Pt[] {
  const n = points.length;
  if (n < 3) return points.map((p) => ({ ...p }));
  const out: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const prev = points[(i - 1 + n) % n];
    const cur = points[i];
    const next = points[(i + 1) % n];
    const d1 = norm(sub(cur, prev));
    const d2 = norm(sub(next, cur));
    const n1 = { x: -d1.y, y: d1.x };
    const n2 = { x: -d2.y, y: d2.x };
    const bisector = norm(add(n1, n2));
    const denom = Math.max(0.2, Math.abs(dot(bisector, n1)));
    const miterLen = Math.min(distance / denom, distance * 4);
    out.push(add(cur, scale(bisector, miterLen)));
  }
  return out;
}

// ---------- 多边形缓冲（开放路径 → 闭合面，用于布尔运算） ----------
/** 开放折线按半宽缓冲为闭合多边形（左右偏移线 + 端头封口） */
export function bufferOpenPath(points: Pt[], halfWidth: number): Pt[] {
  if (points.length < 2) return [];
  const { left, right } = offsetOpenPath(points, halfWidth);
  return [...left, ...right.reverse()];
}

// ---------- 布尔运算 ----------
const ringToPair = (ring: Pt[]): Pair[] => ring.map((p) => [p.x, p.y] as Pair);
const pairToPt = (pair: Pair): Pt => ({ x: pair[0], y: pair[1] });

const fToPolygon = (f: Feature): Polygon | null => {
  if (f.pathType === 'open') {
    const buffered = bufferOpenPath(f.points, Math.max(f.width / 2, 0.5));
    if (buffered.length < 3) return null;
    return [ringToPair(buffered)];
  }
  return [ringToPair(f.points), ...f.holes.map(ringToPair)];
};

export interface BooleanResult {
  polygons: Pt[][][]; // 每个元素：[外环, 孔洞...]
}

export function runBoolean(op: BooleanOp, features: Feature[]): BooleanResult {
  const operands = features.map(fToPolygon).filter((p): p is Polygon => p !== null);
  if (operands.length === 0) return { polygons: [] };
  let clipped: MultiPolygon;
  if (op === 'union') {
    clipped = polygonClipping.union(...(operands as [Polygon, ...Polygon[]]));
  } else if (op === 'intersection') {
    clipped = operands.reduce(
      (acc, cur) => polygonClipping.intersection(acc, cur),
      [operands[0]] as MultiPolygon,
    );
  } else {
    // 差集：第一个要素减去其余全部（用于渠底轮廓、池埂交线剪缺口）
    clipped = operands.reduce(
      (acc, cur, idx) => (idx === 0 ? acc : polygonClipping.difference(acc, cur)),
      [operands[0]] as MultiPolygon,
    );
  }
  const polygons = clipped.map((poly) => poly.map((ring) => ring.map(pairToPt)));
  return { polygons };
}

// ---------- 距离标注（拖动时邻近要素间距） ----------
export function nearestDistanceLabel(dragged: Pt, features: Feature[], excludeId: string): DistanceLabel | null {
  let best: DistanceLabel | null = null;
  for (const f of features) {
    if (f.id === excludeId || !f.visible) continue;
    const pts = f.points;
    const segN = f.pathType === 'closed' ? pts.length : pts.length - 1;
    for (let i = 0; i < segN; i++) {
      const r = pointSegDist(dragged, pts[i], pts[(i + 1) % pts.length]);
      if (!best || r.distance < best.distance) {
        best = { from: dragged, to: r.nearest, distance: r.distance };
      }
    }
  }
  return best;
}

// ---------- 路径工具 ----------
export function reversePoints(points: Pt[]): Pt[] {
  return [...points].reverse();
}

/** 在最接近点击位置的线段上插入顶点，返回新数组与插入索引 */
export function insertVertex(points: Pt[], p: Pt, closed: boolean): { points: Pt[]; index: number } | null {
  let best: { t: number; i: number; d: number } | null = null;
  const segN = closed ? points.length : points.length - 1;
  for (let i = 0; i < segN; i++) {
    const r = pointSegDist(p, points[i], points[(i + 1) % points.length]);
    if (!best || r.distance < best.d) best = { t: r.t, i, d: r.distance };
  }
  if (!best) return null;
  const next = [...points];
  const a = next[best.i];
  const b = next[(best.i + 1) % next.length];
  const newPt = mid(a, b);
  next.splice(best.i + 1, 0, newPt);
  return { points: next, index: best.i + 1 };
}

/** 多边形面积（鞋带公式，米²） */
export function polygonArea(points: Pt[]): number {
  if (points.length < 3) return 0;
  let s = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    s += a.x * b.y - b.x * a.y;
  }
  return Math.abs(s) / 2;
}

/** 折线长度（米） */
export function polylineLength(points: Pt[], closed: boolean): number {
  let s = 0;
  const n = closed ? points.length : points.length - 1;
  for (let i = 0; i < n; i++) s += dist(points[i], points[(i + 1) % points.length]);
  return s;
}

/** 框选：返回落在矩形内的顶点所在要素 id（矩形内包含任一顶点即选中） */
export function featuresInRect(features: Feature[], a: Pt, b: Pt): string[] {
  const minX = Math.min(a.x, b.x);
  const maxX = Math.max(a.x, b.x);
  const minY = Math.min(a.y, b.y);
  const maxY = Math.max(a.y, b.y);
  const ids: string[] = [];
  for (const f of features) {
    if (!f.visible) continue;
    if (f.points.some((p) => p.x >= minX && p.x <= maxX && p.y >= minY && p.y <= maxY)) ids.push(f.id);
  }
  return ids;
}

/** 点是否在多边形内（射线法） */
export function pointInPolygon(p: Pt, ring: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i];
    const b = ring[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}
