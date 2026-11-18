<template>
  <div class="canvas-toolbar">
    <button :class="{ active: tool === 'select' }" @click="setTool('select')" title="选择/拖动 (V)">🖱 选择</button>
    <button :class="{ active: tool === 'pen' }" @click="setTool('pen')" title="贝塞尔钢笔 (P)">✒️ 钢笔</button>
    <button :class="{ active: tool === 'nodeAdd' }" @click="setTool('nodeAdd')" title="在边上加节点 (A)">➕ 加节点</button>
    <span style="width: 1px; height: 20px; background: var(--border)"></span>
    <button :disabled="!selectedPath" @click="breakSelected" title="断开选中节点/路径 (K)">✂️ 断开节点</button>
    <button :disabled="!selectedPath || selectedPath.closed" @click="closeSelected" title="闭合路径 (J)">🔗 闭合路径</button>
    <button :disabled="!selectedPath" @click="deleteSelected" class="danger" title="删除 (Del)">🗑 删除</button>
    <span style="width: 1px; height: 20px; background: var(--border)"></span>
    <div class="boolean-order">
      布尔运算（Shift+点选两条闭合路径）：
      <template v-if="state.booleanIds.length">
        <span class="badge warn">{{ state.booleanIds.length }}/2</span>
      </template>
      <span v-else class="badge pending">未选择</span>
    </div>
    <button :disabled="state.booleanIds.length !== 2" @click="runBoolean('unite')">∪ 并集</button>
    <button :disabled="state.booleanIds.length !== 2" @click="runBoolean('subtract')">− 差集</button>
    <button :disabled="state.booleanIds.length !== 2" @click="runBoolean('intersect')">∩ 交集</button>
    <span style="width: 1px; height: 20px; background: var(--border)"></span>
    <button :disabled="!selectedPath" @click="ringSelected" title="沿环向复刻三份">🔁 环向阵列×3</button>
    <span style="flex: 1"></span>
    <button @click="zoomOut">−</button>
    <span class="hint">{{ Math.round(state.zoom * 100) }}%</span>
    <button @click="zoomIn">＋</button>
    <button @click="resetZoom">适应</button>
  </div>

  <div class="canvas-wrap" ref="wrapRef">
    <svg
      ref="svgRef"
      class="svg-stage"
      :width="Wmm * scale"
      :height="Lmm * scale"
      :viewBox="`0 0 ${Wmm} ${Lmm}`"
      @mousemove="onMouseMove"
      @mouseleave="onMouseLeave"
      @click="onCanvasClick"
      @dblclick="onCanvasDblClick"
    >
      <!-- 背景 -->
      <rect x="0" y="0" :width="Wmm" :height="Lmm" fill="#fbfcfe" />

      <!-- 轴向网格（平行于笔杆轴向的横线） -->
      <g v-if="state.doc.grid.showAxialGrid" class="grid-axial">
        <line
          v-for="y in axialYs"
          :key="'ax' + y"
          :x1="0" :y1="y" :x2="Wmm" :y2="y"
          stroke="#e2e8f0" stroke-width="0.08"
        />
      </g>

      <!-- 环向等分参考线（按周长/等分数） -->
      <g v-if="state.doc.grid.showDivisionLines" class="grid-divisions">
        <line
          v-for="x in divisionXs"
          :key="'dv' + x.x"
          :x1="x.x" :y1="0" :x2="x.x" :y2="Lmm"
          :stroke="x.seam ? '#94a3b8' : '#cbd5e1'"
          :stroke-width="x.seam ? 0.18 : 0.1"
          :stroke-dasharray="x.seam ? '1.2,0.8' : ''"
        />
        <text
          v-for="x in divisionXs"
          :key="'lb' + x.x"
          :x="x.x + 0.4" :y="3"
          font-size="1.6" fill="#94a3b8"
        >{{ x.label }}</text>
      </g>

      <!-- 中心线（轴向中线 + 环向中线） -->
      <g v-if="state.doc.grid.showCenterLine" class="center-line">
        <line :x1="0" :y1="Lmm / 2" :x2="Wmm" :y2="Lmm / 2" stroke="#f59e0b" stroke-width="0.12" stroke-dasharray="2,1.2" />
        <line :x1="Wmm / 2" :y1="0" :x2="Wmm / 2" :y2="Lmm" stroke="#f59e0b" stroke-width="0.12" stroke-dasharray="2,1.2" />
        <text :x="Wmm / 2 + 0.5" :y="Lmm / 2 - 1" font-size="1.6" fill="#d97706">中心线</text>
      </g>

      <!-- 图层与路径 -->
      <g v-for="layer in state.doc.layers" :key="layer.id" :id="`layer-${layer.id}`">
        <g v-if="layer.visible">
          <path
            v-for="p in layer.paths"
            :key="p.id"
            :d="toD(p)"
            :fill="p.visible === false ? 'none' : p.fill"
            :stroke="gapSet.has(p.id) ? '#dc2626' : p.stroke"
            :stroke-width="p.strokeWidth"
            :stroke-dasharray="p.visible === false ? '1,0.8' : ''"
            :opacity="p.visible === false ? 0.5 : 1"
            class="shape-path"
            :class="{ selected: state.selection.pathId === p.id, 'bool-marked': state.booleanIds.includes(p.id) }"
            @click.stop="onPathClick($event, p)"
            v-drag="pathDragHandlers(p)"
          />
        </g>
      </g>

      <!-- 窄缝自动标红标记 -->
      <g class="narrow-gap-layer">
        <g v-for="(g, i) in gapReport.markers" :key="'gap' + i">
          <circle :cx="g.x" :cy="g.y" r="0.9" fill="none" stroke="#dc2626" stroke-width="0.14" />
          <line :x1="g.x - 1.4" :y1="g.y" :x2="g.x + 1.4" :y2="g.y" stroke="#dc2626" stroke-width="0.12" />
          <line :x1="g.x" :y1="g.y - 1.4" :x2="g.x" :y2="g.y + 1.4" stroke="#dc2626" stroke-width="0.12" />
          <text :x="g.x + 1.2" :y="g.y - 1.2" font-size="1.7" fill="#dc2626" font-weight="700">{{ g.distance }}mm</text>
        </g>
      </g>

      <!-- 节点与手柄 -->
      <g v-if="selectedPath && selectedPath.nodes.length" class="nodes-layer">
        <template v-for="(n, i) in selectedPath.nodes" :key="n.id">
          <!-- 手柄连线 -->
          <line
            v-if="n.hout"
            :x1="n.x" :y1="n.y" :x2="n.x + n.hout.dx" :y2="n.y + n.hout.dy"
            stroke="#0ea5e9" stroke-width="0.09"
          />
          <line
            v-if="n.hin"
            :x1="n.x" :y1="n.y" :x2="n.x + n.hin.dx" :y2="n.y + n.hin.dy"
            stroke="#0ea5e9" stroke-width="0.09"
          />
          <!-- 手柄控制点 -->
          <circle
            v-if="n.hout"
            :cx="n.x + n.hout.dx" :cy="n.y + n.hout.dy" r="0.55"
            fill="#fff" stroke="#0284c7" stroke-width="0.12"
            v-drag="handleDragHandlers(selectedPath, i, 'hout')"
          />
          <circle
            v-if="n.hin"
            :cx="n.x + n.hin.dx" :cy="n.y + n.hin.dy" r="0.55"
            fill="#fff" stroke="#0284c7" stroke-width="0.12"
            v-drag="handleDragHandlers(selectedPath, i, 'hin')"
          />
          <!-- 节点本体 -->
          <rect
            :x="n.x - 0.7" :y="n.y - 0.7" width="1.4" height="1.4"
            :fill="state.selection.nodeIndex === i ? '#f59e0b' : '#fff'"
            :stroke="selectedPath.closed ? '#1d4ed8' : '#7c3aed'"
            stroke-width="0.18"
            class="node-box"
            @click.stop="onNodeClick($event, selectedPath, i)"
            @dblclick.stop="onNodeDblClick(selectedPath, i)"
            v-drag="nodeDragHandlers(selectedPath, i)"
          />
        </template>
      </g>

      <!-- 钢笔预览 -->
      <g v-if="tool === 'pen' && penPreview" class="pen-preview">
        <line
          v-if="penLastNode"
          :x1="penLastNode.x" :y1="penLastNode.y"
          :x2="penPreview.x" :y2="penPreview.y"
          stroke="#7c3aed" stroke-width="0.12" stroke-dasharray="0.8,0.6"
        />
        <circle :cx="penPreview.x" :cy="penPreview.y" r="0.7" fill="rgba(124,58,237,0.25)" stroke="#7c3aed" stroke-width="0.14" />
      </g>

      <!-- 吸附指示 -->
      <g v-if="state.snapIndicator" class="snap-indicator">
        <circle
          :cx="state.snapIndicator.x" :cy="state.snapIndicator.y"
          r="1.3" fill="none" stroke="#16a34a" stroke-width="0.18"
        />
        <text :x="state.snapIndicator.x + 1.6" :y="state.snapIndicator.y - 1.6" font-size="1.5" fill="#16a34a">
          吸附:{{ snapKindText(state.snapIndicator.kind) }}
        </text>
      </g>

      <!-- 边框（拼缝） -->
      <rect x="0" y="0" :width="Wmm" :height="Lmm" fill="none" stroke="#64748b" stroke-width="0.2" />
    </svg>
  </div>

  <div class="canvas-toolbar" style="border-bottom: none; border-top: 1px solid var(--border)">
    <span class="hint">
      画布：笔杆圆周展开图，直径 <b>{{ state.doc.shaft.diameterMm }}mm</b> → 周长
      <b>{{ Wmm.toFixed(2) }}mm</b>，雕刻段长 {{ Lmm }}mm，环向 {{ state.doc.grid.divisions }} 等分
      ｜ 拖动节点自动吸附（网格/中心线/端点，阈值 {{ state.doc.grid.snapThresholdMm }}mm）
      ｜ <span class="kbd">Ctrl+Z</span> 撤销 <span class="kbd">Ctrl+Y</span> 重做
      ｜ 窄缝阈值 <b :style="{ color: gapReport.markers.length ? '#dc2626' : 'inherit' }">{{ state.doc.narrowGapThresholdMm }}mm</b>
      <template v-if="gapReport.markers.length">
        ｜ <span style="color: #dc2626; font-weight: 700">⚠ {{ gapReport.markers.length }} 处窄缝激光雕不出，已标红</span>
      </template>
    </span>
  </div>
