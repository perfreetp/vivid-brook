import type {
  DimZone,
  GridCell,
  Lamp,
  ProfileSample,
  ProjectData,
  ScheduleKey,
  Vec2,
} from '../types';
import { lineCoords, polygonRings } from '../types';
import { contours } from 'd3-contour';
import {
  bbox,
  clamp,
  pointInPolygonWithHoles,
  polylineInfo,
  sampleAtStation,
  snapToPolyline,
} from './geometry';
import {
  buildScene,
  directIlluminance,
  maxThrowRadius,
  poleHeight,
  registerModelSizes,
  sourcePosition,
} from './photometry';

export const GRID_SPACING = 1; // 1m 网格
export const TRAIL_HALF_WIDTH = 1.5; // 步道有效宽度半宽 m
export const DIM_THRESHOLD = 5; // lx

export interface Grid {
  minX: number;
  minY: number;
  nx: number;
  ny: number;
  z: Float64Array;
  onTrail: Uint8Array;
  values: Float64Array; // 照度 lx
  cells: GridCell[];
}

const GRID_MARGIN = 6;

function allPolygons(project: ProjectData): Vec2[][] {
  const out: Vec2[][] = [];
  for (const f of [
    ...project.steps,
    ...project.walls,
    ...project.canopies,
    ...project.buildings,
  ]) {
    for (const ring of polygonRings(f.geometry)) {
      out.push(ring.map((p) => [p[0], p[1]] as Vec2));
    }
  }
  return out;
}

/** 建立 1m 网格，地面高程取中线最近点高程，标记步道范围 */
export function buildGrid(project: ProjectData): Grid {
  const line = lineCoords(project.centerline.geometry);
  const polyPts = allPolygons(project).flat();
  const boxes = [bbox(line.map((p) => [p[0], p[1]])), bbox(polyPts)];
  const minX = Math.floor(Math.min(...boxes.map((b) => b.minX)) - GRID_MARGIN);
  const maxX = Math.ceil(Math.max(...boxes.map((b) => b.maxX)) + GRID_MARGIN);
  const minY = Math.floor(Math.min(...boxes.map((b) => b.minY)) - GRID_MARGIN);
  const maxY = Math.ceil(Math.max(...boxes.map((b) => b.maxY)) + GRID_MARGIN);
  const nx = maxX - minX + 1;
  const ny = maxY - minY + 1;
  const info = polylineInfo(line);
  const z = new Float64Array(nx * ny);
  const onTrail = new Uint8Array(nx * ny);

  for (let iy = 0; iy < ny; iy++) {
    for (let ix = 0; ix < nx; ix++) {
      const x = minX + ix + 0.5;
      const y = minY + iy + 0.5;
      const snap = snapToPolyline(info, x, y);
      const idx = iy * nx + ix;
      z[idx] = snap.z;
      onTrail[idx] = snap.distance <= TRAIL_HALF_WIDTH ? 1 : 0;
    }
  }
  const values = new Float64Array(nx * ny);
  const cells: GridCell[] = new Array(nx * ny);
  for (let i = 0; i < nx * ny; i++) {
    const ix = i % nx;
    const iy = (i / nx) | 0;
    cells[i] = {
      ix,
      iy,
      x: minX + ix + 0.5,
      y: minY + iy + 0.5,
      z: z[i],
      illuminance: 0,
      onTrail: onTrail[i] === 1,
    };
  }
  return { minX, minY, nx, ny, z, onTrail, values, cells };
}

function scheduleOn(lamp: Lamp, key: ScheduleKey): { on: boolean; dim: number } {
  if (!lamp.schedule[key]) return { on: false, dim: 1 };
  if (key === 'lateNight') return { on: true, dim: 0.5 }; // 深夜策略：点亮的灯半功率运行
  return { on: true, dim: 1 };
}

export interface LightingResult {
  grid: Grid;
  contours: { threshold: number; rings: Vec2[][][] }[]; // 每档等值面（外环+洞）
  dimZones: DimZone[];
  stats: {
    trailCells: number;
    dimCells: number;
    meanTrailLux: number;
    minTrailLux: number;
    maxLux: number;
    uniformity: number; // 平均/最小（越大越差，Inf 时为 null）
    activeLamps: number;
    totalPower: number;
  };
}

const HEAT_LEVELS = [0.5, 2, 5, 10, 20, 40, 80];

