import type { Boundary, ColorMode, ElevationPoint, Vec2 } from '../state/types';

export interface TerrainGrid {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  nx: number;
  ny: number;
  cell: number;
  /** 长度 ny*nx，行优先（第 j 行第 i 列 => j*nx+i），裁剪外为 NaN */
  z: Float32Array;
  mask: Uint8Array;
  zMin: number;
  zMax: number;
  slopeMaxDeg: number;
  curvatureMax: number;
  /** 栅格点世界坐标取值器 */
  pointAt(i: number, j: number): Vec2;
}

/** 点在多边形内（射线法） */
export function pointInPolygon(p: Vec2, poly: Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x;
    const yi = poly[i].y;
    const xj = poly[j].x;
    const yj = poly[j].y;
    const intersect =
      yi > p.y !== yj > p.y && p.x < ((xj - xi) * (p.y - yi)) / (yj - yi || 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/** 合并边界的包围盒 */
function bounds(points: { x: number; y: number }[], pad: number) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  return { minX: minX - pad, minY: minY - pad, maxX: maxX + pad, maxY: maxY + pad };
}

/**
 * 构建地形栅格：IDW 反距离加权插值 + 河道边界裁剪。
 * 为控制开销，每格只取最近的 k 个已知点参与插值。
 */
export function buildTerrainGrid(
  elevations: ElevationPoint[],
  boundaries: Boundary[],
  resolution: number,
  idwPower = 2
): TerrainGrid | null {
  if (elevations.length < 3) return null;
  const cell = Math.max(1, resolution);
  const domain =
    boundaries.length > 0
      ? bounds(
          boundaries.flatMap((b) => b.points),
          cell
        )
      : bounds(elevations, cell);

  const nx = Math.max(2, Math.ceil((domain.maxX - domain.minX) / cell) + 1);
  const ny = Math.max(2, Math.ceil((domain.maxY - domain.minY) / cell) + 1);
  const total = nx * ny;
  const z = new Float32Array(total).fill(NaN);
  const mask = new Uint8Array(total);
  const polys = boundaries.map((b) => b.points).filter((p) => p.length >= 3);

  let zMin = Infinity;
  let zMax = -Infinity;

  // 预排序分桶加速：直接全量 IDW 在千点*千格量级也可接受，这里用最近 8 点
  const K = Math.min(8, elevations.length);

  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const idx = j * nx + i;
      const px = domain.minX + i * cell;
      const py = domain.minY + j * cell;
      if (polys.length > 0 && !polys.some((poly) => pointInPolygon({ x: px, y: py }, poly))) {
        continue;
      }
      mask[idx] = 1;

      // 找最近 K 个点
      const nearest: { d2: number; z: number }[] = [];
      for (const e of elevations) {
        const dx = e.x - px;
        const dy = e.y - py;
        const d2 = dx * dx + dy * dy;
        if (d2 < 1e-10) {
          nearest.length = 0;
          nearest.push({ d2: 0, z: e.z });
          break;
        }
        if (nearest.length < K) {
          nearest.push({ d2, z: e.z });
          nearest.sort((a, b) => a.d2 - b.d2);
        } else if (d2 < nearest[K - 1].d2) {
          nearest[K - 1] = { d2, z: e.z };
          nearest.sort((a, b) => a.d2 - b.d2);
        }
      }

      let weightSum = 0;
      let valueSum = 0;
      for (const n of nearest) {
        const w = 1 / Math.pow(Math.sqrt(n.d2) + 1e-6, idwPower);
        weightSum += w;
        valueSum += w * n.z;
      }
      const value = valueSum / weightSum;
      z[idx] = value;
      if (value < zMin) zMin = value;
      if (value > zMax) zMax = value;
    }
  }

  if (!isFinite(zMin)) return null;

  let slopeMaxDeg = 0;
  let curvatureMax = 0;
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const idx = j * nx + i;
      if (!mask[idx]) continue;
      const g = gradientAt(z, mask, nx, ny, i, j, cell);
      if (g) {
        const deg = (Math.atan(Math.hypot(g.dzdx, g.dzdy)) * 180) / Math.PI;
        if (deg > slopeMaxDeg) slopeMaxDeg = deg;
      }
      const lap = laplacianAt(z, mask, nx, ny, i, j, cell);
      if (lap !== null) curvatureMax = Math.max(curvatureMax, Math.abs(lap));
    }
  }

  return {
    ...domain,
    nx,
    ny,
    cell,
    z,
    mask,
    zMin,
    zMax,
    slopeMaxDeg,
    curvatureMax,
    pointAt(i, j) {
      return { x: domain.minX + i * cell, y: domain.minY + j * cell };
    }
  };
}