</template>

<script setup>
import { computed, ref, onMounted, onBeforeUnmount } from 'vue'
import { select as d3select } from 'd3-selection'
import { drag as d3drag } from 'd3-drag'
import {
  useEditor,
  narrowGapReport
} from '../editor/store.js'
import { nodesToD, canvasWidthMm } from '../editor/model.js'

const {
  state,
  setTool,
  selectPath,
  selectNode,
  clearSelection,
  toggleBooleanPath,
  applySnap,
  clearSnapIndicator,
  penStart,
  penAddNode,
  penFinish,
  dragNodeTo,
  dragPathTo,
  dragHandleTo,
  addNodeOnEdge,
  breakNode,
  closePath,
  deleteSelected,
  toggleSmoothNode,
  runBoolean,
  ringArray,
  undo,
  redo,
  beginCoalesce,
  endCoalesce
} = useEditor()

const svgRef = ref(null)
const wrapRef = ref(null)
const penPreview = ref(null)
const movedRef = ref(false)
const penClickTimer = ref(null)

const BASE_SCALE = 3.2 // px per mm
const scale = computed(() => BASE_SCALE * state.zoom)
const Wmm = computed(() => canvasWidthMm(state.doc))
const Lmm = computed(() => state.doc.shaft.lengthMm)
const selectedPath = computed(() => {
  if (!state.selection.pathId) return null
  for (const layer of state.doc.layers) {
    const p = layer.paths.find((x) => x.id === state.selection.pathId)
    if (p) return p
  }
  return null
})

