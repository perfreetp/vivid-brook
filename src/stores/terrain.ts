import { defineStore } from 'pinia';
import { computed, ref, shallowRef } from 'vue';
import {
  CELL,
  CHUNK_COUNT,
  CHUNK_CELLS,
  CHUNKS_PER_SIDE,
  SCULPT_RADIUS_CELLS,
  VERTS,
  featureEnabled,
} from '../terrain/config';
import type { FeatureKey } from '../terrain/config';
import { heightAt } from '../terrain/height';
import {
  affectedChunks,
  chunkCoord,
  chunkId,
  hashChunk,
  recomputeAllTags,
  snapshotChecksum,
  vertexIndex,
} from '../terrain/chunks';
import type { ChunkMeta, TerrainParams, TerrainSnapshot } from '../types';

export const DEFAULT_PARAMS: TerrainParams = {
  slopeGrade: 2,
  stepHeight: 0.15,
  gravelDensity: 0.4,
  trenchWidth: 0.8,
  waterDepth: 0.5,
};

export interface RegenStats {
  totalMs: number;
  chunkMs: Record<number, number>;
  blendMs: number;
  recomputed: number;
  skippedLocked: number;
  at: number;
}

const LOCK_BLEND_RADIUS = 2; // 锁定区边界过渡半径（格）

