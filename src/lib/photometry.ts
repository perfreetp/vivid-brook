import type { Lamp, LampModel, ProjectData, Vec2, Vec3 } from '../types';
import { polygonRings } from '../types';
import { clamp, deg2rad, jitteredDiskSamples, lerp, pointInPolygonWithHoles } from './geometry';

/** 建议灯杆高度：落在台阶范围内时，按台阶高差抬高，保证上沿净空 */
export function suggestPoleHeight(lamp: Lamp, project: ProjectData): number {
  let step = 0;
  for (const f of project.steps) {
    const rings = polygonRings(f.geometry);
    const outer = (rings[0] ?? []).map((p) => [p[0], p[1]] as Vec2);
    const holes = rings.slice(1).map((r) => r.map((p) => [p[0], p[1]] as Vec2));
    if (pointInPolygonWithHoles(lamp.x, lamp.y, outer, holes)) {
      step = Math.max(step, f.properties.topElev - f.properties.bottomElev);
    }
  }
  return clamp(4.5 + step, 4, 10);
}

export function poleHeight(lamp: Lamp, project: ProjectData): number {
  return lamp.poleHeightOverride ?? suggestPoleHeight(lamp, project);
}

export function sourcePosition(lamp: Lamp, project: ProjectData): { x: number; y: number; z: number } {
  return { x: lamp.x, y: lamp.y, z: lamp.groundZ + poleHeight(lamp, project) };
}

/** 无项目上下文时按灯自身参数取光源位置（测试/独立计算用） */
export function pointSourceAt(lamp: Lamp): { x: number; y: number; z: number } {
  return { x: lamp.x, y: lamp.y, z: lamp.groundZ + (lamp.poleHeightOverride ?? 4.5) };
}

/** 光轴单位方向；azimuth=null 时垂直向下 */
export function opticalAxis(lamp: Lamp): { dx: number; dy: number; dz: number } {
  if (lamp.aimAzimuth === null) return { dx: 0, dy: 0, dz: -1 };
  const az = deg2rad(lamp.aimAzimuth);
  const tilt = deg2rad(lamp.aimTilt); // 相对水平面的俯角
  const horiz = Math.cos(tilt);
  return { dx: horiz * Math.cos(az), dy: horiz * Math.sin(az), dz: -Math.sin(tilt) };
}

interface BeamProfile {
  halfBeam: number; // rad
  shield: number; // rad，相对下垂线
  shape: (theta: number) => number;
  /** 归一化系数 I0，使 ∫I dΩ = flux */
  i0PerFlux: number;
}

const profileCache = new Map<string, BeamProfile>();

/**
 * 光强分布：光束角内 I=I0·cos^n(θ)，边缘平滑截止；
 * 遮光角之外（相对下垂线）强制为零。
 * 归一化：Φ = 2π∫ I(θ)sinθ dθ（数值积分）。
 */
export function beamProfile(lamp: Lamp): BeamProfile {
  const key = `${lamp.beamAngle}|${lamp.shieldAngle}|${lamp.aimAzimuth === null ? 'down' : 'aim'}`;
  const hit = profileCache.get(key);
  if (hit) return hit;

  const halfBeam = deg2rad(lamp.beamAngle / 2);
  const shield = deg2rad(lamp.shieldAngle);
  const n = 2.2;
  const soft = deg2rad(4); // 边缘 4° 平滑带
  const shape = (theta: number): number => {
    if (theta > halfBeam) return 0;
    const c = Math.cos(theta) ** n;
    if (theta >= halfBeam - soft) {
      const u = clamp((halfBeam - theta) / soft, 0, 1);
      return c * (u * u * (3 - 2 * u)); // smoothstep
    }
    return c;
  };

  const steps = 240;
  let integral = 0;
  for (let i = 0; i < steps; i++) {
    const t0 = (i / steps) * Math.PI;
    const t1 = ((i + 1) / steps) * Math.PI;
    const tm = (t0 + t1) / 2;
    integral += shape(tm) * Math.sin(tm) * (t1 - t0);
  }
  const i0PerFlux = integral > 1e-9 ? 1 / (2 * Math.PI * integral) : 0;
  const p: BeamProfile = { halfBeam, shield, shape, i0PerFlux };
  profileCache.set(key, p);
  return p;
}

export function totalFlux(lamp: Lamp, model: LampModel): number {
  return lamp.power * model.efficacy;
}

export interface Prism {
  rings: Vec2[][]; // [outer, ...holes]
  zMin: number;
  zMax: number;
  solid: boolean; // false = 树冠（半透射）
  transmittance: number;
}

export interface OccluderScene {
  prisms: Prism[];
}

function toRings(coords: Vec3[][]): Vec2[][] {
  return coords.map((r) => r.map((p) => [p[0], p[1]] as Vec2));
}

export function buildScene(project: ProjectData): OccluderScene {
  const prisms: Prism[] = [];
  for (const w of project.walls) {
    prisms.push({
      rings: toRings(polygonRings(w.geometry)),
      zMin: w.properties.baseElev,
      zMax: w.properties.baseElev + w.properties.height,
      solid: true,
      transmittance: 0,
    });
  }
  for (const b of project.buildings) {
    prisms.push({
      rings: toRings(polygonRings(b.geometry)),
      zMin: b.properties.baseElev,
      zMax: b.properties.baseElev + b.properties.height,
      solid: true,
      transmittance: 0,
    });
  }
  for (const c of project.canopies) {
    prisms.push({
      rings: toRings(polygonRings(c.geometry)),
      zMin: c.properties.trunkTop,
      zMax: c.properties.canopyTop,
      solid: false,
      transmittance: c.properties.transmittance,
    });
  }
  return { prisms };
}

