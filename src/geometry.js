/**
 * geometry.js — 瓶身半剖轮廓的纯函数几何引擎
 *
 * 坐标系: x = 半径 r (mm, >=0), y = 高度 (mm, 自下而上)
 * 半剖轮廓绕 y 轴旋转生成瓶身曲面。
 */

/** 默认 500ml 日化瓶半剖轮廓（控制点，单位 mm） */
export const DEFAULT_PROFILE = [
  { r: 0,    y: 0 },
  { r: 28,   y: 0 },
  { r: 36,   y: 8 },
  { r: 39,   y: 30 },
  { r: 39,   y: 120 },
  { r: 34,   y: 148 },
  { r: 26,   y: 162 },
  { r: 24,   y: 176 },
  { r: 24,   y: 196 },
  { r: 30,   y: 202 },
  { r: 30,   y: 212 },
  { r: 0,    y: 212 },
];

export const DEFAULT_THRESHOLD = 0.03; // 曲率阈值 1/mm

/* ---------- 向心 Catmull-Rom 样条 ---------- */

function centripetalT(t0, p0, p1, alpha = 0.5) {
  const dx = p1.r - p0.r, dy = p1.y - p0.y;
  const d = Math.hypot(dx, dy);
  return t0 + Math.pow(d, alpha);
}

function crPoint(p0, p1, p2, p3, t1, t2, t3, t) {
  if (t2 - t1 < 1e-9) return { ...p1 };
  const t0 = t1 - Math.max(1e-9, t2 - t1); // 端段镜像外推
  const t4 = t2 + Math.max(1e-9, t2 - t1);
  // 钳制相邻节点，保证所有分母严格为正
  const tt0 = Math.min(t0, t1 - 1e-9);
  const tt3 = Math.max(t3, t2 + 1e-9);
  const A1r = (t1 - t) / (t1 - tt0) * p0.r + (t - tt0) / (t1 - tt0) * p1.r;
  const A1y = (t1 - t) / (t1 - tt0) * p0.y + (t - tt0) / (t1 - tt0) * p1.y;
  const A2r = (t2 - t) / (t2 - t1) * p1.r + (t - t1) / (t2 - t1) * p2.r;
  const A2y = (t2 - t) / (t2 - t1) * p1.y + (t - t1) / (t2 - t1) * p2.y;
  const A3r = (tt3 - t) / (tt3 - t2) * p2.r + (t - t2) / (tt3 - t2) * p3.r;
  const A3y = (tt3 - t) / (tt3 - t2) * p2.y + (t - t2) / (tt3 - t2) * p3.y;
  const B1r = (t2 - t) / (t2 - tt0) * A1r + (t - tt0) / (t2 - tt0) * A2r;
  const B1y = (t2 - t) / (t2 - tt0) * A1y + (t - tt0) / (t2 - tt0) * A2y;
  const B2r = (tt3 - t) / (tt3 - t1) * A2r + (t - t1) / (tt3 - t1) * A3r;
  const B2y = (tt3 - t) / (tt3 - t1) * A2y + (t - t1) / (tt3 - t1) * A3y;
  return {
    r: (t2 - t) / (t2 - t1) * B1r + (t - t1) / (t2 - t1) * B2r,
    y: (t2 - t) / (t2 - t1) * B1y + (t - t1) / (t2 - t1) * B2y,
  };
}

/**
 * 对控制点序列做向心 Catmull-Rom 稠密采样
 * @returns {Array<{r:number,y:number,u:number,knotIndex:number}>} 从瓶底到瓶口
 */