export function computeLighting(project: ProjectData, key: ScheduleKey): LightingResult {
  registerModelSizes(project.lampModels);
  const grid = buildGrid(project);
  const scene = buildScene(project);
  const modelMap = new Map(project.lampModels.map((m) => [m.id, m]));
  let activeLamps = 0;
  let totalPower = 0;

  for (const lamp of project.lamps) {
    const model = modelMap.get(lamp.modelId);
    if (!model) continue;
    const sched = scheduleOn(lamp, key);
    if (!sched.on) continue;
    activeLamps++;
    totalPower += lamp.power * sched.dim;
    const dimmed: Lamp = sched.dim === 1 ? lamp : { ...lamp, power: lamp.power * sched.dim };
    const src = sourcePosition(lamp, project);
    const radius = maxThrowRadius(lamp, src.z, lamp.groundZ, model);
    const r2 = radius * radius;
    const ix0 = clamp(Math.floor(src.x - radius - grid.minX), 0, grid.nx - 1);
    const ix1 = clamp(Math.ceil(src.x + radius - grid.minX), 0, grid.nx - 1);
    const iy0 = clamp(Math.floor(src.y - radius - grid.minY), 0, grid.ny - 1);
    const iy1 = clamp(Math.ceil(src.y + radius - grid.minY), 0, grid.ny - 1);

    for (let iy = iy0; iy <= iy1; iy++) {
      for (let ix = ix0; ix <= ix1; ix++) {
        const idx = iy * grid.nx + ix;
        const dx = grid.cells[idx].x - src.x;
        const dy = grid.cells[idx].y - src.y;
        if (dx * dx + dy * dy > r2) continue;
        // 只统计步道面上的照度，野外不评价
        if (!grid.onTrail[idx]) continue;
        const e = directIlluminance(dimmed, model, scene, grid.cells[idx], src);
        grid.values[idx] += e;
      }
    }
  }

  for (let i = 0; i < grid.cells.length; i++) {
    grid.cells[i].illuminance = grid.values[i];
  }

  // d3-contour：输入矩阵，坐标变换到世界米制
  const valuesArray = Array.from(grid.values);
  const contourGen = contours()
    .size([grid.nx, grid.ny])
    .thresholds(HEAT_LEVELS);
  const contourOut = contourGen(valuesArray).map((c) => ({
    threshold: c.value,
    rings: c.coordinates.map((poly) =>
      poly.map((ring) =>
        ring.map((p) => [p[0] + grid.minX, p[1] + grid.minY] as Vec2),
      ),
    ),
  }));

  // 5lx 等值面：低于阈值的真实几何轮廓（marching squares），与栅格连通区配对
  const dimContour = contours()
    .size([grid.nx, grid.ny])
    .thresholds([DIM_THRESHOLD])(valuesArray)
    .filter((c) => c.value === DIM_THRESHOLD);
  const dimRings: Vec2[][][] = dimContour.flatMap((c) =>
    c.coordinates.map((poly) =>
      poly.map((ring) => ring.map((p) => [p[0] + grid.minX, p[1] + grid.minY] as Vec2)),
    ),
  );

  const dimZones = findDimZones(grid, dimRings);
  const trailIdx: number[] = [];
  let sum = 0;
  let min = Infinity;
  let max = 0;
  for (let i = 0; i < grid.cells.length; i++) {
    if (grid.onTrail[i]) {
      trailIdx.push(i);
      const v = grid.values[i];
      sum += v;
      if (v < min) min = v;
      if (v > max) max = v;
    }
  }
  const mean = trailIdx.length ? sum / trailIdx.length : 0;

  return {
    grid,
    contours: contourOut,
    dimZones,
    stats: {
      trailCells: trailIdx.length,
      dimCells: dimZones.reduce((s, z) => s + z.areaM2, 0),
      meanTrailLux: mean,
      minTrailLux: trailIdx.length ? min : 0,
      maxLux: max,
      uniformity: min > 0.01 ? mean / min : Infinity,
      activeLamps,
      totalPower,
    },
  };
}

