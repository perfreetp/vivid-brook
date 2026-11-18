import type { UnfoldResult, Vec2 } from '../state/types';
import { sampleGrid, type TerrainGrid } from './terrain';
import { sampleAtStation, type SplineSample } from './spline';

export interface StripSample {
  station: number;
  crest: { x: number; y: number; z: number };
  toe: { x: number; y: number; z: number };
}

/**
 * 在指定里程区间内，从堤顶线向河道外侧按法线构建堤坡条带，
 * 坡脚位置由地形栅格上沿法线方向的最大坡度变化点探测；
 * 探测失败时退化为固定宽度。
 */
export function buildEmbankmentStrip(
  crestSamples: SplineSample[],
  sideSign: number,
  stationStart: number,
  stationEnd: number,
  grid: TerrainGrid | null,
  stripCount = 40,
  fallbackWidth = 40
): StripSample[] {
  const out: StripSample[] = [];
  const s0 = Math.max(0, stationStart);
  const s1 = Math.min(stationEnd, crestSamples.length ? crestSamples[crestSamples.length - 1].s : 0);
  if (s1 <= s0) return out;

  for (let k = 0; k <= stripCount; k++) {
    const station = s0 + ((s1 - s0) * k) / stripCount;
    const smp = sampleAtStation(crestSamples, station);
    const nx = -smp.tangent.y * sideSign;
    const ny = smp.tangent.x * sideSign;
    const crestZ = grid ? sampleGrid(grid, smp.p.x, smp.p.y) ?? 0 : 0;

    let width = fallbackWidth;
    if (grid) {
      // 沿法线逐步探测，寻找高程转平（坡度显著减小）的坡脚
      const step = Math.max(2, grid.cell);
      let prevZ = crestZ;
      let maxDropSlope = 0;
      let found = -1;
      for (let d = step; d <= fallbackWidth * 2; d += step) {
        const px = smp.p.x + nx * d;
        const py = smp.p.y + ny * d;
        const z = sampleGrid(grid, px, py);
        if (z === null) break;
        const localSlope = Math.abs(z - prevZ) / step;
        if (localSlope > maxDropSlope) maxDropSlope = localSlope;
        // 进入明显缓坡区且已离开坡肩
        if (d > step * 2 && maxDropSlope > 0.05 && localSlope < maxDropSlope * 0.25) {
          found = d;
          break;
        }
        prevZ = z;
      }
      if (found > 0) width = found;
    }

    const toeX = smp.p.x + nx * width;
    const toeY = smp.p.y + ny * width;
    const toeZ = grid ? sampleGrid(grid, toeX, toeY) ?? crestZ : crestZ;
    out.push({
      station,
      crest: { x: smp.p.x, y: smp.p.y, z: crestZ },
      toe: { x: toeX, y: toeY, z: toeZ }
    });
  }
  return out;
}

interface V3 {
  x: number;
  y: number;
  z: number;
}

function dist3(a: V3, b: V3): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

/** 两圆交点，取与参考点同侧/异侧由 preferSide 控制 */
function circleIntersect(p1: Vec2, r1: number, p2: Vec2, r2: number, hint: Vec2): Vec2 {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const d = Math.hypot(dx, dy) || 1e-6;
  const a = (r1 * r1 - r2 * r2 + d * d) / (2 * d);
  const h2 = Math.max(0, r1 * r1 - a * a);
  const h = Math.sqrt(h2);
  const mx = p1.x + (a * dx) / d;
  const my = p1.y + (a * dy) / d;
  const px = (-dy / d) * h;
  const py = (dx / d) * h;
  const c1 = { x: mx + px, y: my + py };
  const c2 = { x: mx - px, y: my - py };
  return Math.hypot(c1.x - hint.x, c1.y - hint.y) <= Math.hypot(c2.x - hint.x, c2.y - hint.y) ? c1 : c2;
}

/**
 * 测地线（保距）展开：
 * 以堤顶线为展开平面的 u 轴基准，逐条共享边把三维三角条带铺到二维，
 * 所有边长取三维实长，因此展开面积等于坡面实际面积。
 */