const divisionXs = computed(() => {
  const W = Wmm.value
  const div = state.doc.grid.divisions
  const arr = []
  for (let i = 0; i <= div; i++) {
    const x = (W * i) / div
    arr.push({ x, seam: i === 0 || i === div, label: `${i}/${div}` })
  }
  return arr
})
const axialYs = computed(() => {
  const step = state.doc.grid.axialStepMm
  const arr = []
  for (let y = step; y < Lmm.value - 0.01; y += step) arr.push(+y.toFixed(2))
  return arr
})

const gapReport = computed(() => narrowGapReport.value)
const gapSet = computed(() => new Set(Object.keys(gapReport.value.perPath)))

function toD(p) {
  return nodesToD(p)
}
function snapKindText(k) {
  return { grid: '网格', center: '中心线', endpoint: '端点', seam: '拼缝' }[k] || k
}

// ---------- 坐标换算 ----------
function toMm(event) {
  const svg = svgRef.value
  const pt = svg.createSVGPoint()
  pt.x = event.clientX
  pt.y = event.clientY
  const ctm = svg.getScreenCTM()
  const loc = pt.matrixTransform(ctm.inverse())
  return { x: loc.x, y: loc.y }
}

// ---------- d3-drag 指令 ----------
const vDrag = {
  mounted(el, binding) {
    el._dragHandlers = binding.value
    const behavior = d3drag()
      .on('start', function (event) {
        movedRef.value = false
        el._dragHandlers?.start?.(event.sourceEvent, this)
      })
      .on('drag', function (event) {
        movedRef.value = true
        el._dragHandlers?.drag?.(event.sourceEvent, this, event)
      })
      .on('end', function (event) {
        el._dragHandlers?.end?.(event.sourceEvent, this)
        setTimeout(() => (movedRef.value = false), 0)
      })
    d3select(el).call(behavior)
  },
  updated(el, binding) {
    el._dragHandlers = binding.value
  }
}

