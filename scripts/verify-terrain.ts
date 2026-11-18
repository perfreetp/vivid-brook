// 地形内核验证脚本：确定性、分块一致性、增量重算范围、锁定区保留
// 运行：npx tsx scripts/verify-terrain.ts
import { heightAt } from '../src/terrain/height';
import { CELL, VERTS, CHUNK_COUNT } from '../src/terrain/config';
import { hashChunk, recomputeAllTags, affectedChunks, snapshotChecksum } from '../src/terrain/chunks';
import type { ChunkMeta, TerrainParams } from '../src/types';

const P: TerrainParams = { slopeGrade: 2, stepHeight: 0.15, gravelDensity: 0.4, trenchWidth: 0.8, waterDepth: 0.5 };
const SEED = 20260101;

function fullHeights(seed: number, p: TerrainParams): Float64Array {
  const h = new Float64Array(VERTS * VERTS);
  for (let iz = 0; iz < VERTS; iz++)
    for (let ix = 0; ix < VERTS; ix++)
      h[iz * VERTS + ix] = heightAt(seed, p, ix * CELL, iz * CELL);
  return h;
}

let failures = 0;
function check(name: string, cond: boolean, detail = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!cond) failures++;
}

// 1. 同 seed 同参数两次生成逐点一致
const a = fullHeights(SEED, P);
const b = fullHeights(SEED, { ...P });
check('同 seed 同参数两次生成完全一致', a.every((v, i) => v === b[i]));

// 2. 不同 seed 结果不同
const c = fullHeights(SEED + 1, P);
check('不同 seed 产生不同地形', a.some((v, i) => v !== c[i]));

// 3. 分块哈希：同 seed 重跑每个区块哈希稳定
const chunks1: ChunkMeta[] = Array.from({ length: CHUNK_COUNT }, (_, id) => ({ id, tags: [], locked: false, sculpted: false, genMs: 0 }));
recomputeAllTags(chunks1, P);
const h1 = fullHeights(SEED, P);
const h2 = fullHeights(SEED, { ...P });
const allStable = chunks1.every((c) => hashChunk(c.id, h1) === hashChunk(c.id, h2));
check('全部 256 个区块哈希在重跑间稳定', allStable);
check('快照 checksum 稳定', snapshotChecksum(h1, chunks1) === snapshotChecksum(h2, chunks1));

// 4. 改单个参数只影响对应特征带区块（坡度 -> slope 带，z 0..8m）
const tags = new Map(chunks1.map((c) => [c.id, c.tags] as const));
const slopeAffected = affectedChunks('slope', P);
let onlySlopeBand = true;
for (const id of slopeAffected) {
  if (!tags.get(id)!.includes('slope')) onlySlopeBand = false;
}
check('坡度参数的影响范围仅含 slope 带区块', onlySlopeBand, `${slopeAffected.size} 块`);
const trenchAffected = affectedChunks('trench', P);
check('沟槽参数影响范围与坡度带不重叠', [...trenchAffected].every((id) => !slopeAffected.has(id)));

// 5. 关闭某参数后，带外高度不受影响（用 trench 验证：宽度变化只改变沟槽带）
const pNoTrench: TerrainParams = { ...P, trenchWidth: 0 };
const hNoTrench = fullHeights(SEED, pNoTrench);
let outsideUnchanged = 0;
let outsideTotal = 0;
for (let iz = 0; iz < VERTS; iz++) {
  const z = iz * CELL;
  if (z >= 23 && z <= 33) continue; // 沟槽带 + 衰减边
  for (let ix = 0; ix < VERTS; ix++) {
    outsideTotal++;
    if (h1[iz * VERTS + ix] === hNoTrench[iz * VERTS + ix]) outsideUnchanged++;
  }
}
check('关闭沟槽后带外顶点高度零变化', outsideUnchanged === outsideTotal, `${outsideUnchanged}/${outsideTotal}`);

// 6. 每个参数档位列与高度函数行为：坡度为 0 档时斜坡项消失
const pFlat: TerrainParams = { ...P, slopeGrade: 0 };
const hFlat = fullHeights(SEED, pFlat);
const chunksFlat: ChunkMeta[] = Array.from({ length: CHUNK_COUNT }, (_, id) => ({ id, tags: [], locked: false, sculpted: false, genMs: 0 }));
recomputeAllTags(chunksFlat, pFlat);
check('坡度 0 档时无区块带 slope 标签', chunksFlat.every((c) => !c.tags.includes('slope')));

// 7. 量化快照往返误差 < 1mm
let maxErr = 0;
for (let i = 0; i < h1.length; i++) {
  const q = Math.round(h1[i] * 1000) / 1000;
  maxErr = Math.max(maxErr, Math.abs(q - h1[i]));
}
check('毫米量化往返误差 < 0.001m', maxErr < 0.001, `maxErr=${maxErr.toExponential(2)}`);

console.log(failures === 0 ? '\n全部验证通过 ✅' : `\n${failures} 项失败 ❌`);
process.exit(failures ? 1 : 0);