function neighborZ(z: Float32Array, mask: Uint8Array, nx: number, ny: number, i: number, j: number) {
  if (i < 0 || j < 0 || i >= nx || j >= ny || !mask[j * nx + i]) return null;
  const v = z[j * nx + i];
  return isFinite(v) ? v : null;
}

export function gradientAt(
  z: Float32Array,
  mask: Uint8Array,
  nx: number,
  ny: number,
  i: number,
  j: number,
  cell: number
): { dzdx: number; dzdy: number } | null {
  const l = neighborZ(z, mask, nx, ny, i - 1, j);
  const r = neighborZ(z, mask, nx, ny, i + 1, j);
  const d = neighborZ(z, mask, nx, ny, i, j - 1);
  const u = neighborZ(z, mask, nx, ny, i, j + 1);
  if (l === null || r === null || d === null || u === null) return null;
  return { dzdx: (r - l) / (2 * cell), dzdy: (u - d) / (2 * cell) };
}

/** 拉普拉斯算子作为地形曲率代理（1/m） */
export function laplacianAt(
  z: Float32Array,
  mask: Uint8Array,
  nx: number,
  ny: number,
  i: number,
  j: number,
  cell: number
): number | null {
  const c = neighborZ(z, mask, nx, ny, i, j);
  const l = neighborZ(z, mask, nx, ny, i - 1, j);
  const r = neighborZ(z, mask, nx, ny, i + 1, j);
  const d = neighborZ(z, mask, nx, ny, i, j - 1);
  const u = neighborZ(z, mask, nx, ny, i, j + 1);
  if (c === null || l === null || r === null || d === null || u === null) return null;
  return (l + r + d + u - 4 * c) / (cell * cell);
}

/** 在栅格上双线性插值取高程，域外/裁剪外返回 null */
export function sampleGrid(grid: TerrainGrid, x: number, y: number): number | null {
  const fx = (x - grid.minX) / grid.cell;
  const fy = (y - grid.minY) / grid.cell;
  const i0 = Math.floor(fx);
  const j0 = Math.floor(fy);
  if (i0 < 0 || j0 < 0 || i0 >= grid.nx - 1 || j0 >= grid.ny - 1) return null;
  const tx = fx - i0;
  const ty = fy - j0;
  const idx = (j: number, i: number) => j * grid.nx + i;
  if (!grid.mask[idx(j0, i0)] || !grid.mask[idx(j0 + 1, i0)] || !grid.mask[idx(j0, i0 + 1)] || !grid.mask[idx(j0 + 1, i0 + 1)]) {
    return null;
  }
  const z00 = grid.z[idx(j0, i0)];
  const z10 = grid.z[idx(j0, i0 + 1)];
  const z01 = grid.z[idx(j0 + 1, i0)];
  const z11 = grid.z[idx(j0 + 1, i0 + 1)];
  return (
    z00 * (1 - tx) * (1 - ty) + z10 * tx * (1 - ty) + z01 * (1 - tx) * ty + z11 * tx * ty
  );
}

export function modeLabel(mode: ColorMode): string {
  return mode === 'elevation' ? '高程着色 (m)' : mode === 'slope' ? '坡度着色 (°)' : '曲率着色 (1/m)';
}