export function sampleProfile(controlPoints, stepsPerSegment = 18) {
  const pts = controlPoints;
  const n = pts.length;
  if (n < 2) return pts.map((p, i) => ({ ...p, u: i, knotIndex: i }));

  // 计算向心节点序列（重合点加 epsilon 防止零除）
  const tk = new Array(n);
  tk[0] = 0;
  for (let i = 1; i < n; i++) tk[i] = centripetalT(tk[i - 1], pts[i - 1], pts[i]);
  for (let i = 1; i < n; i++) if (tk[i] <= tk[i - 1]) tk[i] = tk[i - 1] + 1e-6;

  const out = [{ ...pts[0], u: 0, knotIndex: 0 }];
  for (let i = 0; i < n - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(n - 1, i + 2)];
    const t1 = tk[i], t2 = tk[i + 1];
    const t0 = tk[Math.max(0, i - 1)];
    const t3 = tk[Math.min(n - 1, i + 2)];
    for (let s = 1; s <= stepsPerSegment; s++) {
      if (i === n - 2 && s === stepsPerSegment) break; // 末点统一追加
      const t = t1 + (t2 - t1) * (s / stepsPerSegment);
      const q = crPoint(p0, p1, p2, p3, t1, t2, t3, t);
      out.push({ r: Math.max(0, q.r), y: Math.max(0, q.y), u: t, knotIndex: i + 1 });
    }
  }
  // 末点强制等于原始控制点，消除样条末端外推残差
  out.push({ ...pts[n - 1], u: tk[n - 1], knotIndex: n - 1 });
  // Catmull-Rom 非单调保持：将采样点钳制在其所属节点段两端控制点的
  // (r,y) 包围盒内，消除过冲/回退（保证旋转体积分正确、直壁段不鼓肚），
  // 同时严格保留各控制点本身的坐标
  for (const p of out) {
    const ki = p.knotIndex;
    const pa = pts[Math.max(0, ki - 1)];
    const pb = pts[Math.min(n - 1, ki)];
    p.y = Math.min(Math.max(p.y, Math.min(pa.y, pb.y)), Math.max(pa.y, pb.y));
    p.r = Math.min(Math.max(p.r, Math.min(pa.r, pb.r)), Math.max(pa.r, pb.r));
  }
  return out;
}

/* ---------- 曲率 / 切向角（参数无关形式 κ=|r'y''−y'r''|/(r'²+y'²)^(3/2)） ---------- */

function curvatureAt(samples, i) {
  const last = samples.length - 1;
  const a = samples[Math.max(0, i - 1)];
  const b = samples[i];
  const c = samples[Math.min(last, i + 1)];
  const r1 = b.r - a.r, y1 = b.y - a.y;
  const r2 = c.r - b.r, y2 = c.y - b.y;
  const denom = (r1 * r1 + y1 * y1) * (r2 * r2 + y2 * y2);
  if (denom < 1e-12) return 0;
  return Math.abs(r1 * y2 - y1 * r2) / Math.pow(denom, 0.75);
}

/** 切向角：轮廓切向量与 +y（瓶身轴向）夹角，单位度，范围 [0,180] */
function tangentAngleAt(samples, i) {
  const last = samples.length - 1;
  const a = samples[Math.max(0, i - 1)];
  const c = samples[Math.min(last, i + 1)];
  const dr = c.r - a.r, dy = c.y - a.y;
  const len = Math.hypot(dr, dy);
  if (len < 1e-9) return 0;
  const cosA = dy / len;
  return Math.acos(Math.min(1, Math.max(-1, cosA))) * 180 / Math.PI;
}

/**
 * 计算每个控制点处的曲率与切向角（取最近采样点）
 * @returns {Array<{index:number, curvature:number, angle:number, overThreshold:boolean}>}
 */
export function profileMetrics(controlPoints, threshold) {
  const samples = sampleProfile(controlPoints);
  return controlPoints.map((cp, index) => {
    let best = 0, bestD = Infinity;
    for (let i = 0; i < samples.length; i++) {
      const d = Math.abs(samples[i].u - (samples.find(s => s.knotIndex === index)?.u ?? 0));
      if (d < bestD) { bestD = d; best = i; }
    }
    const curvature = curvatureAt(samples, best);
    const angle = tangentAngleAt(samples, best);
    return { index, curvature, angle, overThreshold: curvature > threshold };
  });
}

/** 全轮廓最大曲率及其所在控制点 */
export function maxCurvature(controlPoints, threshold) {
  const m = profileMetrics(controlPoints, threshold);
  return m.reduce((a, b) => (b.curvature > a.curvature ? b : a), m[0] ?? { curvature: 0 });
}

