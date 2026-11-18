import * as THREE from 'three';
import type { ColorMode } from '../state/types';
import { gradientAt, laplacianAt, type TerrainGrid } from './terrain';

/** 通用色带：蓝（低）→ 青 → 绿 → 黄 → 红（高），工程图例常用 */
const RAMP_STOPS: [number, [number, number, number]][] = [
  [0.0, [40, 80, 180]],
  [0.25, [40, 170, 200]],
  [0.5, [70, 175, 90]],
  [0.75, [230, 200, 60]],
  [1.0, [210, 60, 50]]
];

export function rampColor(t: number, out: THREE.Color): THREE.Color {
  const x = Math.max(0, Math.min(1, t));
  for (let k = 0; k < RAMP_STOPS.length - 1; k++) {
    const [t0, c0] = RAMP_STOPS[k];
    const [t1, c1] = RAMP_STOPS[k + 1];
    if (x >= t0 && x <= t1) {
      const f = (x - t0) / (t1 - t0);
      out.setRGB(
        (c0[0] + (c1[0] - c0[0]) * f) / 255,
        (c0[1] + (c1[1] - c0[1]) * f) / 255,
        (c0[2] + (c1[2] - c0[2]) * f) / 255,
        THREE.SRGBColorSpace
      );
      return out;
    }
  }
  const last = RAMP_STOPS[RAMP_STOPS.length - 1][1];
  out.setRGB(last[0] / 255, last[1] / 255, last[2] / 255, THREE.SRGBColorSpace);
  return out;
}

export function rampCss(t: number): string {
  const c = rampColor(t, new THREE.Color());
  const h = (v: number) => Math.round(v * 255).toString(16).padStart(2, '0');
  return `#${h(c.r)}${h(c.g)}${h(c.b)}`;
}

export interface BuiltMesh {
  geometry: THREE.BufferGeometry;
  /** 图例区间 */
  legend: { min: number; max: number; unit: string };
}

/**
 * 由栅格构建三角网并按三种模式逐顶点着色。
 * 裁剪外的格子不生成面片。
 */
export function buildTerrainMesh(grid: TerrainGrid, mode: ColorMode): BuiltMesh {
  const positions: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  const tmp = new THREE.Color();
  const { nx, ny, cell, z, mask } = grid;

  const zSpan = Math.max(1e-6, grid.zMax - grid.zMin);
  const slopeMax = Math.max(1e-3, grid.slopeMaxDeg);
  const curvMax = Math.max(1e-6, grid.curvatureMax);

  const indexMap = new Int32Array(nx * ny).fill(-1);

  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const id = j * nx + i;
      if (!mask[id]) continue;
      const p = grid.pointAt(i, j);
      const vertIndex = positions.length / 3;
      indexMap[id] = vertIndex;
      positions.push(p.x, p.y, z[id]);

      let tNorm = 0;
      if (mode === 'elevation') {
        tNorm = (z[id] - grid.zMin) / zSpan;
      } else if (mode === 'slope') {
        const g = gradientAt(z, mask, nx, ny, i, j, cell);
        const deg = g ? (Math.atan(Math.hypot(g.dzdx, g.dzdy)) * 180) / Math.PI : 0;
        tNorm = deg / slopeMax;
      } else {
        const lap = laplacianAt(z, mask, nx, ny, i, j, cell);
        tNorm = lap === null ? 0 : Math.abs(lap) / curvMax;
      }
      rampColor(tNorm, tmp);
      colors.push(tmp.r, tmp.g, tmp.b);
    }
  }

  for (let j = 0; j < ny - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const a = indexMap[j * nx + i];
      const b = indexMap[j * nx + i + 1];
      const c = indexMap[(j + 1) * nx + i];
      const d = indexMap[(j + 1) * nx + i + 1];
      if (a < 0 || b < 0 || c < 0 || d < 0) continue;
      indices.push(a, b, d, a, d, c);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();

  const legend =
    mode === 'elevation'
      ? { min: grid.zMin, max: grid.zMax, unit: 'm' }
      : mode === 'slope'
        ? { min: 0, max: grid.slopeMaxDeg, unit: '°' }
        : { min: 0, max: grid.curvatureMax, unit: '1/m' };

  return { geometry, legend };
}

/** 计算栅格覆盖的实际水面/地表面积（m²） */
export function gridSurfaceArea(grid: TerrainGrid): number {
  let area = 0;
  const { nx, ny, cell, z, mask } = grid;
  for (let j = 0; j < ny - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const a = j * nx + i;
      const b = j * nx + i + 1;
      const c = (j + 1) * nx + i;
      const d = (j + 1) * nx + i + 1;
      if (!mask[a] || !mask[b] || !mask[c] || !mask[d]) continue;
      area += triArea(cell, z[a], z[b], z[d]) + triArea(cell, z[a], z[d], z[c]);
    }
  }
  return area;
}

function triArea(cell: number, za: number, zb: number, zc: number): number {
  // 三点平面坐标 (0,0,za),(cell,0,zb),(0,cell,zc)
  const ux = cell;
  const uy = 0;
  const uz = zb - za;
  const vx = 0;
  const vy = cell;
  const vz = zc - za;
  const cx = uy * vz - uz * vy;
  const cy = uz * vx - ux * vz;
  const cz = ux * vy - uy * vx;
  return 0.5 * Math.hypot(cx, cy, cz);
}
