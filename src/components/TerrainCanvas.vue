<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';
import { CHUNK_CELLS, CHUNKS_PER_SIDE, FIELD_SIZE, GRID, TRIS_PER_CHUNK } from '../terrain/config';
import { useTerrainStore } from '../stores/terrain';
import { createWebGpuRenderer } from '../render/webgpuRenderer';
import { Canvas2dRenderer } from '../render/canvas2dRenderer';
import type { Renderer, RenderSettings } from '../render/types';
import type { ChunkMeta } from '../types';

export type ToolMode = 'lock' | 'unlock' | 'raise' | 'flatten' | 'trench' | 'select';

const props = defineProps<{
  mode: ToolMode;
  wireframe: boolean;
  showChunkGrid: boolean;
  showWater: boolean;
}>();
const emit = defineEmits<{
  select: [chunk: ChunkMeta | null];
  info: [text: string];
}>();

const canvasEl = ref<HTMLCanvasElement | null>(null);
const renderer = shallowRef<Renderer | null>(null);
const rendererKind = ref<'webgpu' | 'canvas2d'>('webgpu');
const terrain = useTerrainStore();
const selectedId = ref<number | null>(null);
const drag = shallowRef<{ x0: number; z0: number; x1: number; z1: number } | null>(null);
let pointerDown = false;
let sculptStarted = false;

const settings = (): RenderSettings => ({
  wireframe: props.wireframe,
  showChunkGrid: props.showChunkGrid,
  showWater: props.showWater,
});

function worldToChunk(wx: number, wz: number): number {
  const cx = Math.max(0, Math.min(CHUNKS_PER_SIDE - 1, Math.floor(wx / (FIELD_SIZE / CHUNKS_PER_SIDE))));
  const cz = Math.max(0, Math.min(CHUNKS_PER_SIDE - 1, Math.floor(wz / (FIELD_SIZE / CHUNKS_PER_SIDE))));
  return cz * CHUNKS_PER_SIDE + cx;
}

function worldToCell(wx: number, wz: number): { cx: number; cz: number } {
  return {
    cx: Math.max(0, Math.min(GRID, Math.floor(wx / (FIELD_SIZE / GRID)))),
    cz: Math.max(0, Math.min(GRID, Math.floor(wz / (FIELD_SIZE / GRID)))),
  };
}

function syncRenderer() {
  const r = renderer.value;
  if (!r) return;
  const locked = new Uint8Array(terrain.chunks.length);
  terrain.chunks.forEach((c, i) => (locked[i] = c.locked ? 1 : 0));
  const tags = terrain.chunks.map((c) => c.tags);
  r.updateTerrain(terrain.heights, locked, tags);
  r.setWaterDepth(terrain.params.waterDepth);
  r.setSettings(settings());
}

onMounted(async () => {
  const canvas = canvasEl.value!;
  const gpu = await createWebGpuRenderer(canvas);
  if (gpu) {
    renderer.value = gpu;
    rendererKind.value = 'webgpu';
  } else {
    renderer.value = new Canvas2dRenderer(canvas);
    rendererKind.value = 'canvas2d';
  }
  syncRenderer();
});

watch(
  () => terrain.version,
  () => syncRenderer(),
);
watch(
  () => [props.wireframe, props.showChunkGrid, props.showWater],
  () => renderer.value?.setSettings(settings()),
);

function onPointerDown(e: PointerEvent) {
  if (e.button !== 0 || !renderer.value) return;
  pointerDown = true;
  const hit = renderer.value.pick(e.clientX, e.clientY);
  if (!hit) return;
  if (props.mode === 'lock' || props.mode === 'unlock') {
    drag.value = { x0: hit.x, z0: hit.z, x1: hit.x, z1: hit.z };
    renderer.value.setDragRect(drag.value);
  } else if (props.mode === 'raise' || props.mode === 'flatten' || props.mode === 'trench') {
    const cell = worldToCell(hit.x, hit.z);
    terrain.beginSculpt(cell.cx, cell.cz);
    terrain.sculptAt(props.mode, cell.cx, cell.cz);
    sculptStarted = true;
  } else if (props.mode === 'select') {
    const id = worldToChunk(hit.x, hit.z);
    selectedId.value = id;
    renderer.value.setSelection(id);
    emit('select', terrain.chunks[id]);
  }
}

function onPointerMove(e: PointerEvent) {
  const r = renderer.value;
  if (!r) return;
  const hit = r.pick(e.clientX, e.clientY);
  if (!hit) {
    r.setHover(null);
    emit('info', '');
    return;
  }
  const id = worldToChunk(hit.x, hit.z);
  r.setHover(id);
  const c = terrain.chunks[id];
  emit(
    'info',
    `区块 #${id} (${id % CHUNKS_PER_SIDE},${Math.floor(id / CHUNKS_PER_SIDE)}) · ${TRIS_PER_CHUNK} 三角面` +
      (c.locked ? ' · 已锁定' : '') +
      (c.sculpted ? ' · 手修' : ''),
  );

  if (!pointerDown) return;
  if ((props.mode === 'lock' || props.mode === 'unlock') && drag.value) {
    drag.value = { ...drag.value, x1: hit.x, z1: hit.z };
    r.setDragRect(drag.value);
  } else if (sculptStarted && (props.mode === 'raise' || props.mode === 'flatten' || props.mode === 'trench')) {
    const cell = worldToCell(hit.x, hit.z);
    terrain.sculptAt(props.mode, cell.cx, cell.cz);
  }
}

function onPointerUp() {
  if ((props.mode === 'lock' || props.mode === 'unlock') && drag.value) {
    const d = drag.value;
    const a = worldToCell(Math.min(d.x0, d.x1), Math.min(d.z0, d.z1));
    const b = worldToCell(Math.max(d.x0, d.x1), Math.max(d.z0, d.z1));
    // 拖框按区块对齐（cell -> chunk 坐标）
    const ca0 = Math.floor(a.cx / CHUNK_CELLS);
    const cb0 = Math.floor(a.cz / CHUNK_CELLS);
    const ca1 = Math.floor(b.cx / CHUNK_CELLS);
    const cb1 = Math.floor(b.cz / CHUNK_CELLS);
    terrain.setLocksInRect(ca0, cb0, ca1, cb1, props.mode === 'lock');
    drag.value = null;
    renderer.value?.setDragRect(null);
  }
  if (sculptStarted) {
    terrain.endSculpt();
    sculptStarted = false;
  }
  pointerDown = false;
}

onBeforeUnmount(() => {
  renderer.value?.dispose();
});

defineExpose({ rendererKind });
</script>

<template>
  <div class="canvas-wrap">
    <canvas
      ref="canvasEl"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointerleave="onPointerUp"
    ></canvas>
    <div class="canvas-badge">
      <span class="tag" :class="rendererKind === 'webgpu' ? 'water' : 'trench'">
        {{ rendererKind === 'webgpu' ? 'WebGPU 3D' : 'Canvas2D 俯视（降级）' }}
      </span>
      <span class="muted" style="margin-left: 8px">左键操作 · 右键/中键旋转平移 · 滚轮缩放</span>
    </div>
  </div>
</template>

<style scoped>
.canvas-wrap { position: relative; width: 100%; height: 100%; }
canvas { width: 100%; height: 100%; display: block; cursor: crosshair; touch-action: none; }
.canvas-badge {
  position: absolute; left: 10px; top: 10px;
  background: rgba(14, 19, 26, 0.82);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 5px 10px;
  font-size: 12px;
  pointer-events: none;
}
</style>