function rayPrism(
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  prism: Prism,
  maxT: number,
): number | null {
  let best: number | null = null;
  const consider = (t: number) => {
    if (t > 1e-6 && t <= maxT && (best === null || t < best)) best = t;
  };
  const [outer, ...holes] = prism.rings;
  for (const z of [prism.zMin, prism.zMax]) {
    if (Math.abs(dz) > 1e-12) {
      const t = (z - oz) / dz;
      if (t > 1e-6 && t <= maxT) {
        const hx = ox + dx * t;
        const hy = oy + dy * t;
        if (pointInPolygonWithHoles(hx, hy, outer, holes)) consider(t);
      }
    }
  }
  for (const ring of prism.rings) {
    for (let i = 0; i < ring.length; i++) {
      const [ax, ay] = ring[i];
      const [bx, by] = ring[(i + 1) % ring.length];
      const ex = bx - ax;
      const ey = by - ay;
      const denom = dx * ey - dy * ex;
      if (Math.abs(denom) < 1e-12) continue;
      const rx = ax - ox;
      const ry = ay - oy;
      const t = (rx * ey - ry * ex) / denom;
      const u = (rx * dy - ry * dx) / denom;
      if (t > 1e-6 && t <= maxT && u >= 0 && u <= 1) {
        const hz = oz + dz * t;
        if (hz >= prism.zMin - 1e-9 && hz <= prism.zMax + 1e-9) consider(t);
      }
    }
  }
  return best;
}

/** 沿射线的遮挡系数：实体挡墙/建筑截断为 0，树冠按透射率累乘 */
export function visibilityFactor(
  scene: OccluderScene,
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  maxT: number,
): number {
  let factor = 1;
  let px = ox;
  let py = oy;
  let pz = oz;
  let remain = maxT;
  let guard = 0;
  while (guard++ < 8) {
    let nearest: { t: number; prism: Prism } | null = null;
    for (const prism of scene.prisms) {
      const t = rayPrism(px, py, pz, dx, dy, dz, prism, remain);
      if (t !== null && (nearest === null || t < nearest.t)) nearest = { t, prism };
    }
    if (!nearest) return factor;
    if (nearest.prism.solid) return 0;
    factor *= nearest.prism.transmittance;
    const eps = 0.05;
    px += dx * (nearest.t + eps);
    py += dy * (nearest.t + eps);
    pz += dz * (nearest.t + eps);
    remain -= nearest.t + eps;
    if (remain <= 0) return factor;
  }
  return factor;
}

export interface SurfacePoint {
  x: number;
  y: number;
  z: number;
}

const modelSizeCache = new Map<string, number>();
export function registerModelSizes(models: LampModel[]): void {
  modelSizeCache.clear();
  for (const m of models) modelSizeCache.set(m.id, m.sourceSize);
}
export function sourceSizeOf(modelId: string): number {
  return modelSizeCache.get(modelId) ?? 0;
}

export function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h) % 1000 + 1;
}

/**
 * 单灯对地面点的照度贡献（lx）。
 * 光源有尺寸时按发光面圆盘抖动多次采样，软阴影（半影）自然产生。
 */
export function directIlluminance(
  lamp: Lamp,
  model: LampModel,
  scene: OccluderScene,
  target: SurfacePoint,
  src: { x: number; y: number; z: number },
  sampleCount = 9,
): number {
  const profile = beamProfile(lamp);
  const flux = totalFlux(lamp, model);
  const radius = model.sourceSize / 2;
  const offsets = radius > 0 ? jitteredDiskSamples(sampleCount, hashString(lamp.id)) : ([[0, 0]] as Vec2[]);
  const axis = opticalAxis(lamp);
  let sum = 0;
  for (const [ox, oy] of offsets) {
    const sx = src.x + ox;
    const sy = src.y + oy;
    const sz = src.z;
    const vx = target.x - sx;
    const vy = target.y - sy;
    const vz = target.z - sz;
    const r = Math.hypot(vx, vy, vz);
    if (r < 0.05) continue;
    const dx = vx / r;
    const dy = vy / r;
    const dz = vz / r;
    if (dz >= -1e-9) continue; // 仰射光不到地面
    const cosIncidence = -dz;
    // 遮光角：相对下垂线
    const angleFromDown = Math.acos(clamp(-dz, -1, 1));
    if (angleFromDown > profile.shield) continue;
    // 光束角截止：相对光轴
    const cosTheta = clamp(dx * axis.dx + dy * axis.dy + dz * axis.dz, -1, 1);
    const shape = profile.shape(Math.acos(cosTheta));
    if (shape <= 0) continue;
    const vis = visibilityFactor(scene, sx, sy, sz, dx, dy, dz, r);
    if (vis <= 0) continue;
    const intensity = flux * profile.i0PerFlux * shape;
    sum += (intensity * cosIncidence * vis) / (r * r);
  }
  return sum / offsets.length;
}

/** 单灯最大有效照射半径（用于网格裁剪） */
export function maxThrowRadius(lamp: Lamp, sourceZ: number, groundZ: number, model: LampModel): number {
  const profile = beamProfile(lamp);
  const h = Math.max(0.5, sourceZ - groundZ);
  const axis = opticalAxis(lamp);
  const axisFromDown = Math.acos(clamp(-axis.dz, -1, 1));
  const limit = Math.min(profile.shield, axisFromDown + profile.halfBeam);
  const ang = Math.min(limit, deg2rad(88));
  return h * Math.tan(ang) + model.sourceSize;
}

export function cctToColor(cct: number): string {
  const t = clamp((cct - 2700) / (6500 - 2700), 0, 1);
  const r = Math.round(lerp(255, 200, t));
  const g = Math.round(lerp(197, 225, t));
  const b = Math.round(lerp(120, 255, t));
  return `rgb(${r},${g},${b})`;
}
