// ---------- 光照计算引擎 ----------
// 场地为 1m 分辨率网格。建筑轮廓栅格化为高度图;
// 日照: 沿太阳方向步进做遮挡测试; 人工光: 光源到每格步进采样可见性,
// 按光源尺寸做盒式模糊得到半影; 多光源按色温转 RGB 加权叠加。

import type { SceneState, Light, Block } from '../model/types';
import { LIGHT_PRESETS } from '../model/types';
import { sunPosition, sunDir } from './solar';

export const GRID_W = 220; // 格(1m)
export const GRID_H = 150;
export const FLOOR_H = 3;  // 层高 m
export const DARK_LUX = 20; // 暗区阈值 lx

export interface EnvParams {
  date: 'summer' | 'winter';
  hour: number;      // 9..21
  latitude: number;  // 度
}

export interface BlockStat {
  id: string; name: string;
  cells: number; avgLux: number; darkCells: number; darkRatio: number;
}

export interface DarkZone { id: number; cells: number; area: number; cx: number; cy: number; }

export interface LightingResult {
  lux: Float32Array;
  r: Float32Array; g: Float32Array; b: Float32Array; // 色温加权累计(未做曝光/伽马)
  dark: Uint8Array;
  zones: DarkZone[];
  darkArea: number;
  blockStats: BlockStat[];
  sunAltDeg: number;
  sunAzDeg: number;
  sunLux: number;   // 无遮挡处太阳直射水平照度
  night: boolean;
}

// ---------- 色温 -> RGB (Tanner Helland 近似), 返回 0..1 ----------
export function kelvinToRgb(k: number): [number, number, number] {
  const t = Math.max(1000, Math.min(40000, k)) / 100;
  let r: number, g: number, b: number;
  if (t <= 66) r = 255;
  else r = 329.698727446 * Math.pow(t - 60, -0.1332047592);
  if (t <= 66) g = 99.4708025861 * Math.log(t) - 161.1195681661;
  else g = 288.1221695283 * Math.pow(t - 60, -0.0755148492);
  if (t >= 66) b = 255;
  else if (t <= 19) b = 0;
  else b = 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  const c = (v: number) => Math.max(0, Math.min(255, v)) / 255;
  return [c(r), c(g), c(b)];
}

