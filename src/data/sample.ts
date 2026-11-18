import type { Boundary, ElevationPoint, Vec2 } from '../state/types';

export interface SampleDataset {
  points: ElevationPoint[];
  boundaries: Boundary[];
  centerControls: Vec2[];
  leftCrestControls: Vec2[];
  rightCrestControls: Vec2[];
}

/**
 * 生成一段约 2.4km 的蜿蜒河道示例数据：
 * 中心线呈正弦摆动，断面沿法线布设，河床下凹、滩地抬升，叠加平缓起伏噪声。
 */
export function generateSampleReach(): SampleDataset {
  const L = 2400; // 河段长度 m
  const halfWidth = 90; // 河槽半宽
  const amp = 130; // 摆动幅度
  const wavelength = 900;

  const centerAt = (s: number): Vec2 => ({
    x: s,
    y: amp * Math.sin((2 * Math.PI * s) / wavelength) + 35 * Math.sin((2 * Math.PI * s) / 420 + 1.2)
  });
  const tangentAt = (s: number): Vec2 => {
    const dx = 1;
    const dy =
      amp * (2 * Math.PI / wavelength) * Math.cos((2 * Math.PI * s) / wavelength) +
      35 * (2 * Math.PI / 420) * Math.cos((2 * Math.PI * s) / 420 + 1.2);
    const l = Math.hypot(dx, dy);
    return { x: dx / l, y: dy / l };
  };

  const points: ElevationPoint[] = [];
  const leftEdge: Vec2[] = [];
  const rightEdge: Vec2[] = [];
  const leftCrest: Vec2[] = [];
  const rightCrest: Vec2[] = [];
  const centerControls: Vec2[] = [];

  const sectionStep = 60; // 断面间距
  const acrossStep = 15; // 断面上点距

  for (let s = 0; s <= L; s += sectionStep) {
    const c = centerAt(s);
    const t = tangentAt(s);
    const nx = -t.y;
    const ny = t.x;
    for (let off = -halfWidth; off <= halfWidth; off += acrossStep) {
      const x = c.x + nx * off;
      const y = c.y + ny * off;
      // 河槽横断面：抛物线下凹，深槽偏左
      const bed = -7.5 * Math.exp(-Math.pow((off + 18) / 42, 2));
      const bench = 2.6 * Math.pow(Math.abs(off) / halfWidth, 2.2); // 滩地抬升
      const undulation =
        0.55 * Math.sin(s / 170 + off / 55) + 0.3 * Math.sin(s / 73 + off / 31 + 2.1);
      const z = 22 + bed + bench + undulation;
      points.push({ x, y, z });
    }
    leftEdge.push({ x: c.x + nx * halfWidth, y: c.y + ny * halfWidth });
    rightEdge.push({ x: c.x - nx * halfWidth, y: c.y - ny * halfWidth });
    // 堤顶线距水边约 28m，高出 3.5~4.5m
    const crestOff = halfWidth + 28;
    leftCrest.push({ x: c.x + nx * crestOff, y: c.y + ny * crestOff });
    rightCrest.push({ x: c.x - nx * crestOff, y: c.y - ny * crestOff });
  }

  // 控制点稀疏化（样条由作业员再调整）
  for (let s = 0; s <= L; s += 240) centerControls.push(centerAt(s));

  const boundaries: Boundary[] = [
    { id: 'bnd-left', name: '左岸水边线', points: leftEdge },
    { id: 'bnd-right', name: '右岸水边线', points: rightEdge }
  ];

  return {
    points,
    boundaries,
    centerControls,
    leftCrestControls: leftCrest.filter((_, i) => i % 4 === 0),
    rightCrestControls: rightCrest.filter((_, i) => i % 4 === 0)
  };
}