export const useTerrainStore = defineStore('terrain', () => {
  const seed = ref(20260101);
  const params = ref<TerrainParams>({ ...DEFAULT_PARAMS });
  const heights = shallowRef<Float64Array>(new Float64Array(VERTS * VERTS));
  const chunks = ref<ChunkMeta[]>(
    Array.from({ length: CHUNK_COUNT }, (_, id) => ({
      id,
      tags: [],
      locked: false,
      sculpted: false,
      genMs: 0,
    })),
  );
  /** 数据版本号，每次高度变化 +1，驱动渲染器刷新 GPU 缓冲 */
  const version = ref(0);
  const lastStats = ref<RegenStats | null>(null);
  const flattenTarget = ref<number | null>(null);

  const lockedCount = computed(() => chunks.value.filter((c) => c.locked).length);
  const checksum = computed(() => snapshotChecksum(heights.value, chunks.value));

  function chunkAtVertex(ix: number, iz: number): number {
    const cx = Math.min(CHUNKS_PER_SIDE - 1, Math.floor(ix / CHUNK_CELLS));
    const cz = Math.min(CHUNKS_PER_SIDE - 1, Math.floor(iz / CHUNK_CELLS));
    return chunkId(cx, cz);
  }

  function isVertexLocked(ix: number, iz: number): boolean {
    return chunks.value[chunkAtVertex(ix, iz)].locked;
  }

  /** 重算单个区块的全部顶点（含与邻居共享的边界顶点，高度函数世界空间一致，无裂缝） */
  function regenChunk(id: number): number {
    const { cx, cz } = chunkCoord(id);
    const t0 = performance.now();
    const x0 = cx * CHUNK_CELLS;
    const z0 = cz * CHUNK_CELLS;
    const h = heights.value;
    for (let iz = z0; iz <= z0 + CHUNK_CELLS; iz++) {
      for (let ix = x0; ix <= x0 + CHUNK_CELLS; ix++) {
        const wx = ix * CELL;
        const wz = iz * CELL;
        h[vertexIndex(ix, iz)] = heightAt(seed.value, params.value, wx, wz);
      }
    }
    return performance.now() - t0;
  }

  /**
   * 锁定区边界自动过渡：解锁顶点若靠近锁定顶点，按距离指数权重把
   * 新生成高度拉向锁定高度。锁定顶点本身永不写入。
   */
  function blendLocks(region?: Set<number>): number {
    if (!chunks.value.some((c) => c.locked)) return 0;
    const t0 = performance.now();
    const h = heights.value;
    const R = LOCK_BLEND_RADIUS;
    const inRegion = (ix: number, iz: number) =>
      !region || region.has(chunkAtVertex(ix, iz));

    for (let iz = 0; iz < VERTS; iz++) {
      for (let ix = 0; ix < VERTS; ix++) {
        if (isVertexLocked(ix, iz) || !inRegion(ix, iz)) continue;
        let bestD = R + 1;
        let bestH = 0;
        const i0 = Math.max(0, ix - R);
        const i1 = Math.min(VERTS - 1, ix + R);
        const j0 = Math.max(0, iz - R);
        const j1 = Math.min(VERTS - 1, iz + R);
        for (let j = j0; j <= j1; j++) {
          for (let i = i0; i <= i1; i++) {
            if (!isVertexLocked(i, j)) continue;
            const d = Math.hypot(i - ix, j - iz);
            if (d < bestD) {
              bestD = d;
              bestH = h[vertexIndex(i, j)];
            }
          }
        }
        if (bestD <= R) {
          const w = Math.pow(1 - bestD / (R + 1), 2); // 边界处 w=1，平滑接管
          const idx = vertexIndex(ix, iz);
          h[idx] = bestH * w + h[idx] * (1 - w);
        }
      }
    }
    return performance.now() - t0;
  }

  function regenerateAll(): void {
    const t0 = performance.now();
    recomputeAllTags(chunks.value, params.value);
    const chunkMs: Record<number, number> = {};
    let recomputed = 0;
    let skipped = 0;
    for (const c of chunks.value) {
      if (c.locked) {
        skipped++;
        continue;
      }
      const ms = regenChunk(c.id);
      c.genMs = ms;
      chunkMs[c.id] = ms;
      recomputed++;
    }
    const blendMs = blendLocks();
    version.value++;
    lastStats.value = {
      totalMs: performance.now() - t0,
      chunkMs,
      blendMs,
      recomputed,
      skippedLocked: skipped,
      at: Date.now(),
    };
  }

  /** 改单个参数：只重算受影响特征带内的解锁区块 */
  function updateParam(key: keyof TerrainParams, value: number): void {
    params.value = { ...params.value, [key]: value };
    recomputeAllTags(chunks.value, params.value);
    const feature = keyToFeature(key);
    const affected = affectedChunks(feature, params.value);
    const t0 = performance.now();
    const chunkMs: Record<number, number> = {};
    let recomputed = 0;
    let skipped = 0;
    for (const id of affected) {
      const c = chunks.value[id];
      if (c.locked) {
        skipped++;
        continue;
      }
      const ms = regenChunk(id);
      c.genMs = ms;
      chunkMs[id] = ms;
      recomputed++;
    }
    // 过渡区域外扩一圈区块
    const blendRegion = expandRegion(affected, 1);
    const blendMs = blendLocks(blendRegion);
    version.value++;
    lastStats.value = {
      totalMs: performance.now() - t0,
      chunkMs,
      blendMs,
      recomputed,
      skippedLocked: skipped,
      at: Date.now(),
    };
  }

  function expandRegion(region: Set<number>, rings: number): Set<number> {
    const out = new Set(region);
    for (const id of region) {
      const { cx, cz } = chunkCoord(id);
      for (let dz = -rings; dz <= rings; dz++) {
        for (let dx = -rings; dx <= rings; dx++) {
          const nx = cx + dx;
          const nz = cz + dz;
          if (nx < 0 || nz < 0 || nx >= CHUNKS_PER_SIDE || nz >= CHUNKS_PER_SIDE) continue;
          out.add(chunkId(nx, nz));
        }
      }
    }
    return out;
  }

  function keyToFeature(key: keyof TerrainParams): FeatureKey {
    const map: Record<keyof TerrainParams, FeatureKey> = {
      slopeGrade: 'slope',
      stepHeight: 'step',
      gravelDensity: 'gravel',
      trenchWidth: 'trench',
      waterDepth: 'water',
    };
    return map[key];
  }

  function setSeed(newSeed: number): void {
    seed.value = newSeed;
    regenerateAll();
  }

  // ---------- 拖框锁定 / 解锁 ----------
  function setLocksInRect(cellX0: number, cellZ0: number, cellX1: number, cellZ1: number, lock: boolean): number {
    const x0 = Math.max(0, Math.min(cellX0, cellX1));
    const x1 = Math.min(GRID_MAX, Math.max(cellX0, cellX1));
    const z0 = Math.max(0, Math.min(cellZ0, cellZ1));
    const z1 = Math.min(GRID_MAX, Math.max(cellZ0, cellZ1));
    const touched = new Set<number>();
    for (let cz = z0; cz <= z1; cz++) {
      for (let cx = x0; cx <= x1; cx++) {
        touched.add(chunkId(cx, cz));
      }
    }
    for (const id of touched) chunks.value[id].locked = lock;
    version.value++;
    return touched.size;
  }

  function toggleChunkLock(id: number): void {
    chunks.value[id].locked = !chunks.value[id].locked;
    version.value++;
  }

  // ---------- 手动塑形（自动锁定受影响区块） ----------
  function beginSculpt(cellX: number, cellZ: number): void {
    const ix = Math.max(0, Math.min(VERTS - 1, cellX));
    const iz = Math.max(0, Math.min(VERTS - 1, cellZ));
    flattenTarget.value = heights.value[vertexIndex(ix, iz)];
  }

  function sculptAt(mode: 'raise' | 'flatten' | 'trench', cellX: number, cellZ: number): void {
    const h = heights.value;
    const R = SCULPT_RADIUS_CELLS;
    const i0 = Math.max(0, cellX - R);
    const i1 = Math.min(VERTS - 1, cellX + R);
    const j0 = Math.max(0, cellZ - R);
    const j1 = Math.min(VERTS - 1, cellZ + R);
    const touched = new Set<number>();
    for (let iz = j0; iz <= j1; iz++) {
      for (let ix = i0; ix <= i1; ix++) {
        const d = Math.hypot(ix - cellX, iz - cellZ) / R;
        if (d >= 1) continue;
        const falloff = 0.5 + 0.5 * Math.cos(d * Math.PI);
        const idx = vertexIndex(ix, iz);
        if (mode === 'raise') {
          h[idx] += 0.12 * falloff;
        } else if (mode === 'trench') {
          h[idx] -= 0.18 * falloff;
        } else {
          const target = flattenTarget.value ?? h[idx];
          h[idx] += (target - h[idx]) * 0.35 * falloff;
        }
        touched.add(chunkAtVertex(ix, iz));
      }
    }
    for (const id of touched) {
      const c = chunks.value[id];
      c.locked = true;
      c.sculpted = true;
    }
    version.value++;
  }

  function endSculpt(): void {
    flattenTarget.value = null;
  }

  /** 解锁并丢弃手动修改，恢复过程式结果 */
  function resetChunk(id: number): void {
    const c = chunks.value[id];
    c.locked = false;
    c.sculpted = false;
    const ms = regenChunk(id);
    c.genMs = ms;
    blendLocks(expandRegion(new Set([id]), 1));
    version.value++;
  }

  // ---------- 快照（质检 / 单据持久化） ----------
  function toSnapshot(): TerrainSnapshot {
    const q: number[] = new Array(heights.value.length);
    for (let i = 0; i < q.length; i++) q[i] = Math.round(heights.value[i] * 1000);
    return {
      heights: q,
      locked: chunks.value.map((c) => c.locked),
      chunks: JSON.parse(JSON.stringify(chunks.value)) as ChunkMeta[],
      checksum: checksum.value,
    };
  }

  function loadSnapshot(snap: TerrainSnapshot): void {
    const h = new Float64Array(VERTS * VERTS);
    for (let i = 0; i < snap.heights.length; i++) h[i] = snap.heights[i] / 1000;
    heights.value = h;
    chunks.value = snap.chunks.map((c) => ({ ...c }));
    version.value++;
  }

  function chunkHash(id: number): string {
    return hashChunk(id, heights.value);
  }

  function allChunkHashes(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const c of chunks.value) out[String(c.id)] = hashChunk(c.id, heights.value);
    return out;
  }

  /** 初始化一片新场地 */
  function init(newSeed: number, newParams: TerrainParams): void {
    seed.value = newSeed;
    params.value = { ...newParams };
    heights.value = new Float64Array(VERTS * VERTS);
    chunks.value = Array.from({ length: CHUNK_COUNT }, (_, id) => ({
      id,
      tags: [],
      locked: false,
      sculpted: false,
      genMs: 0,
    }));
    regenerateAll();
  }

  return {
    seed,
    params,
    heights,
    chunks,
    version,
    lastStats,
    lockedCount,
    checksum,
    regenerateAll,
    updateParam,
    setSeed,
    setLocksInRect,
    toggleChunkLock,
    beginSculpt,
    sculptAt,
    endSculpt,
    resetChunk,
    toSnapshot,
    loadSnapshot,
    chunkHash,
    allChunkHashes,
    init,
  };
});

const GRID_MAX = CHUNKS_PER_SIDE - 1;

export function isFeatureActive(key: FeatureKey, p: TerrainParams): boolean {
  return featureEnabled(key, p);
}