export function pointInPoly(x: number, y: number, poly: { x: number; y: number }[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y, xj = poly[j].x, yj = poly[j].y;
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// ---------- 建筑 -> 高度图 ----------
export function rasterizeHeights(scene: SceneState): Float32Array {
  const h = new Float32Array(GRID_W * GRID_H);
  for (const b of scene.buildings) {
    const bh = b.floors * FLOOR_H;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of b.polygon) {
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
    }
    const x0 = Math.max(0, Math.floor(minX)), x1 = Math.min(GRID_W - 1, Math.ceil(maxX));
    const y0 = Math.max(0, Math.floor(minY)), y1 = Math.min(GRID_H - 1, Math.ceil(maxY));
    for (let gy = y0; gy <= y1; gy++) {
      for (let gx = x0; gx <= x1; gx++) {
        if (pointInPoly(gx + 0.5, gy + 0.5, b.polygon)) {
          const i = gy * GRID_W + gx;
          if (h[i] < bh) h[i] = bh;
        }
      }
    }
  }
  return h;
}

function heightAt(hm: Float32Array, x: number, y: number): number {
  const gx = Math.floor(x), gy = Math.floor(y);
  if (gx < 0 || gy < 0 || gx >= GRID_W || gy >= GRID_H) return 0;
  return hm[gy * GRID_W + gx];
}

// ---------- 盒式模糊(可分离), 用于半影 ----------
function boxBlur(src: Float32Array, w: number, h: number, radius: number): Float32Array {
  if (radius <= 0) return src;
  const tmp = new Float32Array(src.length);
  const dst = new Float32Array(src.length);
  const n = radius * 2 + 1;
  for (let y = 0; y < h; y++) {
    let acc = 0;
    for (let x = -radius; x <= radius; x++) acc += src[y * w + Math.min(w - 1, Math.max(0, x))];
    for (let x = 0; x < w; x++) {
      tmp[y * w + x] = acc / n;
      const xa = Math.min(w - 1, x + radius + 1), xs = Math.max(0, x - radius);
      acc += src[y * w + xa] - src[y * w + xs];
    }
  }
  for (let x = 0; x < w; x++) {
    let acc = 0;
    for (let y = -radius; y <= radius; y++) acc += tmp[Math.min(h - 1, Math.max(0, y)) * w + x];
    for (let y = 0; y < h; y++) {
      dst[y * w + x] = acc / n;
      const ya = Math.min(h - 1, y + radius + 1), ys = Math.max(0, y - radius);
      acc += tmp[ya * w + x] - tmp[ys * w + x];
    }
  }
  return dst;
}

// ---------- 单个光源的可见性(0/1) + 半影模糊 ----------
function lightVisibility(light: Light, hm: Float32Array): { vis: Float32Array; x0: number; y0: number; w: number; h: number } {
  const R = Math.ceil(light.radius);
  const x0 = Math.max(0, Math.floor(light.pos.x - R));
  const y0 = Math.max(0, Math.floor(light.pos.y - R));
  const x1 = Math.min(GRID_W - 1, Math.ceil(light.pos.x + R));
  const y1 = Math.min(GRID_H - 1, Math.ceil(light.pos.y + R));
  const w = x1 - x0 + 1, h = y1 - y0 + 1;
  const bin = new Float32Array(w * h);
  const lh = light.height;
  for (let gy = 0; gy < h; gy++) {
    for (let gx = 0; gx < w; gx++) {
      const cx = x0 + gx + 0.5, cy = y0 + gy + 0.5;
      const dx = cx - light.pos.x, dy = cy - light.pos.y;
      const dist = Math.hypot(dx, dy);
      if (dist > light.radius) continue;
      // 从光源向地面点步进, 光线高度 lh*(1-t), 被更高建筑遮挡
      const steps = Math.max(1, Math.ceil(dist));
      let blocked = false;
      for (let s = 1; s < steps; s++) {
        const t = s / steps;
        const bh = heightAt(hm, light.pos.x + dx * t, light.pos.y + dy * t);
        if (bh > lh * (1 - t) + 0.01) { blocked = true; break; }
      }
      bin[gy * w + gx] = blocked ? 0 : 1;
    }
  }
  // 半影: 光源尺寸越大, 阴影边缘越柔
  const size = LIGHT_PRESETS[light.type].size;
  const radius = Math.max(1, Math.min(4, Math.round(size * 4)));
  return { vis: boxBlur(bin, w, h, radius), x0, y0, w, h };
}

// ---------- 主计算 ----------
export function computeLighting(scene: SceneState, env: EnvParams): LightingResult {
  const N = GRID_W * GRID_H;
  const lux = new Float32Array(N);
  const R = new Float32Array(N), G = new Float32Array(N), B = new Float32Array(N);
  const hm = rasterizeHeights(scene);

  // --- 太阳 ---
  const sun = sunPosition(env.date, env.hour, env.latitude);
  const sinAlt = Math.sin(sun.altitude);
  const night = sun.altitude <= 0;
  let sunLux = 0;
  if (!night) {
    const direct = 100000 * sinAlt;              // 直射水平照度
    const diffuse = 12000 * Math.sqrt(sinAlt);   // 天空漫射, 处处可得
    sunLux = direct;
    const sd = sunDir(sun.azimuth);
    let maxH = 0;
    for (let i = 0; i < N; i++) if (hm[i] > maxH) maxH = hm[i];
    const tanAlt = Math.tan(sun.altitude);
    const maxLen = maxH / tanAlt;
    const sunK = 2000 + 4500 * sinAlt; // 低角度偏暖
    const [sr, sg, sb] = kelvinToRgb(sunK);
    for (let gy = 0; gy < GRID_H; gy++) {
      for (let gx = 0; gx < GRID_W; gx++) {
        const i = gy * GRID_W + gx;
        let e = diffuse;
        if (hm[i] < 0.01) { // 建筑内部不计算直射(屋面另论)
          let shaded = false;
          const steps = Math.ceil(maxLen);
          for (let s = 1; s <= steps; s++) {
            const d = s;
            const bh = heightAt(hm, gx + 0.5 + sd.x * d, gy + 0.5 + sd.y * d);
            if (bh >= d * tanAlt) { shaded = true; break; }
          }
          if (!shaded) e += direct;
        }
        lux[i] += e;
        R[i] += e * sr; G[i] += e * sg; B[i] += e * sb;
      }
    }
  } else {
    // 夜间环境底数
    for (let i = 0; i < N; i++) { lux[i] += 0.3; R[i] += 0.1; G[i] += 0.1; B[i] += 0.12; }
  }

  // --- 人工光 ---
  for (const l of scene.lights) {
    if (!l.on) continue;
    const { vis, x0, y0, w, h } = lightVisibility(l, hm);
    const [lr, lg, lb] = kelvinToRgb(l.kelvin);
    const h2 = l.height * l.height;
    for (let gy = 0; gy < h; gy++) {
      for (let gx = 0; gx < w; gx++) {
        const v = vis[gy * w + gx];
        if (v <= 0.001) continue;
        const cx = x0 + gx + 0.5, cy = y0 + gy + 0.5;
        const dx = cx - l.pos.x, dy = cy - l.pos.y;
        const d2 = dx * dx + dy * dy;
        const d = Math.sqrt(d2);
        if (d > l.radius) continue;
        // 点光源余弦三次方衰减: E = I*h / (h^2+d^2)^1.5
        let e = (l.intensity * l.height) / Math.pow(h2 + d2, 1.5);
        // 半径外缘平滑截止
        const edge = d / l.radius;
        if (edge > 0.8) e *= 1 - (edge - 0.8) / 0.2;
        e *= v;
        const i = (y0 + gy) * GRID_W + (x0 + gx);
        lux[i] += e;
        R[i] += e * lr; G[i] += e * lg; B[i] += e * lb;
      }
    }
  }

  // --- 暗区掩膜与连通域 ---
  const dark = new Uint8Array(N);
  for (let i = 0; i < N; i++) dark[i] = lux[i] < DARK_LUX ? 1 : 0;
  const zones: DarkZone[] = [];
  const seen = new Uint8Array(N);
  const stack: number[] = [];
  let zid = 0;
  for (let i = 0; i < N; i++) {
    if (!dark[i] || seen[i]) continue;
    zid++;
    let cells = 0, sx = 0, sy = 0;
    stack.length = 0;
    stack.push(i); seen[i] = 1;
    while (stack.length) {
      const c = stack.pop()!;
      const cx = c % GRID_W, cy = (c / GRID_W) | 0;
      cells++; sx += cx; sy += cy;
      if (cx > 0 && dark[c - 1] && !seen[c - 1]) { seen[c - 1] = 1; stack.push(c - 1); }
      if (cx < GRID_W - 1 && dark[c + 1] && !seen[c + 1]) { seen[c + 1] = 1; stack.push(c + 1); }
      if (cy > 0 && dark[c - GRID_W] && !seen[c - GRID_W]) { seen[c - GRID_W] = 1; stack.push(c - GRID_W); }
      if (cy < GRID_H - 1 && dark[c + GRID_W] && !seen[c + GRID_W]) { seen[c + GRID_W] = 1; stack.push(c + GRID_W); }
    }
    zones.push({ id: zid, cells, area: cells, cx: sx / cells, cy: sy / cells });
  }
  zones.sort((a, b) => b.cells - a.cells);
  const darkArea = zones.reduce((s, z) => s + z.cells, 0);

  // --- 街坊统计 ---
  const blockStats: BlockStat[] = scene.blocks.map((b: Block) => {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of b.polygon) {
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
    }
    let cells = 0, sum = 0, dk = 0;
    const x0 = Math.max(0, Math.floor(minX)), x1 = Math.min(GRID_W - 1, Math.ceil(maxX));
    const y0 = Math.max(0, Math.floor(minY)), y1 = Math.min(GRID_H - 1, Math.ceil(maxY));
    for (let gy = y0; gy <= y1; gy++) {
      for (let gx = x0; gx <= x1; gx++) {
        if (!pointInPoly(gx + 0.5, gy + 0.5, b.polygon)) continue;
        const i = gy * GRID_W + gx;
        cells++; sum += lux[i]; if (dark[i]) dk++;
      }
    }
    return {
      id: b.id, name: b.name, cells,
      avgLux: cells ? sum / cells : 0,
      darkCells: dk,
      darkRatio: cells ? dk / cells : 0,
    };
  });

  return {
    lux, r: R, g: G, b: B, dark, zones, darkArea, blockStats,
    sunAltDeg: sun.altitude * 180 / Math.PI,
    sunAzDeg: sun.azimuth * 180 / Math.PI,
    sunLux, night,
  };
}
