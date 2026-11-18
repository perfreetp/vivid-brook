<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useTerrainStore } from '../stores/terrain';
import { useWorkStore } from '../stores/work';
import ParamPanel from '../components/ParamPanel.vue';
import TerrainCanvas from '../components/TerrainCanvas.vue';
import type { ToolMode } from '../components/TerrainCanvas.vue';
import { SLOPE_GRADE_RATIOS, TRIS_PER_CHUNK } from '../terrain/config';
import { maxStep, measuredSlope } from '../terrain/chunks';
import { downloadBlob, exportHeightmapPng8, exportHeightmapRaw, exportObj } from '../terrain/exporter';
import type { ChunkMeta, TerrainParams } from '../types';

const route = useRoute();
const router = useRouter();
const terrain = useTerrainStore();
const work = useWorkStore();

const mode = ref<ToolMode>('select');
const wireframe = ref(false);
const showChunkGrid = ref(true);
const showWater = ref(true);
const selected = ref<ChunkMeta | null>(null);
const hoverInfo = ref('');
const exportMsg = ref('');
const submitMsg = ref('');

const orderId = computed(() => (route.params.orderId as string | undefined) ?? null);
const order = computed(() => work.orders.find((o) => o.id === orderId.value) ?? null);
const editableParams = computed<TerrainParams>(() => terrain.params);

const tools: { key: ToolMode; label: string; hint: string }[] = [
  { key: 'select', label: '选择', hint: '点选区块查看数据' },
  { key: 'lock', label: '拖框锁定', hint: '左键拖框锁定区块' },
  { key: 'unlock', label: '拖框解锁', hint: '左键拖框解锁区块' },
  { key: 'raise', label: '刷高', hint: '按住左键刷高地形' },
  { key: 'flatten', label: '削平', hint: '按住左键向落笔高度削平' },
  { key: 'trench', label: '挖沟', hint: '按住左键下压挖沟' },
];

onMounted(() => {
  if (order.value) {
    terrain.init(order.value.seed, { ...order.value.params });
  } else {
    terrain.init(terrain.seed, terrain.params);
  }
});

function onParamChange(key: keyof TerrainParams, value: number) {
  terrain.updateParam(key, value);
}
function onSeedChange(v: number) {
  terrain.setSeed(v);
}
function reseed() {
  const s = Math.floor(Math.random() * 90000000) + 10000000; // 仅用于生成新种子，不参与地形计算
  terrain.setSeed(s);
}
function regenerate() {
  terrain.regenerateAll();
}

const selectedStats = computed(() => {
  if (selected.value === null) return null;
  const id = selected.value.id;
  return {
    slopePct: measuredSlope(id, terrain.heights),
    maxStep: maxStep(id, terrain.heights),
    genMs: terrain.chunks[id].genMs,
  };
});

function onSelect(c: ChunkMeta | null) {
  selected.value = c;
}
function resetSelected() {
  if (selected.value === null) return;
  terrain.resetChunk(selected.value.id);
  selected.value = { ...terrain.chunks[selected.value.id] };
}
function toggleSelectedLock() {
  if (selected.value === null) return;
  terrain.toggleChunkLock(selected.value.id);
  selected.value = { ...terrain.chunks[selected.value.id] };
}

function doExport(kind: 'raw' | 'png' | 'obj') {
  const base = `terrain_seed${terrain.seed}`;
  if (kind === 'raw') {
    const { raw, meta } = exportHeightmapRaw(terrain.heights);
    downloadBlob(raw, `${base}_h16.raw`);
    downloadBlob(meta, `${base}_h16.meta.json`);
    exportMsg.value = '已导出 16bit 高度图 raw + 元数据 json';
  } else if (kind === 'png') {
    downloadBlob(exportHeightmapPng8(terrain.heights), `${base}_preview.png`);
    exportMsg.value = '已导出 8bit 灰度预览 PNG';
  } else {
    downloadBlob(exportObj(terrain.heights), `${base}.obj`);
    exportMsg.value = '已导出 OBJ 三角网格';
  }
  setTimeout(() => (exportMsg.value = ''), 4000);
}

