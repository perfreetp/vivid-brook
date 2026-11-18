<template>
  <div>
    <!-- 历史栈 -->
    <div class="section">
      <h3>撤销 / 重做（≥50 步）</h3>
      <div class="row">
        <button style="flex:1" :disabled="!state.canUndo" @click="undo()">↶ 撤销<span class="hint"> (Ctrl+Z)</span></button>
        <button style="flex:1" :disabled="!state.canRedo" @click="redo()">↷ 重做<span class="hint"> (Ctrl+Y)</span></button>
      </div>
      <div class="row">
        <span class="hint">已记录 {{ state.historySize }} / {{ state.historyLimit }} 步</span>
        <span style="flex:1"></span>
        <span v-if="state.canUndo" class="hint">上一步：{{ state.undoLabel }}</span>
      </div>
      <div style="height:4px; background:#e5e7eb; border-radius:2px; overflow:hidden">
        <div :style="{ width: Math.min(100, (state.historySize / state.historyLimit) * 100) + '%', height: '100%', background: 'var(--primary)' }"></div>
      </div>
    </div>

    <!-- 选中路径属性 -->
    <div class="section" v-if="selected">
      <h3>路径属性</h3>
      <div class="row">
        <label>名称</label>
        <input :value="selected.name" @change="selected.name = $event.target.value" />
      </div>
      <div class="row">
        <label>状态</label>
        <span :class="['badge', selected.closed ? 'pass' : 'warn']">{{ selected.closed ? '闭合路径' : '开放路径' }}</span>
        <span class="hint">{{ selected.nodes.length }} 节点</span>
      </div>
      <div class="row">
        <label>线宽 mm</label>
        <input type="number" min="0.05" step="0.05" v-model.number="selected.strokeWidth" />
      </div>
      <div class="row">
        <label>描边色</label>
        <input type="color" v-model="selected.stroke" style="width:60px; padding:2px" />
      </div>
      <hr class="sep" />
      <div class="row" style="flex-wrap:wrap; gap:6px">
        <button @click="onBreak" :disabled="state.selection.nodeIndex === null && !selected">✂️ 断开节点</button>
        <button @click="onClose" :disabled="selected.closed">🔗 闭合路径</button>
        <button @click="onSmooth" :disabled="state.selection.nodeIndex === null">◠ 光滑/尖角</button>
        <button class="danger" @click="deleteSelected()">🗑 删除</button>
      </div>
      <p class="hint" v-if="state.selection.nodeIndex !== null">
        已选中第 {{ state.selection.nodeIndex + 1 }} 个节点，双击节点也可切换光滑/尖角；拖动蓝色手柄调贝塞尔曲线。
      </p>
      <div v-if="selected.sourceData" class="hint" style="background:#f8fafc; padding:6px; border-radius:6px; margin-top:6px">
        原始数据已留存：{{ sourceSummary(selected.sourceData) }}
      </div>
    </div>

    <!-- 布尔运算面板 -->
    <div class="section">
      <h3>布尔运算</h3>
      <p class="hint">在画布上按住 <span class="kbd">Shift</span> 点选两条<b>闭合</b>路径（顺序即 A、B），差集为 A − B。</p>
      <div v-for="(id, i) in state.booleanIds" :key="id" class="row">
        <span class="badge warn">路径 {{ String.fromCharCode(65 + i) }}</span>
        <span style="flex:1">{{ pathName(id) }}</span>
        <button class="icon-btn" @click="toggleBooleanPath(id)">✕</button>
      </div>
      <div v-if="!state.booleanIds.length" class="hint">未选择路径</div>
      <hr class="sep" />
      <div class="row">
        <button style="flex:1" :disabled="!booleanReady" @click="runBoolean('unite')">∪ 并集</button>
        <button style="flex:1" :disabled="!booleanReady" @click="runBoolean('subtract')">− 差集</button>
        <button style="flex:1" :disabled="!booleanReady" @click="runBoolean('intersect')">∩ 交集</button>
      </div>
      <p class="hint">运算后原路径自动隐藏保留，结果路径携带运算履历与原始节点数据。</p>
    </div>

    <!-- 环向阵列 -->
    <div class="section">
      <h3>环向阵列</h3>
      <button style="width:100%" :disabled="!selected" @click="onRingArray">🔁 沿圆周复刻三份（周长 ÷ 3 等距）</button>
      <p class="hint">阵列后自动校验 x=0 与 x=周长 两条拼缝上的端点能否首尾相接，错位会弹警告。</p>
    </div>

    <!-- 窄缝检测结果 -->
    <div class="section">
      <h3>窄缝检测 &lt; {{ state.doc.narrowGapThresholdMm }}mm</h3>
      <div v-if="gapReport.markers.length" class="gap-warning-box">
        <b>⚠ {{ gapReport.markers.length }} 处窄缝激光雕不出来，画布与导出 SVG 均已标红</b>
        <ul>
          <li v-for="(g, i) in gapReport.markers.slice(0, 8)" :key="i">
            位置 ({{ g.x.toFixed(2) }}, {{ g.y.toFixed(2) }})，间距 <b>{{ g.distance }}mm</b>
          </li>
          <li v-if="gapReport.markers.length > 8">…其余 {{ gapReport.markers.length - 8 }} 处见画布红圈</li>
        </ul>
      </div>
      <p v-else class="hint" style="color:var(--ok)">✓ 当前纹样未发现低于阈值的窄缝</p>
    </div>

    <!-- 导入导出 -->
    <div class="section">
      <h3>项目与导出</h3>
      <div class="row">
        <button class="primary" style="flex:1" @click="exportSVG()">⬇ 导出 SVG</button>
      </div>
      <p class="hint">SVG 保留 <b>图层 &lt;g&gt; 分组</b>、每条路径的 <b>data-original-nodes 原始路径数据</b> 与运算履历，窄缝标红一并写入。</p>
      <div class="row">
        <button style="flex:1" @click="exportProject()">导出项目 JSON</button>
        <button style="flex:1" @click="triggerImport">导入项目</button>
      </div>
      <input ref="fileInput" type="file" accept="application/json" style="display:none" @change="onFile" />
      <hr class="sep" />
      <div class="row">
        <button style="flex:1" @click="loadSample()">载入示例纹样</button>
        <button style="flex:1" class="danger" @click="resetDocument()">重置文档</button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue'
