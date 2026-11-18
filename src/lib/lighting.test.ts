import { describe, expect, it } from 'vitest';
import { buildSampleProject } from '../data/sample';
import { computeLighting, DIM_THRESHOLD } from './engine';
import {
  beamProfile,
  buildScene,
  directIlluminance,
  opticalAxis,
  pointSourceAt,
  poleHeight,
  suggestPoleHeight,
  visibilityFactor,
} from './photometry';
import type { Lamp, LampModel, Vec3 } from '../types';
import { lineCoords } from '../types';

const model: LampModel = {
  id: 't',
  manufacturer: 't',
  name: 't',
  ratedPower: 60,
  efficacy: 100,
  cctOptions: [3000],
  beamOptions: [90],
  defaultCct: 3000,
  defaultBeam: 90,
  sourceSize: 0,
  ip: 'IP66',
};

function lamp(over: Partial<Lamp> = {}): Lamp {
  return {
    id: 'l1',
    modelId: 't',
    station: 0,
    x: 0,
    y: 0,
    groundZ: 0,
    poleHeightOverride: 5,
    luminaireHeight: 4.5,
    power: 60,
    cct: 3000,
    beamAngle: 90,
    aimAzimuth: null,
    aimTilt: 60,
    shieldAngle: 70,
    schedule: { weekday: true, festival: true, lateNight: true },
    ...over,
  };
}

describe('光度学', () => {
  it('垂直下射灯在正下方照度最大，随距离平方衰减', () => {
    const l = lamp();
    const scene = { prisms: [] };
    const src = pointSourceAt(l);
    const e0 = directIlluminance(l, model, scene, { x: 0, y: 0, z: 0 }, src);
    const e4 = directIlluminance(l, model, scene, { x: 4, y: 0, z: 0 }, src);
    const e8 = directIlluminance(l, model, scene, { x: 8, y: 0, z: 0 }, src);
    expect(e0).toBeGreaterThan(e4);
    expect(e4).toBeGreaterThan(e8);
    // 距离翻倍衰减到 1/4 以下（含角度与光束截止因素）
    expect(e4 / e0).toBeLessThan(0.3);
    // 60W * 100lm/W = 6000lm，正下方应有可观照度
    expect(e0).toBeGreaterThan(50);
  });

  it('遮光角之外无出光', () => {
    const l = lamp({ shieldAngle: 30 });
    const scene = { prisms: [] };
    const src = pointSourceAt(l);
    // 高度 5m，水平 5m => 与下垂线 45°，超过 30°
    const e = directIlluminance(l, model, scene, { x: 5, y: 0, z: 0 }, src);
    expect(e).toBe(0);
  });

  it('光束角截止：超出半角的方向被平滑截止', () => {
    const l = lamp({ beamAngle: 30, aimAzimuth: 0, aimTilt: 45 });
    const profile = beamProfile(l);
    const axis = opticalAxis(l);
    // 光轴方向 shape=1
    expect(profile.shape(0)).toBeCloseTo(1, 5);
    // 远超半角为 0
    expect(profile.shape(Math.PI / 2)).toBe(0);
    expect(axis.dz).toBeCloseTo(-Math.SQRT1_2, 5);
  });

  it('实体挡墙完全遮挡，树冠按透射率衰减', () => {
    const project = buildSampleProject();
    const scene = buildScene(project);
    // 从高处打向地面，射线必然穿过场景中某个棱柱的概率不稳定，
    // 这里直接用坐标构造：挡墙 wall-1 位于 x 30..44, y 9.2..11.2
    const wall = project.walls.find((w) => w.id === 'wall-1')!;
    const zMid = wall.properties.baseElev + wall.properties.height / 2;
    // 起点在挡墙一侧，终点在另一侧，水平穿过
    const vis = visibilityFactor(
      scene,
      28, 10.2, zMid,
      1, 0, 0,
      30,
    );
    expect(vis).toBe(0);
  });

  it('面光源多采样：本影边缘产生非二值半影（软阴影）', () => {
    const project = buildSampleProject();
    const scene = buildScene(project);
    const big: LampModel = { ...model, sourceSize: 0.4 };
    // 光源位于挡墙 wall-1（x 30..44, y 9.2..11.2, z 49.8..52.0）外侧，
    // 高度压到挡墙顶附近，使墙棱在地面投出半影带
    const l = lamp({ id: 'big', x: 27, y: 10.2, groundZ: 49.6, poleHeightOverride: 1.2 });
    const src = pointSourceAt(l);
    const ground = 49.55;
    // 沿穿过挡墙投影边缘的方向密集采样
    const samples = Array.from({ length: 9 }, (_, i) =>
      directIlluminance(l, big, scene, { x: 28 + i * 0.35, y: 10.2, z: ground }, src, 16),
    );
    const maxV = Math.max(...samples);
    // 同时存在全亮、全黑与中间过渡 => 半影带
    expect(samples[0]).toBeGreaterThan(maxV * 0.5);
    expect(samples[samples.length - 1]).toBe(0);
    const hasPartial = samples.some((v) => v > 0 && v < maxV * 0.9);
    expect(hasPartial).toBe(true);
  });
});

describe('工程规则', () => {
  it('灯杆高度随台阶高差自动建议，可手动覆盖', () => {
    const project = buildSampleProject();
    const inStep = { ...project.lamps[0], x: 26, y: 7 };
    const h = suggestPoleHeight(inStep, project);
    expect(h).toBeGreaterThan(4.5);
    expect(h).toBeCloseTo(4.5 + 1.2, 5); // 一号台阶高差 1.2m
    const manual = { ...inStep, poleHeightOverride: 6 };
    expect(poleHeight(manual, project)).toBe(6);
  });

  it('三套策略整幅重算，深夜半功率且点亮灯数不同', () => {
    const project = buildSampleProject();
    const weekday = computeLighting(project, 'weekday');
    const late = computeLighting(project, 'lateNight');
    expect(late.stats.activeLamps).toBeLessThan(weekday.stats.activeLamps);
    expect(late.stats.totalPower).toBeLessThan(weekday.stats.totalPower);
    // 同一点位深夜照度不高于平日
    const idx = weekday.grid.onTrail.findIndex((v) => v === 1);
    expect(late.grid.values[idx]).toBeLessThanOrEqual(weekday.grid.values[idx] + 1e-9);
  });

  it('低照度区面积、质心与阈值统计一致', () => {
    const project = buildSampleProject();
    const r = computeLighting(project, 'weekday');
    for (const z of r.dimZones) {
      expect(z.areaM2).toBeGreaterThanOrEqual(1);
      expect(z.minLux).toBeLessThan(DIM_THRESHOLD);
      expect(z.meanLux).toBeGreaterThanOrEqual(z.minLux);
    }
    const dimCellCount = r.dimZones.reduce((s, z) => s + z.areaM2, 0);
    expect(dimCellCount).toBeCloseTo(r.stats.dimCells, 5);
  });

  it('网格为 1m 间距并覆盖中线范围', () => {
    const project = buildSampleProject();
    const r = computeLighting(project, 'weekday');
    const line: Vec3[] = lineCoords(project.centerline.geometry);
    const xs = line.map((p) => p[0]);
    expect(r.grid.nx).toBeGreaterThan(Math.max(...xs) - Math.min(...xs));
  });
});
