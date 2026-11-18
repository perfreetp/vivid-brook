// 世界空间确定性高度函数：给定 seed + 参数，任意 (x,z) 的高度唯一确定
// 所有特征按世界坐标生成，因此跨区块边界天然连续，分块重算不会出现裂缝
import { BANDS, FIELD_SIZE, SLOPE_GRADE_RATIOS } from './config';
import type { TerrainParams } from '../types';
import { fbm, hash32, makeRng, rand01 } from './random';

/** 带内权重：带内为 1，带外两侧各 1m 平滑衰减到 0，保证特征带之间过渡 */
function bandWeight(z: number, z0: number, z1: number): number {
  const edge = 1.0;
  if (z < z0 - edge || z > z1 + edge) return 0;
  let w = 1;
  if (z < z0) w *= (z - (z0 - edge)) / edge;
  if (z > z1) w *= ((z1 + edge) - z) / edge;
  return Math.max(0, Math.min(1, w));
}

/** 基础起伏：全场都存在，幅度 0.18m 的缓丘 */
function baseHeight(seed: number, x: number, z: number): number {
  return (fbm(seed, x, z, 3) - 0.5) * 0.36;
}

/** 坡度带：沿 z 方向的斜坡，档位即坡度百分比，两侧衰减保证与相邻带衔接 */
function slopeHeight(seed: number, x: number, z: number, grade: number): number {
  const b = BANDS.slope;
  const w = bandWeight(z, b.z0, b.z1);
  if (w === 0) return 0;
  const ratio = SLOPE_GRADE_RATIOS[grade];
  // 带中心处相对高度为 0，向两侧线性升降，真实坡度 = ratio
  const ramp = (z - (b.z0 + b.z1) / 2) * ratio;
  // 叠加与坡度无关的微小横向起伏，让坡面不是完美平面
  const micro = (fbm(seed + 71, x, z, 2) - 0.5) * 0.05;
  return (ramp + micro) * w;
}

/** 台阶带：沿 z 方向的确定性等距台阶，每级高度 = stepHeight */
function stepHeightFn(seed: number, x: number, z: number, stepH: number): number {
  const b = BANDS.step;
  const w = bandWeight(z, b.z0, b.z1);
  if (w === 0) return 0;
  const tread = 1.6; // 踏步宽 1.6m
  const localZ = z - b.z0;
  const level = Math.floor(localZ / tread);
  // 台阶沿 x 方向加一个确定性小错台，避免一条直线贯通
  const shift = rand01(seed + 11, level, 7) > 0.5 ? 0.4 : 0;
  const h = level * stepH + shift * stepH * 0.25;
  return h * w;
}

interface GravelStone {
  cx: number;
  cz: number;
  r: number;
  h: number;
}

let gravelCache: { key: string; stones: GravelStone[] } | null = null;

/** 碎石布局：抖动网格，密度决定布石概率与数量，seed 决定全部位置/尺寸 */
export function buildGravelStones(seed: number, density: number): GravelStone[] {
  const key = `${seed}:${density}`;
  if (gravelCache && gravelCache.key === key) return gravelCache.stones;
  const stones: GravelStone[] = [];
  if (density <= 0) {
    gravelCache = { key, stones };
    return stones;
  }
  const b = BANDS.gravel;
  const spacing = 1.1;
  const cols = Math.floor(FIELD_SIZE / spacing);
  const rows = Math.floor((b.z1 - b.z0) / spacing);
  const rng = makeRng(hash32(seed, 9001, 3));
  for (let i = 0; i < cols; i++) {
    for (let j = 0; j < rows; j++) {
      // 密度 0..1 映射到布石概率 0.08..0.95
      const p = 0.08 + density * 0.87;
      if (rng() > p) continue;
      const cx = i * spacing + rng() * spacing * 0.8 + 0.2;
      const cz = b.z0 + j * spacing + rng() * spacing * 0.8 + 0.2;
      const r = 0.18 + rng() * 0.28;
      const h = 0.06 + density * 0.16 + rng() * 0.05;
      stones.push({ cx, cz, r, h });
    }
  }
  gravelCache = { key, stones };
  return stones;
}

/** 碎石带：圆顶碎石叠加 */
function gravelHeight(seed: number, x: number, z: number, density: number): number {
  const b = BANDS.gravel;
  const w = bandWeight(z, b.z0, b.z1);
  if (w === 0) return 0;
  const stones = buildGravelStones(seed, density);
  let h = 0;
  for (const s of stones) {
    const dx = x - s.cx;
    const dz = z - s.cz;
    const d2 = dx * dx + dz * dz;
    if (d2 >= s.r * s.r) continue;
    const d = Math.sqrt(d2) / s.r;
    h += s.h * (1 - d * d); // 圆顶
  }
  return h * w;
}

/** 沟槽带：中心线随 seed 摆动的直沟槽，宽度 = trenchWidth，深 0.6m，两侧碗形过渡 */
function trenchHeight(seed: number, x: number, z: number, width: number): number {
  const b = BANDS.trench;
  const w = bandWeight(z, b.z0, b.z1);
  if (w === 0) return 0;
  // 沟槽中心线沿 z 缓慢摆动
  const center = FIELD_SIZE / 2 + Math.sin((z - b.z0) * 0.35 + seed) * 1.2;
  const d = Math.abs(x - center);
  const half = width / 2;
  const lip = 0.35; // 沟沿过渡宽度
  let cut = 0;
  if (d <= half) {
    cut = 0.6;
  } else if (d <= half + lip) {
    const t = (d - half) / lip;
    cut = 0.6 * (1 - t * t);
  }
  return -cut * w;
}

/** 涉水带：下凹盆地，盆地内水面高度由参数决定（渲染层读 waterDepth） */
function waterHeight(seed: number, x: number, z: number, depth: number): number {
  const b = BANDS.water;
  const w = bandWeight(z, b.z0, b.z1);
  if (w === 0) return 0;
  // 盆地形状：带中心最深，向四周抬升
  const t = Math.abs(z - (b.z0 + b.z1) / 2) / ((b.z1 - b.z0) / 2);
  const basin = Math.max(0, 1 - t * t);
  const xEdge = Math.abs(x - FIELD_SIZE / 2) / (FIELD_SIZE / 2);
  const xw = Math.max(0, 1 - xEdge * xEdge * 0.5);
  return -depth * basin * xw * w;
}

/** 单点世界高度（纯函数，确定性） */
export function heightAt(seed: number, p: TerrainParams, x: number, z: number): number {
  let h = baseHeight(seed, x, z);
  if (p.slopeGrade > 0) h += slopeHeight(seed, x, z, p.slopeGrade);
  if (p.stepHeight > 0) h += stepHeightFn(seed, x, z, p.stepHeight);
  if (p.gravelDensity > 0) h += gravelHeight(seed, x, z, p.gravelDensity);
  if (p.trenchWidth > 0) h += trenchHeight(seed, x, z, p.trenchWidth);
  if (p.waterDepth > 0) h += waterHeight(seed, x, z, p.waterDepth);
  return h;
}

/** 水面世界高度（涉水带基准 0 + 水深），无涉水时返回 null */
export function waterLevelAt(p: TerrainParams, z: number): number | null {
  if (p.waterDepth <= 0) return null;
  const b = BANDS.water;
  const w = bandWeight(z, b.z0, b.z1);
  if (w <= 0) return null;
  return p.waterDepth * 0.35 * w;
}
