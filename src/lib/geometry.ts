import type { Vec2, Vec3 } from '../types';

export const TAU = Math.PI * 2;

export function dist2(ax: number, ay: number, bx: number, by: number): number {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy;
}

export function dist(ax: number, ay: number, bx: number, by: number): number {
  return Math.sqrt(dist2(ax, ay, bx, by));
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function deg2rad(d: number): number {
  return (d * Math.PI) / 180;
}

export function rad2deg(r: number): number {
  return (r * 180) / Math.PI;
}

/** 点到线段的最近点，返回最近点、参数 t、距离 */
export function closestOnSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): { x: number; y: number; t: number; d: number } {
  const vx = bx - ax;
  const vy = by - ay;
  const len2 = vx * vx + vy * vy;
  let t = len2 === 0 ? 0 : ((px - ax) * vx + (py - ay) * vy) / len2;
  t = clamp(t, 0, 1);
  const x = ax + vx * t;
  const y = ay + vy * t;
  return { x, y, t, d: dist(px, py, x, y) };
}

export interface PolylineInfo {
  points: Vec3[];
  cum: number[]; // 各顶点累计里程
  total: number;
}

export function polylineInfo(points: Vec3[]): PolylineInfo {
  const cum = [0];
  for (let i = 1; i < points.length; i++) {
    cum.push(cum[i - 1] + dist(points[i - 1][0], points[i - 1][1], points[i][0], points[i][1]));
  }
  return { points, cum, total: cum[cum.length - 1] ?? 0 };
}

/** 按归一化桩号 0..1 取中线位置（含 z 插值） */
export function sampleAtStation(
  info: PolylineInfo,
  station: number,
): { x: number; y: number; z: number; s: number; azimuth: number } {
  const target = clamp(station, 0, 1) * info.total;
  const pts = info.points;
  let i = 1;
  while (i < info.cum.length - 1 && info.cum[i] < target) i++;
  const segLen = info.cum[i] - info.cum[i - 1] || 1;
  const t = (target - info.cum[i - 1]) / segLen;
  const a = pts[i - 1];
  const b = pts[i];
  return {
    x: lerp(a[0], b[0], t),
    y: lerp(a[1], b[1], t),
    z: lerp(a[2], b[2], t),
    s: target,
    azimuth: Math.atan2(b[1] - a[1], b[0] - a[0]),
  };
}

/** 平面点到折线最近点，返回吸附位置与归一化桩号 */
export function snapToPolyline(
  info: PolylineInfo,
  px: number,
  py: number,
): { x: number; y: number; z: number; station: number; s: number; distance: number } {
  let best = { distance: Infinity, x: 0, y: 0, z: 0, s: 0 };
  const pts = info.points;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const r = closestOnSegment(px, py, a[0], a[1], b[0], b[1]);
    if (r.d < best.distance) {
      best = {
        distance: r.d,
        x: r.x,
        y: r.y,
        z: lerp(a[2], b[2], r.t),
        s: (info.cum[i - 1] ?? 0) + r.t * ((info.cum[i] ?? 0) - (info.cum[i - 1] ?? 0)),
      };
    }
  }
  return { ...best, station: info.total === 0 ? 0 : best.s / info.total };
}

/** 射线（原点 + 单位方向）与轴对齐竖棱柱（2D 多边形拉伸 zMin..zMax）求交，返回最近正距离或 null */
export function rayPrismIntersect(
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  poly: Vec2[],
  zMin: number,
  zMax: number,
): number | null {
  let best: number | null = null;
  const consider = (t: number) => {
    if (t > 1e-6 && (best === null || t < best)) best = t;
  };
  // 顶面 / 底面
  for (const z of [zMin, zMax]) {
    if (Math.abs(dz) > 1e-12) {
      const t = (z - oz) / dz;
      if (t > 1e-6) {
        const hx = ox + dx * t;
        const hy = oy + dy * t;
        if (pointInPolygon(hx, hy, poly)) consider(t);
      }
    }
  }
  // 侧面：每条多边形边向上拉伸
  for (let i = 0; i < poly.length; i++) {
    const [ax, ay] = poly[i];
    const [bx, by] = poly[(i + 1) % poly.length];
    const ex = bx - ax;
    const ey = by - ay;
    const denom = dx * ey - dy * ex;
    if (Math.abs(denom) < 1e-12) continue;
    const rx = ax - ox;
    const ry = ay - oy;
    const t = (rx * ey - ry * ex) / denom;
    const u = (rx * dy - ry * dx) / denom;
    if (t > 1e-6 && u >= 0 && u <= 1) {
      const hz = oz + dz * t;
      if (hz >= zMin - 1e-9 && hz <= zMax + 1e-9) consider(t);
    }
  }
  return best;
}

/** 点在多边形内（含边界），支持孔洞：外环在内、洞在外才算内 */
export function pointInPolygon(x: number, y: number, rings: Vec2[]): boolean {
  return inRing(x, y, rings, false);
}

export function pointInPolygonWithHoles(x: number, y: number, outer: Vec2[], holes: Vec2[][]): boolean {
  if (!inRing(x, y, outer, false)) return false;
  return !holes.some((h) => inRing(x, y, h, false));
}

function inRing(x: number, y: number, ring: Vec2[], _boundaryAsInside: boolean): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    const intersect = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/** 多边形面积（鞋带公式，外环为正输入时取绝对值） */
export function polygonArea(ring: Vec2[]): number {
  let a = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[(i + 1) % ring.length];
    a += x1 * y2 - x2 * y1;
  }
  return Math.abs(a) / 2;
}

export function polygonCentroid(ring: Vec2[]): Vec2 {
  let a = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[(i + 1) % ring.length];
    const cross = x1 * y2 - x2 * y1;
    a += cross;
    cx += (x1 + x2) * cross;
    cy += (y1 + y2) * cross;
  }
  if (Math.abs(a) < 1e-12) {
    const sx = ring.reduce((s, p) => s + p[0], 0);
    const sy = ring.reduce((s, p) => s + p[1], 0);
    return [sx / ring.length, sy / ring.length];
  }
  return [cx / (3 * a), cy / (3 * a)];
}

/** 二维外接框（接受 [x,y,...] 元组数组） */
export function bbox(points: readonly (readonly number[])[]): {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
} {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    const x = p[0];
    const y = p[1];
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY };
}

/** 圆盘上的 Halton 抖动采样（确定性，无随机数依赖） */
export function jitteredDiskSamples(n: number, seed = 1): Vec2[] {
  const out: Vec2[] = [];
  const cols = Math.max(1, Math.round(Math.sqrt(n)));
  const rows = Math.ceil(n / cols);
  let k = 0;
  for (let r = 0; r < rows && out.length < n; r++) {
    for (let c = 0; c < cols && out.length < n; c++) {
      const h1 = halton(k + seed * 97 + 1, 2);
      const h2 = halton(k + seed * 97 + 1, 3);
      const u = (c + h1) / cols;
      const v = (r + h2) / rows;
      const radius = Math.sqrt(u) * 0.5;
      const theta = v * TAU;
      out.push([Math.cos(theta) * radius, Math.sin(theta) * radius]);
      k++;
    }
  }
  return out;
}

function halton(index: number, base: number): number {
  let f = 1;
  let r = 0;
  let i = index;
  while (i > 0) {
    f /= base;
    r += f * (i % base);
    i = Math.floor(i / base);
  }
  return r;
}

export function download(filename: string, content: string | Blob, mime = 'text/plain'): void {
  const blob = typeof content === 'string' ? new Blob([content], { type: mime }) : content;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
