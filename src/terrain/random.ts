// 确定性随机与值噪声：只依赖整数运算，同 seed 同输入在任何机器/浏览器上结果一致
// 不允许使用 Math.random / Date.now 参与生成

/** 32 位整数 hash，输出 uint32 */
export function hash32(seed: number, x: number, y: number): number {
  let h = (seed | 0) ^ (x | 0) ^ ((y | 0) * 0x9e3779b9);
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** [0,1) 确定性随机 */
export function rand01(seed: number, x: number, y: number): number {
  return hash32(seed, x, y) / 4294967296;
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** 2D 值噪声，输入世界坐标（米）+ 频率格子坐标，输出 [0,1) */
export function valueNoise(seed: number, x: number, y: number, freq: number): number {
  const gx = x * freq;
  const gy = y * freq;
  const x0 = Math.floor(gx);
  const y0 = Math.floor(gy);
  const tx = smooth(gx - x0);
  const ty = smooth(gy - y0);
  const v00 = rand01(seed, x0, y0);
  const v10 = rand01(seed, x0 + 1, y0);
  const v01 = rand01(seed, x0, y0 + 1);
  const v11 = rand01(seed, x0 + 1, y0 + 1);
  return lerp(lerp(v00, v10, tx), lerp(v01, v11, tx), ty);
}

/** 分形值噪声，输出约 [0,1) */
export function fbm(seed: number, x: number, y: number, octaves = 3): number {
  let amp = 0.5;
  let freq = 0.12;
  let sum = 0;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amp * valueNoise(seed + o * 1013, x, y, freq);
    norm += amp;
    amp *= 0.5;
    freq *= 2.1;
  }
  return sum / norm;
}

/** 确定性伪随机数发生器（mulberry32），用于布局等顺序随机场景 */
export function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