import { useEditor, narrowGapReport } from '../editor/store.js'

const {
  state,
  selectedPath,
  undo,
  redo,
  breakNode,
  closePath,
  deleteSelected,
  toggleSmoothNode,
  toggleBooleanPath,
  runBoolean,
  ringArray,
  exportSVG,
  exportProject,
  importProject,
  loadSample,
  resetDocument,
  findPath
} = useEditor()

const selected = selectedPath
const gapReport = narrowGapReport
const fileInput = ref(null)

const booleanReady = computed(() => {
  if (state.booleanIds.length !== 2) return false
  return state.booleanIds.every((id) => {
    const f = findPath(id)
    return f && f.path.closed && f.path.nodes.length >= 3
  })
})

function pathName(id) {
  return findPath(id)?.path.name || '（已删除）'
}
function onBreak() {
  if (!selected.value) return
  breakNode(selected.value.id, state.selection.nodeIndex ?? 0)
}
function onClose() {
  if (selected.value) closePath(selected.value.id)
}
function onSmooth() {
  if (selected.value && state.selection.nodeIndex !== null) {
    toggleSmoothNode(selected.value.id, state.selection.nodeIndex)
  }
}
function onRingArray() {
  if (selected.value) ringArray(selected.value.id)
}
function sourceSummary(src) {
  if (src.op === 'ringArray') return `环向阵列副本，偏移 ${src.offsetMm}mm`
  if (src.op) return `${src.op} 运算结果，含 ${src.operands?.length || 0} 条操作路径快照`
  return JSON.stringify(src).slice(0, 80)
}
function triggerImport() {
  fileInput.value?.click()
}
function onFile(e) {
  const f = e.target.files?.[0]
  if (f) importProject(f)
  e.target.value = ''
}
</script>
