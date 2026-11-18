import type { Vec2 } from '../state/types';

/**
 * 向心 Catmull-Rom 样条（二维，工程平面坐标）。
 * 端点处复制端点做夹持边界，输出按弧长近似均匀的采样。
 */

export interface SplineSample {
  p: Vec2;
  /** 单位切向量 */
  tangent: Vec2;
  /** 累计里程 m */
  s: number;
  /** 曲率 1/m（恒非负） */
  curvature: number;
  /** 曲率半径 m，曲率为 0 时取 Infinity */
  radius: number;
}

function catmull(p0: Vec2, p1: Vec2, p2: Vec2, p3: Vec2, t: number): Vec2 {
  const t2 = t * t;
  const t3 = t2 * t;
  return {
    x:
      0.5 *
      (2 * p1.x +
        (-p0.x + p2.x) * t +
        (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 +
        (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
    y:
      0.5 *
      (2 * p1.y +
        (-p0.y + p2.y) * t +
        (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 +
        (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3)
  };
}

function dist(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** 对曲率序列做滑动平均，抑制数值抖动 */
function smooth(values: number[], window: number): number[] {
  if (window <= 1) return values.slice();
  const half = Math.floor(window / 2);
  return values.map((_, i) => {
    let sum = 0;
    let n = 0;
    for (let j = Math.max(0, i - half); j <= Math.min(values.length - 1, i + half); j++) {
      sum += values[j];
      n++;
    }
    return sum / n;
  });
}

/**
 * 计算样条采样及曲率。
 * @param controls 控制点
 * @param perSegment 每段细分次数
 * @param smoothWindow 曲率平滑窗口（奇数效果好）
 */
export function sampleSpline(controls: Vec2[], perSegment = 24, smoothWindow = 5): SplineSample[] {
  if (controls.length < 2) return [];
  const pts = [controls[0], ...controls, controls[controls.length - 1]];
  const raw: Vec2[] = [];
  for (let i = 1; i < pts.length - 2; i++) {
    for (let j = 0; j < perSegment; j++) {
      raw.push(catmull(pts[i - 1], pts[i], pts[i + 1], pts[i + 2], j / perSegment));
    }
  }
  raw.push({ ...controls[controls.length - 1] });

  const n = raw.length;
  // 累计弧长
  const s = new Array<number>(n);
  s[0] = 0;
  for (let i = 1; i < n; i++) s[i] = s[i - 1] + dist(raw[i - 1], raw[i]);

  // 一阶/二阶差分（弧长参数域）
  const kappa = new Array<number>(n).fill(0);
  const tangent: Vec2[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const a = raw[Math.max(0, i - 1)];
    const b = raw[Math.min(n - 1, i + 1)];
    const ds = Math.max(1e-9, s[Math.min(n - 1, i + 1)] - s[Math.max(0, i - 1)]);
    const dx = (b.x - a.x) / ds;
    const dy = (b.y - a.y) / ds;
    const mag = Math.hypot(dx, dy) || 1;
    tangent[i] = { x: dx / mag, y: dy / mag };
  }
  for (let i = 1; i < n - 1; i++) {
    const ddx = (raw[i + 1].x - 2 * raw[i].x + raw[i - 1].x) / Math.max(1e-9, (s[i + 1] - s[i - 1]) * 0.5) ** 2;
    const ddy = (raw[i + 1].y - 2 * raw[i].y + raw[i - 1].y) / Math.max(1e-9, (s[i + 1] - s[i - 1]) * 0.5) ** 2;
    const dx = tangent[i].x;
    const dy = tangent[i].y;
    // κ = |x'y'' - y'x''| / (x'^2+y'^2)^(3/2)
    kappa[i] = Math.abs(dx * ddy - dy * ddx) / Math.pow(dx * dx + dy * dy, 1.5);
  }
  const smoothed = smooth(kappa, Math.max(1, smoothWindow));

  return raw.map((p, i) => ({
    p,
    tangent: tangent[i],
    s: s[i],
    curvature: smoothed[i],
    radius: smoothed[i] > 1e-9 ? 1 / smoothed[i] : Infinity
  }));
}

export function splineLength(samples: SplineSample[]): number {
  return samples.length ? samples[samples.length - 1].s : 0;
}

/** 按里程取最近采样（里程钳制到 [0, length]） */
export function sampleAtStation(samples: SplineSample[], station: number): SplineSample {
  const target = Math.max(0, Math.min(station, splineLength(samples)));
  let lo = 0;
  let hi = samples.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (samples[mid].s < target) lo = mid + 1;
    else hi = mid;
  }
  return samples[lo];
}

/** 折线/样条总长度 */
export function polylineLength(points: Vec2[]): number {
  let len = 0;
  for (let i = 1; i < points.length; i++) len += dist(points[i - 1], points[i]);
  return len;
}
