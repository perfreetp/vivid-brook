import type { Vec2 } from '../types';

export interface ViewTransform {
  k: number;
  tx: number;
  ty: number;
}

/** 世界米制坐标 → SVG 屏幕坐标（SVG 内部再套一个 g 做 d3.zoom 变换） */
export function makeProjection(width: number, height: number, bounds: {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}, pad = 40) {
  const w = bounds.maxX - bounds.minX || 1;
  const h = bounds.maxY - bounds.minY || 1;
  const s = Math.min((width - pad * 2) / w, (height - pad * 2) / h);
  const ox = (width - w * s) / 2;
  const oy = (height - h * s) / 2;
  return {
    scale: s,
    project: (x: number, y: number): Vec2 => [ox + (x - bounds.minX) * s, oy + (y - bounds.minY) * s],
    invert: (px: number, py: number): Vec2 => [
      bounds.minX + (px - ox) / s,
      bounds.minY + (py - oy) / s,
    ],
  };
}

export function pathFromRing(project: (x: number, y: number) => Vec2, ring: Vec2[]): string {
  return ring
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${project(p[0], p[1])[0].toFixed(1)},${project(p[0], p[1])[1].toFixed(1)}`)
    .join(' ') + ' Z';
}

export function pathFromLine(project: (x: number, y: number) => Vec2, pts: Vec2[]): string {
  return pts
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${project(p[0], p[1])[0].toFixed(1)},${project(p[0], p[1])[1].toFixed(1)}`)
    .join(' ');
}

/** 热力色阶（log 友好的分段色） */
export function heatColor(lux: number): string {
  if (lux <= 0.05) return 'rgba(20,26,36,0.55)';
  const stops: [number, string][] = [
    [0.5, '#1b2a4a'],
    [2, '#1f4e79'],
    [5, '#2e7d8c'],
    [10, '#3fa66a'],
    [20, '#a8c14a'],
    [40, '#e8b339'],
    [80, '#e0642f'],
    [Infinity, '#b8323f'],
  ];
  for (const [v, c] of stops) {
    if (lux <= v) return c;
  }
  return stops[stops.length - 1][1];
}
