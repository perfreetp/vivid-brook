import type { Vec2 } from '../types.js';

export const DEG = Math.PI / 180;
export const RAD = 180 / Math.PI;

export const v = (x: number, y: number): Vec2 => ({ x, y });
export const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
export const scale = (a: Vec2, s: number): Vec2 => ({ x: a.x * s, y: a.y * s });

export function rotate(p: Vec2, angleDeg: number): Vec2 {
  const c = Math.cos(angleDeg * DEG);
  const s = Math.sin(angleDeg * DEG);
  return { x: p.x * c - p.y * s, y: p.x * s + p.y * c };
}

/** 局部坐标 -> 世界坐标：先绕 origin 旋转再平移 */
export function toWorld(local: Vec2, origin: Vec2, worldAngleDeg: number): Vec2 {
  return add(origin, rotate(local, worldAngleDeg));
}

export function dist(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** 角度差，归一化到 (-180, 180] */
export function angleDelta(a: number, b: number): number {
  let d = (a - b) % 360;
  if (d > 180) d -= 360;
  if (d <= -180) d += 360;
  return d;
}

export function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export const uid = (prefix = 'id'): string =>
  `${prefix}_${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;

export const fmtTime = (ms: number | null): string => {
  if (ms === null) return '—';
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

export function daysLeft(deadline: number | null, now = Date.now()): string {
  if (deadline === null) return '无截止时间';
  const d = Math.ceil((deadline - now) / 86400000);
  if (d < 0) return `已逾期 ${-d} 天`;
  if (d === 0) return '今天截止';
  return `剩余 ${d} 天`;
}