const canSubmit = computed(() => {
  if (!order.value) return false;
  const o = order.value;
  return (
    work.currentUser.role === 'modeler' &&
    o.assignee === work.currentUser.name &&
    (o.status === 'modeling' || o.status === 'rejected')
  );
});

function submit() {
  if (!order.value) return;
  const snap = terrain.toSnapshot();
  if (order.value.status === 'rejected') {
    work.resubmit(order.value.id, snap);
  } else {
    work.submitForQc(order.value.id, snap);
  }
  submitMsg.value = `已提交质检，快照校验和 ${snap.checksum}（${terrain.lockedCount} 个锁定区块不参与自动比对）`;
  setTimeout(() => (submitMsg.value = ''), 6000);
}

const totalTris = computed(() => 64 * 64 * 2);
</script>

<template>
  <div class="editor-layout">
    <!-- 左：参数 + 工具 + 导出 -->
    <aside class="panel left scroll-y">
      <h3>过程式参数</h3>
      <ParamPanel
        :model-value="editableParams"
        :seed="terrain.seed"
        @change="onParamChange"
        @update:seed="onSeedChange"
        @reseed="reseed"
        @regenerate="regenerate"
      />

      <h3 style="margin-top: 18px">编辑工具</h3>
      <div class="toolbar">
        <button
          v-for="t in tools"
          :key="t.key"
          :class="{ primary: mode === t.key }"
          :title="t.hint"
          @click="mode = t.key"
        >{{ t.label }}</button>
      </div>
      <p class="muted" style="margin: 8px 0 0; font-size: 12px">
        手修区域自动锁定；重新生成时锁定区保留，边界按距离权重自动过渡。
      </p>

      <h3 style="margin-top: 18px">显示</h3>
      <div class="toolbar">
        <button :class="{ primary: wireframe }" @click="wireframe = !wireframe">
          {{ wireframe ? '✓ ' : '' }}线框模式
        </button>
        <button :class="{ primary: showChunkGrid }" @click="showChunkGrid = !showChunkGrid">区块格网</button>
        <button :class="{ primary: showWater }" @click="showWater = !showWater">水面</button>
      </div>

      <h3 style="margin-top: 18px">导出（仿真用）</h3>
      <div class="toolbar">
        <button @click="doExport('raw')">高度图 RAW 16bit</button>
        <button @click="doExport('png')">预览 PNG</button>
        <button class="primary" @click="doExport('obj')">OBJ 网格</button>
      </div>
      <p v-if="exportMsg" class="muted" style="margin-top: 8px; color: var(--accent-2)">{{ exportMsg }}</p>

      <template v-if="order">
        <h3 style="margin-top: 18px">关联需求单</h3>
        <p style="margin: 4px 0">
          <span class="mono">{{ order.id }}</span> · {{ order.title }}
        </p>
        <p class="muted" style="margin: 4px 0">状态：<span :class="`status-${order.status}`">{{ order.status }}</span></p>
        <button v-if="canSubmit" class="primary" style="width: 100%; margin-top: 8px" @click="submit">
          {{ order.status === 'rejected' ? '返工后重新提交质检' : '完成建模，提交质检' }}
        </button>
        <p v-if="submitMsg" class="muted" style="color: var(--accent-2); margin-top: 8px">{{ submitMsg }}</p>
        <p v-else-if="!canSubmit" class="muted" style="font-size: 12px">
          仅被派单的建模员在建模/打回状态可提交
        </p>
      </template>
      <div v-else class="panel" style="margin-top: 18px; background: var(--panel-2)">
        <h3>自由草稿模式</h3>
        <p class="muted" style="margin: 0">未关联需求单，可自由生成并导出。正式流程请先在「需求单」建单派单。</p>
        <button style="margin-top: 8px" @click="router.push('/orders')">去建单</button>
      </div>
    </aside>

    <!-- 中：画布 + 状态栏 -->
    <main class="center">
      <TerrainCanvas
        :mode="mode"
        :wireframe="wireframe"
        :show-chunk-grid="showChunkGrid"
        :show-water="showWater"
        @select="onSelect"
        @info="(t: string) => (hoverInfo = t)"
      />
      <div class="status-bar">
        <span>{{ hoverInfo || '将鼠标移入画布查看区块信息' }}</span>
        <span class="muted">
          全场 {{ totalTris.toLocaleString() }} 三角面 · 锁定 {{ terrain.lockedCount }}/256 块
          · checksum <span class="mono">{{ terrain.checksum }}</span>
        </span>
      </div>
    </main>

    <!-- 右：区块检查器 + 生成统计 -->
    <aside class="panel right scroll-y">
      <h3>区块检查器</h3>
      <template v-if="selected !== null && selectedStats">
        <p style="margin: 4px 0">区块 ID：<span class="mono">#{{ selected.id }}</span></p>
        <div class="grid2">
          <div class="kpi"><div class="num">{{ TRIS_PER_CHUNK }}</div><div class="lbl">三角面数</div></div>
          <div class="kpi"><div class="num">{{ selectedStats.genMs.toFixed(2) }}<small>ms</small></div><div class="lbl">生成耗时</div></div>
          <div class="kpi"><div class="num">{{ selectedStats.slopePct.toFixed(1) }}%</div><div class="lbl">实测纵坡</div></div>
          <div class="kpi"><div class="num">{{ (selectedStats.maxStep * 100).toFixed(0) }}<small>cm</small></div><div class="lbl">最大相邻高差</div></div>
        </div>
        <p style="margin-top: 10px" class="muted">
          目标坡度：{{ (SLOPE_GRADE_RATIOS[terrain.params.slopeGrade] * 100).toFixed(0) }}% ·
          目标台高：{{ (terrain.params.stepHeight * 100).toFixed(0) }}cm
        </p>
        <p style="margin: 6px 0">
          特征标签：
          <span v-if="!selected.tags.length" class="muted">基础起伏</span>
          <span v-for="t in selected.tags" :key="t" class="tag" :class="t" style="margin-right: 4px">{{ t }}</span>
        </p>
        <p style="margin: 6px 0">
          状态：
          <span :style="{ color: selected.locked ? 'var(--warn)' : 'var(--ok)' }">
            {{ selected.locked ? '已锁定（重算跳过）' : '未锁定' }}
          </span>
          <span v-if="selected.sculpted" class="tag" style="margin-left: 6px">手修</span>
        </p>
        <div class="toolbar" style="margin-top: 10px">
          <button @click="toggleSelectedLock">{{ selected.locked ? '解锁' : '锁定' }}</button>
          <button class="warn" :disabled="!selected.sculpted" @click="resetSelected">丢弃手修并恢复</button>
        </div>
      </template>
      <p v-else class="muted">选择「选择」工具后点选任意区块查看三角面数、耗时与实测坡度/台高。</p>

      <h3 style="margin-top: 18px">最近一次生成统计</h3>
      <template v-if="terrain.lastStats">
        <div class="grid2">
          <div class="kpi"><div class="num">{{ terrain.lastStats.totalMs.toFixed(1) }}<small>ms</small></div><div class="lbl">总耗时</div></div>
          <div class="kpi"><div class="num">{{ terrain.lastStats.recomputed }}</div><div class="lbl">重算区块</div></div>
          <div class="kpi"><div class="num">{{ terrain.lastStats.skippedLocked }}</div><div class="lbl">跳过锁定块</div></div>
          <div class="kpi"><div class="num">{{ terrain.lastStats.blendMs.toFixed(1) }}<small>ms</small></div><div class="lbl">边界过渡</div></div>
        </div>
      </template>
      <p v-else class="muted">暂无统计</p>

      <h3 style="margin-top: 18px">种子与参数（质检基线）</h3>
      <p class="mono muted" style="font-size: 12px; word-break: break-all">
        seed={{ terrain.seed }}<br />
        {{ JSON.stringify(terrain.params) }}
      </p>
    </aside>
  </div>
</template>

<style scoped>
.editor-layout {
  display: grid;
  grid-template-columns: 300px 1fr 320px;
  gap: 12px;
  height: 100%;
  padding: 12px;
}
.left, .right { height: 100%; }
.center {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
}
.status-bar {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 8px 12px;
  font-size: 12px;
}
.kpi small { font-size: 12px; color: var(--muted); }
</style>