export function flattenStrip(strip: StripSample[]): {
  outline: Vec2[];
  area: number;
  slopeLength: number;
  crestLength: number;
  toeLength: number;
  /** 每个断面的展开坐标（堤顶点、坡脚点），供等值线使用 */
  rows: { crest2: Vec2; toe2: Vec2; crest3: V3; toe3: V3; station: number }[];
} {
  const n = strip.length;
  const rows: { crest2: Vec2; toe2: Vec2; crest3: V3; toe3: V3; station: number }[] = [];

  // 第一排：堤顶放原点，坡脚沿 +y
  const r0 = strip[0];
  const w0 = dist3(r0.crest, r0.toe);
  rows.push({
    crest2: { x: 0, y: 0 },
    toe2: { x: 0, y: w0 },
    crest3: r0.crest,
    toe3: r0.toe,
    station: r0.station
  });

  for (let k = 1; k < n; k++) {
    const prev = rows[k - 1];
    const cur = strip[k];
    // 堤顶：沿前一堤顶边方向推进实长
    const crestLen = dist3(prev.crest3, cur.crest);
    // 堤顶方向：首排用 x 轴，之后沿相邻堤顶连线
    const dirX = k === 1 ? 1 : (() => {
      const dxx = prev.crest2.x - rows[k - 2].crest2.x;
      const dyy = prev.crest2.y - rows[k - 2].crest2.y;
      const l = Math.hypot(dxx, dyy) || 1;
      return dxx / l;
    })();
    const dirY = k === 1 ? 0 : (() => {
      const dxx = prev.crest2.x - rows[k - 2].crest2.x;
      const dyy = prev.crest2.y - rows[k - 2].crest2.y;
      const l = Math.hypot(dxx, dyy) || 1;
      return dyy / l;
    })();
    const crest2 = {
      x: prev.crest2.x + dirX * crestLen,
      y: prev.crest2.y + dirY * crestLen
    };

    // 坡脚：两圆交汇——圆心为新堤顶点(半径=坡宽)与前坡脚点(半径=坡脚间距实长)
    const width = dist3(cur.crest, cur.toe);
    const toeGap = dist3(prev.toe3, cur.toe);
    const toe2 = circleIntersect(crest2, width, prev.toe2, toeGap, prev.crest2);

    rows.push({ crest2, toe2, crest3: cur.crest, toe3: cur.toe, station: cur.station });
  }

  // 面积：四边形拆两个三角形（二维展开面积即坡面实测面积）
  let area = 0;
  for (let k = 1; k < n; k++) {
    const a = rows[k - 1].crest2;
    const b = rows[k].crest2;
    const c = rows[k].toe2;
    const d = rows[k - 1].toe2;
    area += triArea2(a, b, c) + triArea2(a, c, d);
  }

  let crestLength = 0;
  let toeLength = 0;
  let slopeSum = 0;
  for (let k = 1; k < n; k++) {
    crestLength += dist3(rows[k - 1].crest3, rows[k].crest3);
    toeLength += dist3(rows[k - 1].toe3, rows[k].toe3);
  }
  for (const r of rows) slopeSum += Math.hypot(r.crest2.x - r.toe2.x, r.crest2.y - r.toe2.y);

  // 外轮廓：堤顶正向 + 坡脚反向闭合
  const outline = [
    ...rows.map((r) => ({ ...r.crest2 })),
    ...rows.slice().reverse().map((r) => ({ ...r.toe2 }))
  ];

  return {
    outline,
    area,
    slopeLength: slopeSum / n,
    crestLength,
    toeLength,
    rows
  };
}

function triArea2(a: Vec2, b: Vec2, c: Vec2): number {
  return 0.5 * Math.abs((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x));
}

/** 在展开条带内插等高程等值线（简化版：逐排线性插值后连接同值点） */
export function unfoldedContours(
  rows: { crest2: Vec2; toe2: Vec2; crest3: V3; toe3: V3 }[],
  levelCount = 6
): UnfoldResult['contours'] {
  const zMin = Math.min(...rows.map((r) => Math.min(r.crest3.z, r.toe3.z)));
  const zMax = Math.max(...rows.map((r) => Math.max(r.crest3.z, r.toe3.z)));
  const contours: UnfoldResult['contours'] = [];
  if (zMax - zMin < 1e-6) return contours;

  for (let k = 1; k <= levelCount; k++) {
    const level = zMin + ((zMax - zMin) * k) / (levelCount + 1);
    const path: Vec2[] = [];
    for (const r of rows) {
      const za = r.crest3.z;
      const zb = r.toe3.z;
      if ((level - za) * (level - zb) > 0) continue;
      const t = (level - za) / (zb - za || 1e-9);
      if (t < -1e-6 || t > 1 + 1e-6) continue;
      path.push({
        x: r.crest2.x + (r.toe2.x - r.crest2.x) * t,
        y: r.crest2.y + (r.toe2.y - r.crest2.y) * t
      });
    }
    if (path.length >= 2) contours.push({ level, paths: [path] });
  }
  return contours;
}