/** 步道面上低于 5lx 的连通区（4 邻域），面积/质心/极值在栅格上统计；几何轮廓取 5lx 等值面 */
function findDimZones(grid: Grid, contourPolys: Vec2[][][]): DimZone[] {
  const { nx, ny, values, onTrail, cells } = grid;
  const comp = new Int32Array(nx * ny).fill(-1);
  const zones: { id: number; indices: number[] }[] = [];
  const stack: number[] = [];
  for (let start = 0; start < comp.length; start++) {
    if (comp[start] !== -1 || !onTrail[start] || values[start] >= DIM_THRESHOLD) continue;
    const id = zones.length;
    const indices: number[] = [];
    comp[start] = id;
    stack.push(start);
    while (stack.length) {
      const i = stack.pop()!;
      indices.push(i);
      const ix = i % nx;
      const iy = (i / nx) | 0;
      const neigh = [
        ix > 0 ? i - 1 : -1,
        ix < nx - 1 ? i + 1 : -1,
        iy > 0 ? i - nx : -1,
        iy < ny - 1 ? i + nx : -1,
      ];
      for (const n of neigh) {
        if (
          n >= 0 &&
          comp[n] === -1 &&
          onTrail[n] &&
          values[n] < DIM_THRESHOLD
        ) {
          comp[n] = id;
          stack.push(n);
        }
      }
    }
    zones.push({ id, indices });
  }

  return zones
    .map((z, k) => {
      let minLux = Infinity;
      let sumLux = 0;
      let cx = 0;
      let cy = 0;
      for (const i of z.indices) {
        const v = values[i];
        minLux = Math.min(minLux, v);
        sumLux += v;
        cx += cells[i].x;
        cy += cells[i].y;
      }
      const n = z.indices.length;
      cx /= n;
      cy /= n;
      // 匹配覆盖该连通区质心的 5lx 等值面；匹配不到时回退到边界凸包
      const matched = contourPolys.filter((poly) =>
        pointInPolygonWithHoles(cx, cy, poly[0] ?? [], poly.slice(1)),
      );
      const rings: Vec2[][][] = matched.length ? matched : [[componentRing(grid, comp, k)]];
      return {
        id: `dim-${k + 1}`,
        rings,
        areaM2: n * GRID_SPACING * GRID_SPACING,
        centroid: [cx, cy] as Vec2,
        minLux,
        meanLux: sumLux / n,
      };
    })
    .filter((z) => z.areaM2 >= 1);
}

/** 连通区外包多边形：取单元中心的凸包式简化（alpha 形状代价高，这里用外接矩形+边界点环） */
function componentRing(grid: Grid, comp: Int32Array, id: number): Vec2[] {
  const pts: Vec2[] = [];
  for (let i = 0; i < comp.length; i++) {
    if (comp[i] !== id) continue;
    const ix = i % grid.nx;
    const iy = (i / grid.nx) | 0;
    // 边界单元（存在非同组分隔邻居）才入环
    const neighbors = [
      i - 1,
      i + 1,
      i - grid.nx,
      i + grid.nx,
    ];
    const boundary = neighbors.some((n) => n < 0 || n >= comp.length || comp[n] !== id);
    if (boundary) pts.push([grid.minX + ix + 0.5, grid.minY + iy + 0.5]);
  }
  if (pts.length < 3) {
    const anyIdx = comp.indexOf(id);
    const ix = anyIdx % grid.nx;
    const iy = (anyIdx / grid.nx) | 0;
    const x = grid.minX + ix;
    const y = grid.minY + iy;
    return [
      [x, y],
      [x + 1, y],
      [x + 1, y + 1],
      [x, y + 1],
    ];
  }
  return convexHull(pts);
}

export function convexHull(points: Vec2[]): Vec2[] {
  const pts = [...points].sort((a, b) => (a[0] === b[0] ? a[1] - b[1] : a[0] - b[0]));
  const cross = (o: Vec2, a: Vec2, b: Vec2) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: Vec2[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
      lower.pop();
    }
    lower.push(p);
  }
  const upper: Vec2[] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
      upper.pop();
    }
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

/** 纵断面：沿中线等距采样，关联灯位、光源高程与杆底高程 */
export function computeProfile(project: ProjectData, stepM = 2): ProfileSample[] {
  const info = polylineInfo(lineCoords(project.centerline.geometry));
  const count = Math.max(2, Math.ceil(info.total / stepM) + 1);
  const lamps = [...project.lamps].sort((a, b) => a.station - b.station);
  const out: ProfileSample[] = [];
  for (let i = 0; i < count; i++) {
    const station = i / (count - 1);
    const p = sampleAtStation(info, station);
    const near = lamps.find((l) => Math.abs(l.station - station) * info.total <= stepM / 2);
    out.push({
      station,
      s: p.s,
      x: p.x,
      y: p.y,
      groundZ: p.z,
      lamp: near ?? null,
      lampLightZ: near ? near.groundZ + poleHeight(near, project) : null,
      poleBaseZ: near ? near.groundZ : null,
    });
  }
  return out;
}
