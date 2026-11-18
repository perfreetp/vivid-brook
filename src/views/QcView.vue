<script setup lang="ts">
import { computed, ref } from 'vue';
import { useWorkStore } from '../stores/work';
import { CELL, CHUNKS_PER_SIDE, VERTS } from '../terrain/config';
import { hashChunk } from '../terrain/chunks';
import { heightAt } from '../terrain/height';
import type { FieldOrder, QcResult } from '../types';

const work = useWorkStore();

const activeId = ref<string | null>(null);
const rerunning = ref(false);
const rerunResult = ref<{
  orderId: string;
  expectedHashes: Record<string, string>;
  actualHashes: Record<string, string>;
  mismatchIds: number[];
  matchedChunks: number;
  totalChunks: number;
  submittedChecksum: string;
  rerunChecksum: string;
} | null>(null);
const note = ref('');

const activeOrder = computed<FieldOrder | null>(
  () => work.orders.find((o) => o.id === activeId.value) ?? null,
);

/** 用订单的同一 seed + 同一组参数，在独立缓冲中重跑（不碰编辑器现场） */
function rerun(order: FieldOrder) {
  activeId.value = order.id;
  rerunResult.value = null;
  note.value = '';
  rerunning.value = true;
  // 让出一帧渲染 loading 状态
  setTimeout(() => {
    const t0 = performance.now();
    const h = new Float64Array(VERTS * VERTS);
    // 直接复用确定性高度函数，保证与建模端同一套世界空间计算
    for (let iz = 0; iz < VERTS; iz++) {
      for (let ix = 0; ix < VERTS; ix++) {
        h[iz * VERTS + ix] = heightAt(order.seed, order.params, ix * CELL, iz * CELL);
      }
    }
    const expectedHashes: Record<string, string> = {};
    const actualHashes: Record<string, string> = {};
    const mismatchIds: number[] = [];
    let matched = 0;
    let total = 0;
    const submitted = order.submittedSnapshot!;
    const submittedH = new Float64Array(VERTS * VERTS);
    for (let i = 0; i < submitted.heights.length; i++) submittedH[i] = submitted.heights[i] / 1000;

    for (const c of submitted.chunks) {
      const id = c.id;
      actualHashes[String(id)] = hashChunk(id, h);
      expectedHashes[String(id)] = hashChunk(id, submittedH);
      if (c.locked) continue; // 锁定（手修）区块不参与自动一致性比对
      total++;
      if (actualHashes[String(id)] === expectedHashes[String(id)]) {
        matched++;
      } else {
        mismatchIds.push(id);
      }
    }
    const rerunChecksum = hashString(
      Object.entries(actualHashes).sort().map(([k, v]) => `${k}:${v}`).join('|'),
    );
    rerunResult.value = {
      orderId: order.id,
      expectedHashes,
      actualHashes,
      mismatchIds,
      matchedChunks: matched,
      totalChunks: total,
      submittedChecksum: submitted.checksum,
      rerunChecksum,
    };
    rerunning.value = false;
    console.info(`[QC] 重算 ${VERTS * VERTS} 顶点耗时 ${(performance.now() - t0).toFixed(1)}ms`);
  }, 30);
}

