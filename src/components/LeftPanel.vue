<template>
  <div>
    <!-- 笔杆参数 -->
    <div class="section">
      <h3>笔杆参数（圆周展开）</h3>
      <div class="row">
        <label>直径 mm</label>
        <input type="number" min="1" step="0.5" :value="state.doc.shaft.diameterMm"
               @change="setDiameter(+($event.target.value))" />
      </div>
      <div class="row">
        <label>雕刻段长 mm</label>
        <input type="number" min="10" step="5" :value="state.doc.shaft.lengthMm"
               @change="setLength(+($event.target.value))" />
      </div>
      <div class="row">
        <label>周长 =</label>
        <span class="val">π × {{ state.doc.shaft.diameterMm }} = {{ Wmm.toFixed(3) }} mm</span>
      </div>
      <div class="row">
        <label>环向等分数</label>
        <input type="number" min="2" max="96" :value="state.doc.grid.divisions"
               @change="setDivisions(+($event.target.value))" />
      </div>
      <div class="row">
        <label>轴向网格 mm</label>
        <input type="number" min="1" step="1" :value="state.doc.grid.axialStepMm"
               @change="setAxialStep(+($event.target.value))" />
      </div>
      <div class="row">
        <label>窄缝阈值 mm</label>
        <input type="number" min="0.05" step="0.05" :value="state.doc.narrowGapThresholdMm"
               @change="setGapThreshold(+($event.target.value))" />
      </div>
    </div>

    <!-- 参考线与吸附 -->
    <div class="section">
      <h3>参考线与吸附</h3>
      <div class="row"><input type="checkbox" id="g1" v-model="state.doc.grid.showDivisionLines" /><label for="g1" style="min-width:0">环向等分参考线</label></div>
      <div class="row"><input type="checkbox" id="g2" v-model="state.doc.grid.showAxialGrid" /><label for="g2" style="min-width:0">轴向网格线</label></div>
      <div class="row"><input type="checkbox" id="g3" v-model="state.doc.grid.showCenterLine" /><label for="g3" style="min-width:0">中心线</label></div>
      <hr class="sep" />
      <div class="row"><input type="checkbox" id="s1" v-model="state.doc.grid.snapGrid" /><label for="s1" style="min-width:0">吸附网格交点</label></div>
      <div class="row"><input type="checkbox" id="s2" v-model="state.doc.grid.snapCenter" /><label for="s2" style="min-width:0">吸附中心线</label></div>
      <div class="row"><input type="checkbox" id="s3" v-model="state.doc.grid.snapEndpoints" /><label for="s3" style="min-width:0">吸附其它路径端点</label></div>
      <div class="row">
        <label>吸附半径 mm</label>
        <input type="number" min="0.1" step="0.1" :value="state.doc.grid.snapThresholdMm"
               @change="state.doc.grid.snapThresholdMm = Math.max(0.1, +$event.target.value)" />
      </div>
    </div>

    <!-- 图层 -->
    <div class="section">
      <h3>
        图层（导出保留分组）
        <button class="icon-btn" title="新增图层" @click="addLayer()">＋</button>
      </h3>
      <div v-for="layer in state.doc.layers" :key="layer.id"
           class="layer-item" :class="{ active: layer.id === state.doc.activeLayerId }"
           @click="state.doc.activeLayerId = layer.id">
        <button class="icon-btn" @click.stop="toggleLayerVisible(layer.id)" :title="layer.visible ? '隐藏' : '显示'">
          {{ layer.visible ? '👁' : '🚫' }}
        </button>
        <button class="icon-btn" @click.stop="toggleLayerLock(layer.id)" :title="layer.locked ? '解锁' : '锁定'">
          {{ layer.locked ? '🔒' : '🔓' }}
        </button>
        <input
          :value="layer.name"
          @click.stop
          @change="renameLayer(layer.id, $event.target.value)"
          style="border-color: transparent; background: transparent; padding: 2px 4px"
        />
        <span class="hint" style="margin-left:auto">{{ layer.paths.length }} 路径</span>
        <button class="icon-btn danger" @click.stop="removeLayer(layer.id)" title="删除图层">✕</button>
      </div>
    </div>

    <!-- 路径清单 -->
    <div class="section">
      <h3>路径清单</h3>
      <template v-for="layer in state.doc.layers" :key="'pl' + layer.id">
        <div v-for="p in layer.paths" :key="p.id"
             class="path-item"
             :class="{
               selected: state.selection.pathId === p.id,
               'boolean-marked': state.booleanIds.includes(p.id),
               'hidden-path': p.visible === false
             }"
             @click="selectPath(p.id)">
          <span :style="{ color: gapSet.has(p.id) ? '#dc2626' : p.stroke }">◆</span>
          <span style="flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap">{{ p.name }}</span>
          <span v-if="p.closed" class="hint">闭合</span>
          <span v-else class="hint" style="color:#7c3aed">开放</span>
          <span v-if="gapSet.has(p.id)" class="badge reject">窄缝</span>
          <span v-if="state.booleanIds.includes(p.id)" class="badge warn">布尔{{ state.booleanIds.indexOf(p.id) + 1 }}</span>
        </div>
      </template>
      <p v-if="!totalPaths" class="hint" style="text-align:center; margin: 8px 0">暂无路径，用 ✒️ 钢笔工具描纹样</p>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { useEditor, narrowGapReport } from '../editor/store.js'
import { canvasWidthMm } from '../editor/model.js'

const {
  state,
  setDiameter,
  setLength,
  addLayer,
  toggleLayerVisible,
  toggleLayerLock,
  removeLayer,
  renameLayer,
  selectPath
} = useEditor()

const Wmm = computed(() => canvasWidthMm(state.doc))
const totalPaths = computed(() => state.doc.layers.reduce((s, l) => s + l.paths.length, 0))
const gapSet = computed(() => new Set(Object.keys(narrowGapReport.value.perPath)))

function setDivisions(v) {
  state.doc.grid.divisions = Math.max(2, Math.min(96, Math.round(v) || 12))
}
function setAxialStep(v) {
  state.doc.grid.axialStepMm = Math.max(1, +v || 10)
}
function setGapThreshold(v) {
  state.doc.narrowGapThresholdMm = Math.max(0.05, +v || 0.3)
}
</script>
