import type { CornerMode, Vec2 } from '../state/types';

/**
 * 开放折线的等距偏移（岸线 → 管理范围平行线）。
 * side: 1 取左法线，-1 取右法线。
 * 角部支持：miter 尖角（带斜接限制回退为斜切）、round 圆弧。
 */
export function offsetPolyline(
  points: Vec2[],
  distance: number,
  side: 1 | -1,
  mode: CornerMode,
  roundSegments = 12,
  miterLimit = 2.5
): Vec2[] {
  if (points.length < 2 || distance === 0) return points.map((p) => ({ ...p }));
  const d = Math.abs(distance);
  const n = points.length;
  const normals: Vec2[] = [];
  for (let i = 0; i < n - 1; i++) {
    const dx = points[i + 1].x - points[i].x;
    const dy = points[i + 1].y - points[i].y;
    const len = Math.hypot(dx, dy) || 1;
    normals.push({ x: (-dy / len) * side, y: (dx / len) * side });
  }

  const out: Vec2[] = [];
  // 起点
  out.push({ x: points[0].x + normals[0].x * d, y: points[0].y + normals[0].y * d });

  for (let i = 1; i < n - 1; i++) {
    const n1 = normals[i - 1];
    const n2 = normals[i];
    // 切向量夹角
    const t1x = -n1.y * side;
    const t1y = n1.x * side;
    const t2x = -n2.y * side;
    const t2y = n2.x * side;
    const dot = Math.max(-1, Math.min(1, t1x * t2x + t1y * t2y));
    const cross = t1x * t2y - t1y * t2x;
    // 凸折角（朝偏移方向凸出）才需要角部处理
    const convex = cross * side < 0;

    if (!convex) {
      // 凹角：法线交点（miter 形式即可，不会产生长尖）
      const m = intersectOffset(points[i], n1, n2, d);
      out.push(m);
      continue;
    }

    if (mode === 'round') {
      const a1 = Math.atan2(n1.y, n1.x);
      const a2 = Math.atan2(n2.y, n2.x);
      let delta = a2 - a1;
      while (delta > Math.PI) delta -= 2 * Math.PI;
      while (delta < -Math.PI) delta += 2 * Math.PI;
      for (let k = 1; k <= roundSegments; k++) {
        const a = a1 + (delta * k) / roundSegments;
        out.push({ x: points[i].x + Math.cos(a) * d, y: points[i].y + Math.sin(a) * d });
      }
    } else {
      // 尖角：miter，超限时回退 bevel
      const halfAngle = Math.acos(dot) / 2;
      const miterLen = d / Math.max(1e-6, Math.sin(halfAngle));
      if (miterLen / d <= miterLimit) {
        const mx = (n1.x + n2.x) / 2;
        const my = (n1.y + n2.y) / 2;
        const ml = Math.hypot(mx, my) || 1;
        out.push({ x: points[i].x + (mx / ml) * miterLen, y: points[i].y + (my / ml) * miterLen });
      } else {
        out.push({ x: points[i].x + n1.x * d, y: points[i].y + n1.y * d });
        out.push({ x: points[i].x + n2.x * d, y: points[i].y + n2.y * d });
      }
    }
  }

  // 终点
  out.push({
    x: points[n - 1].x + normals[n - 2].x * d,
    y: points[n - 1].y + normals[n - 2].y * d
  });
  return out;
}

function intersectOffset(p: Vec2, n1: Vec2, n2: Vec2, d: number): Vec2 {
  // 沿两条偏移直线求交：p + n1*d + t*(-n1.y,n1.x) 与 p + n2*d + u*(-n2.y,n2.x)
  const a = { x: p.x + n1.x * d, y: p.y + n1.y * d };
  const b = { x: p.x + n2.x * d, y: p.y + n2.y * d };
  const r = { x: -n1.y, y: n1.x };
  const s = { x: -n2.y, y: n2.x };
  const denom = r.x * s.y - r.y * s.x;
  if (Math.abs(denom) < 1e-9) return { ...a };
  const t = ((b.x - a.x) * s.y - (b.y - a.y) * s.x) / denom;
  return { x: a.x + r.x * t, y: a.y + r.y * t };
}

/** 判断点在折线的哪一侧（按有向面积符号，>0 为左） */
export function sideOfLine(points: Vec2[], p: Vec2): number {
  // 取最近线段判断
  let best = Infinity;
  let sign = 1;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    const cross = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const l2 = dx * dx + dy * dy || 1;
    let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2;
    t = Math.max(0, Math.min(1, t));
    const qx = a.x + t * dx;
    const qy = a.y + t * dy;
    const dd = Math.hypot(p.x - qx, p.y - qy);
    if (dd < best) {
      best = dd;
      sign = cross >= 0 ? 1 : -1;
    }
  }
  return sign;
}