// ---------- 路径拖动 ----------
function pathDragHandlers(p) {
  let start = null
  let last = null
  return {
    start(event) {
      start = toMm(event)
      last = { ...start }
      beginCoalesce('path-move')
    },
    drag(event) {
      const pt = toMm(event)
      const dx = pt.x - last.x
      const dy = pt.y - last.y
      dragPathTo(p.id, dx, dy, 'path-move')
      last = pt
    },
    end() {
      endCoalesce()
    }
  }
}

// ---------- 节点拖动 ----------
function nodeDragHandlers(p, i) {
  return {
    start() {
      selectNode(p.id, i)
      beginCoalesce('node-move')
    },
    drag(event) {
      const pt = toMm(event)
      dragNodeTo(p.id, i, pt.x, pt.y, 'node-move')
    },
    end() {
      endCoalesce()
      clearSnapIndicator()
    }
  }
}

// ---------- 手柄拖动 ----------
function handleDragHandlers(p, i, which) {
  return {
    start() {
      beginCoalesce('handle-move')
    },
    drag(event) {
      const pt = toMm(event)
      dragHandleTo(p.id, i, which, pt.x, pt.y, 'handle-move')
    },
    end() {
      endCoalesce()
    }
  }
}

// ---------- 点击选择 ----------
function onPathClick(event, p) {
  if (movedRef.value) return
  if (event.shiftKey) {
    toggleBooleanPath(p.id)
  } else {
    selectPath(p.id)
  }
}
function onNodeClick(event, p, i) {
  if (movedRef.value) return
  selectNode(p.id, i)
}
function onNodeDblClick(p, i) {
  toggleSmoothNode(p.id, i)
}
function onCanvasClick(event) {
  if (movedRef.value) return
  const pt = toMm(event)
  if (state.tool === 'pen') {
    // 延迟 260ms，若双击发生则取消第二次 click，避免重复末节点
    if (penClickTimer.value) return
    penClickTimer.value = setTimeout(() => {
      penClickTimer.value = null
      if (!state.penPathId) penStart(pt.x, pt.y)
      else penAddNode(pt.x, pt.y, event.shiftKey)
    }, 260)
  } else if (state.tool === 'nodeAdd') {
    if (selectedPath.value) addNodeOnEdge(selectedPath.value.id, pt.x, pt.y)
  } else {
    clearSelection()
  }
}
function onCanvasDblClick(event) {
  if (state.tool === 'pen' && state.penPathId) {
    clearTimeout(penClickTimer.value)
    penClickTimer.value = null
    // 双击的第二次 click 已被定时器拦截，当前末节点即目标节点，直接结束
    penFinish(false)
  }
}
function onMouseMove(event) {
  const pt = toMm(event)
  if (state.tool === 'pen') {
    if (state.penPathId) {
      const snapped = applySnap(pt.x, pt.y, state.penPathId)
      penPreview.value = snapped
    } else {
      penPreview.value = pt
    }
  } else if (state.tool === 'nodeAdd') {
    penPreview.value = pt
  } else {
    penPreview.value = null
    clearSnapIndicator()
  }
}
function onMouseLeave() {
  penPreview.value = null
  clearSnapIndicator()
}

