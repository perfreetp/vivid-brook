// 区块标签、哈希与测量：均为确定性纯函数
import { BANDS, CELL, CHUNKS_PER_SIDE, CHUNK_CELLS, CHUNK_SIZE, FEATURE_KEYS, VERTS, featureEnabled } from './config';
import type { ChunkMeta, TerrainParams } from '../types';
import type { FeatureKey } from './config';
import { hash32 } from './random';

export function chunkId(cx: number, cz: number): number {
  return cz * CHUNKS_PER_SIDE + cx;
}

export function chunkCoord(id: number): { cx: number; cz: number } {
  return { cx: id % CHUNKS_PER_SIDE, cz: Math.floor(id / CHUNKS_PER_SIDE) };
}

/** 计算某区块受哪些启用的特征带影响（按区块覆盖的 z 范围与带求交） */
export function tagsForChunk(cx: number, cz: number, p: TerrainParams): string[] {
  const z0 = cz * CHUNK_SIZE;
  const z1 = z0 + CHUNK_SIZE;
  const tags: string[] = [];
  for (const key of FEATURE_KEYS) {
    if (!featureEnabled(key as FeatureKey, p)) continue;
    const band = BANDS[key];
    // 带的衰减外扩 1m
    if (z1 >= band.z0 - 1 && z0 <= band.z1 + 1) tags.push(key);
  }
  return tags;
}

export function recomputeAllTags(chunks: ChunkMeta[], p: TerrainParams): void {
  chunks.forEach((c) => {
    const { cx, cz } = chunkCoord(c.id);
    c.tags = tagsForChunk(cx, cz, p);
  });
}

/** 改变某个参数后，需要重算的区块 id 集合（含该特征带 + 两侧过渡邻居） */
export function affectedChunks(feature: FeatureKey, p: TerrainParams): Set<number> {
  const set = new Set<number>();
  const band = BANDS[feature];
  const zMin = Math.max(0, band.z0 - 1);
  const zMax = Math.min(40, band.z1 + 1);
  const cz0 = Math.floor(zMin / CHUNK_SIZE);
  const cz1 = Math.min(CHUNKS_PER_SIDE - 1, Math.floor((zMax - 1e-6) / CHUNK_SIZE));
  for (let cz = cz0; cz <= cz1; cz++) {
    for (let cx = 0; cx < CHUNKS_PER_SIDE; cx++) {
      set.add(chunkId(cx, cz));
    }
  }
  return set;
}

export function vertexIndex(ix: number, iz: number): number {
  return iz * VERTS + ix;
}

export function cellCenterWorld(cellX: number, cellZ: number): { x: number; z: number } {
  return { x: (cellX + 0.5) * CELL, z: (cellZ + 0.5) * CELL };
}

/** FNV-1a 哈希（字符串），用于区块/快照校验 */
function fnv1a(data: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < data.length; i++) {
    h ^= data.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/**
 * 区块哈希：取区块覆盖的全部顶点（含与邻居共享的边界行/列）的量化高度。
 * 量化到 1mm，与快照存储口径一致，保证「重跑浮点高度」与「提交快照还原高度」可比；
 * 任何参数/种子造成的地形变化都远大于 1mm，不会漏检。
 */
export function hashChunk(id: number, heights: Float64Array | number[]): string {
  const { cx, cz } = chunkCoord(id);
  const x0 = cx * CHUNK_CELLS;
  const z0 = cz * CHUNK_CELLS;
  const parts: string[] = [];
  for (let iz = z0; iz <= z0 + CHUNK_CELLS; iz++) {
    for (let ix = x0; ix <= x0 + CHUNK_CELLS; ix++) {
      const q = Math.round(heights[vertexIndex(ix, iz)] * 1000);
      parts.push(q.toString(36));
    }
  }
  return fnv1a(parts.join(','));
}

/** 整片场地快照哈希（只统计解锁区块，手动锁定区域不参与自动质检） */
export function snapshotChecksum(heights: Float64Array | number[], chunks: ChunkMeta[]): string {
  const hashes = chunks
    .filter((c) => !c.locked)
    .map((c) => c.id.toString(36) + ':' + hashChunk(c.id, heights))
    .sort()
    .join('|');
  return fnv1a(hashes);
}

/** 实测区块平均坡度（百分比）：用区块中心纵剖面的 dh/dz 均值 */
export function measuredSlope(id: number, heights: Float64Array | number[]): number {
  const { cx, cz } = chunkCoord(id);
  const ix = cx * CHUNK_CELLS + 2;
  const z0 = cz * CHUNK_CELLS;
  let sum = 0;
  let n = 0;
  for (let iz = z0; iz < z0 + CHUNK_CELLS; iz++) {
    const dh = heights[vertexIndex(ix, iz + 1)] - heights[vertexIndex(ix, iz)];
    sum += dh / CELL;
    n++;
  }
  return (sum / n) * 100;
}

/** 实测区块最大相邻高差（用于核对台阶高度） */
export function maxStep(id: number, heights: Float64Array | number[]): number {
  const { cx, cz } = chunkCoord(id);
  const x0 = cx * CHUNK_CELLS;
  const z0 = cz * CHUNK_CELLS;
  let max = 0;
  for (let iz = z0; iz <= z0 + CHUNK_CELLS; iz++) {
    for (let ix = x0; ix < x0 + CHUNK_CELLS; ix++) {
      const dh = Math.abs(heights[vertexIndex(ix + 1, iz)] - heights[vertexIndex(ix, iz)]);
      if (dh > max) max = dh;
    }
  }
  for (let iz = z0; iz < z0 + CHUNK_CELLS; iz++) {
    for (let ix = x0; ix <= x0 + CHUNK_CELLS; ix++) {
      const dh = Math.abs(heights[vertexIndex(ix, iz + 1)] - heights[vertexIndex(ix, iz)]);
      if (dh > max) max = dh;
    }
  }
  return max;
}

export { fnv1a, hash32 };