/* ---------- 弧长 ---------- */
export function arcLength(samples) {
  let L = 0;
  for (let i = 1; i < samples.length; i++) {
    L += Math.hypot(samples[i].r - samples[i - 1].r, samples[i].y - samples[i - 1].y);
  }
  return L;
}

/* ---------- 旋转体体积（圆盘/壳法，梯形积分） ---------- */

/** 体积，单位 ml（1 ml = 1000 mm³）；假设轮廓两端落在轴上构成封闭回转体 */
export function revolveVolume(controlPoints) {
  const s = sampleProfile(controlPoints, 24);
  let v = 0;
  for (let i = 1; i < s.length; i++) {
    const dy = s[i].y - s[i - 1].y;
    if (Math.abs(dy) < 1e-12) continue;
    v += (s[i].r * s[i].r + s[i - 1].r * s[i - 1].r) * dy;
  }
  return Math.abs(v) * Math.PI / 2 / 1000;
}

/** 按目标容量整体缩放半径（V ∝ k²），返回新控制点数组 */
export function scaleToCapacity(controlPoints, targetMl) {
  const current = revolveVolume(controlPoints);
  if (current <= 0 || targetMl <= 0) return controlPoints.map(p => ({ ...p }));
  const k = Math.sqrt(targetMl / current);
  return controlPoints.map(p => ({ r: p.r * k, y: p.y }));
}

/* ---------- 半径查表（供展开使用） ---------- */

/** 在指定高度 y 处线性插值轮廓半径；超出范围返回端点半径 */
export function radiusAtY(controlPoints, y) {
  const s = sampleProfile(controlPoints, 24);
  if (y <= s[0].y) return s[0].r;
  const last = s[s.length - 1];
  if (y >= last.y) return last.r;
  for (let i = 1; i < s.length; i++) {
    if (y <= s[i].y) {
      const a = s[i - 1], b = s[i];
      const t = (y - a.y) / Math.max(1e-9, b.y - a.y);
      return a.r + (b.r - a.r) * t;
    }
  }
  return last.r;
}

/* ---------- 伸长率统计（柱面展开） ---------- */

/**
 * @param refMode 'auto' 时取标签高度内的平均半径，否则使用 fixedMl/fixedR
 */
export function elongationStats(controlPoints, yMin, yMax, refMode, refRadius) {
  const N = 120;
  const rows = [];
  let sum = 0;
  for (let i = 0; i <= N; i++) {
    const y = yMin + (yMax - yMin) * (i / N);
    rows.push({ y, r: radiusAtY(controlPoints, y) });
    sum += rows[i].r;
  }
  const avgR = sum / (N + 1);
  const rRef = refMode === 'fixed' ? Math.max(1, refRadius) : avgR;
  let minE = Infinity, maxE = -Infinity;
  for (const row of rows) {
    row.e = (row.r - rRef) / rRef; // 伸长率（负值=收缩）
    minE = Math.min(minE, row.e);
    maxE = Math.max(maxE, row.e);
  }
  return { rows, rRef, avgR, minE, maxE, meanE: (avgR - rRef) / rRef };
}

/* ---------- 标签边界（等距偏移） ---------- */

/**
 * 等距偏移生成标签安全区与出血边界。
 * 物理意义：沿轮廓法向偏移 safeMm / bleedMm 后，在展开稿上以 r_ref 折算回水平方向。
 */
export function labelZones(controlPoints, cfg) {
  const { yMin, yMax, safeMm, bleedMm, refMode, refRadius } = cfg;
  const stats = elongationStats(controlPoints, yMin, yMax, refMode, refRadius);
  const rRef = stats.rRef;
  const trimWidth = 2 * Math.PI * rRef;
  const safeWidth = 2 * Math.PI * Math.max(1, rRef - safeMm);
  const bleedWidth = 2 * Math.PI * (rRef + bleedMm);
  return {
    trim: { x: 0, y: yMin, w: trimWidth, h: yMax - yMin },
    safe: { x: safeMm * 2 * Math.PI, y: yMin + safeMm, w: safeWidth, h: yMax - yMin - safeMm * 2 },
    bleed: { x: -bleedMm * 2 * Math.PI, y: yMin - bleedMm, w: bleedWidth, h: yMax - yMin + bleedMm * 2 },
    stats,
  };
}