const penLastNode = computed(() => {
  if (!state.penPathId) return null
  for (const layer of state.doc.layers) {
    const p = layer.paths.find((x) => x.id === state.penPathId)
    if (p && p.nodes.length) return p.nodes[p.nodes.length - 1]
  }
  return null
})

// ---------- 工具按钮 ----------
function breakSelected() {
  if (state.selection.nodeIndex !== null) breakNode(selectedPath.value.id, state.selection.nodeIndex)
  else if (selectedPath.value) breakNode(selectedPath.value.id, 0)
}
function closeSelected() {
  closePath(selectedPath.value.id)
}
function ringSelected() {
  ringArray(selectedPath.value.id)
}
function zoomIn() {
  state.zoom = Math.min(4, +(state.zoom * 1.2).toFixed(2))
}
function zoomOut() {
  state.zoom = Math.max(0.3, +(state.zoom / 1.2).toFixed(2))
}
function resetZoom() {
  state.zoom = 1
}

// ---------- 键盘 ----------
function onKeydown(e) {
  const tag = document.activeElement?.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
  if (e.ctrlKey && e.key.toLowerCase() === 'z') {
    e.preventDefault()
    undo()
  } else if (e.ctrlKey && (e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase() === 'z'))) {
    e.preventDefault()
    redo()
  } else if (e.key === 'Delete' || e.key === 'Backspace') {
    if (state.selection.pathId) {
      e.preventDefault()
      deleteSelected()
    }
  } else if (e.key.toLowerCase() === 'v') setTool('select')
  else if (e.key.toLowerCase() === 'p') setTool('pen')
  else if (e.key.toLowerCase() === 'a') setTool('nodeAdd')
  else if (e.key.toLowerCase() === 'j' && selectedPath.value) closePath(selectedPath.value.id)
  else if (e.key.toLowerCase() === 'k' && selectedPath.value) {
    breakNode(selectedPath.value.id, state.selection.nodeIndex ?? 0)
  } else if (e.key === 'Enter' && state.tool === 'pen') {
    penFinish(false)
  } else if (e.key === 'Escape') {
    if (state.penPathId) penFinish(false)
    else clearSelection()
  }
}
onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
</script>

<style scoped>
.shape-path { cursor: pointer; transition: stroke-width 0.1s; }
.shape-path.selected { stroke-width: 0.32; filter: drop-shadow(0 0 0.6px rgba(37, 99, 235, 0.6)); }
.shape-path.bool-marked { stroke-dasharray: 1.5, 1; }
.node-box { cursor: grab; }
.node-box:active { cursor: grabbing; }
.grid-divisions line, .grid-axial line, .center-line line { pointer-events: none; }
.narrow-gap-layer text { pointer-events: none; }
</style>