function hashString(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

function decide(pass: boolean) {
  const order = activeOrder.value;
  const r = rerunResult.value;
  if (!order || !r) return;
  const result: QcResult = {
    at: Date.now(),
    user: work.currentUser.name,
    passed: pass,
    matchedChunks: r.matchedChunks,
    totalChunks: r.totalChunks,
    chunkHashes: r.actualHashes,
    expectedHashes: r.expectedHashes,
    detail: note.value || (pass ? '同 seed 重跑全部解锁区块一致' : `区块 ${r.mismatchIds.join(',')} 哈希不一致`),
  };
  work.qcDecide(order.id, result, pass, result.detail);
  if (pass) {
    activeId.value = null;
    rerunResult.value = null;
  }
}

function cellClass(id: number): string {
  if (!rerunResult.value) return '';
  const order = activeOrder.value;
  if (order?.submittedSnapshot?.chunks[id]?.locked) return 'locked';
  if (rerunResult.value.mismatchIds.includes(id)) return 'mismatch';
  return 'match';
}

const passRate = computed(() => {
  if (!rerunResult.value || !rerunResult.value.totalChunks) return 0;
  return Math.round((rerunResult.value.matchedChunks / rerunResult.value.totalChunks) * 100);
});
</script>

<template>
  <div class="view qc-layout">
    <div class="panel" style="margin-bottom: 12px">
      <h3 style="margin: 0">质检队列（拿同一 seed 重跑，逐区块哈希比对）</h3>
    </div>

    <div class="qc-grid">
      <div class="panel scroll-y">
        <table v-if="work.qcQueue.length || work.orders.some((o) => o.status === 'rejected' || o.status === 'passed')">
          <thead>
            <tr><th>单号</th><th>标题</th><th>seed</th><th>状态</th><th>操作</th></tr>
          </thead>
          <tbody>
            <tr
              v-for="o in work.orders.filter((x) => ['qc', 'rejected', 'passed'].includes(x.status))"
              :key="o.id"
              :style="activeId === o.id ? { background: 'rgba(78,161,255,0.12)' } : {}"
            >
              <td class="mono">{{ o.id }}</td>
              <td>{{ o.title }}</td>
              <td class="mono">{{ o.seed }}</td>
              <td :class="`status-${o.status}`">{{ o.status === 'qc' ? '待质检' : o.status === 'rejected' ? '已打回' : '已通过' }}</td>
              <td>
                <button :disabled="!o.submittedSnapshot || o.status === 'passed'" @click="rerun(o)">
                  {{ activeId === o.id && rerunning ? '重跑中…' : '同 seed 重跑' }}
                </button>
              </td>
            </tr>
          </tbody>
        </table>
        <p v-else class="muted" style="padding: 20px; text-align: center">质检队列为空。</p>
      </div>

      <div class="panel scroll-y" v-if="rerunResult && activeOrder">
        <h3>比对结果 · {{ activeOrder.id }}</h3>
        <div class="grid2" style="margin-bottom: 12px">
          <div class="kpi" :class="passRate === 100 ? 'ok' : 'bad'">
            <div class="num">{{ passRate }}%</div>
            <div class="lbl">解锁区块一致率（{{ rerunResult.matchedChunks }}/{{ rerunResult.totalChunks }}）</div>
          </div>
          <div class="kpi">
            <div class="num">{{ rerunResult.mismatchIds.length }}</div>
            <div class="lbl">不一致区块数</div>
          </div>
        </div>
        <p class="muted" style="font-size: 12px">
          提交校验和 <span class="mono">{{ rerunResult.submittedChecksum }}</span><br />
          重跑校验和 <span class="mono">{{ rerunResult.rerunChecksum }}</span><br />
          橙色 = 手动锁定区块（不参与自动比对，需人工确认）；红色 = 哈希不一致
        </p>

        <div class="chunk-grid">
          <div
            v-for="id in CHUNKS_PER_SIDE * CHUNKS_PER_SIDE"
            :key="id - 1"
            class="chunk-cell"
            :class="cellClass(id - 1)"
            :title="`#${id - 1} 提交:${rerunResult.expectedHashes[String(id - 1)]} 重跑:${rerunResult.actualHashes[String(id - 1)]}`"
          ></div>
        </div>

        <div style="margin-top: 12px">
          <label>质检备注（打回原因 / 通过说明）</label>
          <textarea v-model="note" :placeholder="rerunResult.mismatchIds.length ? '例如：坡度带区块哈希与基线不一致，请检查参数后返工' : '同 seed 重跑一致，同意通过'"></textarea>
        </div>
        <div class="row" style="margin-top: 12px; justify-content: flex-end">
          <button
            class="danger"
            :disabled="!rerunResult.mismatchIds.length"
            @click="decide(false)"
          >不一致，打回（返工次数 +1）</button>
          <button
            class="primary"
            :disabled="rerunResult.mismatchIds.length > 0"
            @click="decide(true)"
          >一致，质检通过</button>
        </div>

        <h3 style="margin-top: 18px">流转记录</h3>
        <div class="history">
          <p v-for="(e, i) in activeOrder.history" :key="i" class="muted" style="margin: 4px 0; font-size: 12px">
            <span class="mono">{{ new Date(e.at).toLocaleString() }}</span>
            · {{ e.user }} · <b>{{ e.action }}</b>
            <template v-if="e.detail"> · {{ e.detail }}</template>
          </p>
        </div>
      </div>

      <div class="panel muted" v-else style="display: flex; align-items: center; justify-content: center">
        选择左侧单据点击「同 seed 重跑」，系统会用相同 seed 与参数独立重算并逐区块比对哈希。
      </div>
    </div>
  </div>
</template>

<style scoped>
.qc-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; height: calc(100% - 70px); }
.chunk-grid {
  display: grid;
  grid-template-columns: repeat(16, 1fr);
  gap: 2px;
  background: var(--panel-2);
  padding: 6px;
  border-radius: 6px;
}
.chunk-cell { aspect-ratio: 1; border-radius: 2px; background: #24303e; }
.chunk-cell.match { background: rgba(76, 195, 138, 0.75); }
.chunk-cell.mismatch { background: rgba(239, 95, 107, 0.9); }
.chunk-cell.locked { background: rgba(242, 129, 62, 0.85); }
.kpi.ok .num { color: var(--ok); }
.kpi.bad .num { color: var(--danger); }
.history { max-height: 220px; overflow: auto; }
</style>
