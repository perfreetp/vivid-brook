<template>
  <div class="editor" v-if="show">
    <!-- 左工具栏 -->
    <aside class="toolbar">
      <button v-for="t in tools" :key="t.key" :class="{ active: store.tool === t.key }" :title="t.label" @click="pickTool(t.key)">
        <span class="ico">{{ t.icon }}</span>
      </button>
      <div class="sep"></div>
      <button title="镜像到舞台另一侧" @click="mirrorSelection">⇋</button>
      <button title="导出 SVG" @click="downloadSvg(show)">⇩</button>
    </aside>

    <!-- 机器人拖放托盘 -->
    <aside class="robot-tray">
      <div class="tray-title">机器人（拖入或点击投放）</div>
      <div v-for="m in store.materials" :key="m.id" class="robot-chip"
           :class="{ active: store.robotModel?.id === m.id }"
           draggable="true"
           @dragstart="onDragStart(m, $event)"
           @click="pickRobot(m)">
        <span class="dot" :style="{ background: m.color }"></span>
        <div>
          <div class="rn">{{ m.name }}</div>
          <div class="rs">r={{ m.radius }} · {{ m.speed }}m/s</div>
        </div>
      </div>
    </aside>

    <!-- 中央画布 -->
    <section class="stage-area" @drop="onDrop" @dragover.prevent>
      <StageCanvas ref="canvasRef" />
    </section>

    <!-- 右侧面板 -->
    <aside class="sidebar">
      <section class="panel">
        <h4>图层（三层固定层序）</h4>
        <div v-for="layer in LAYER_DEFS" :key="layer.key" class="layer-group">
          <div class="layer-head">
            <span>{{ layer.name }}</span>
            <span class="count">{{ layerShapes(layer.key).length }}</span>
          </div>
          <div v-for="s in layerShapes(layer.key)" :key="s.id"
               class="layer-item" :class="{ sel: store.selection.includes(s.id) }"
               @click="selectLayer(s.id, $event)">
            <button class="eye" @click.stop="toggleVisible(s)">{{ s.visible === false ? '◌' : '👁' }}</button>
            <span class="lname">{{ s.name }}</span>
          </div>
          <div v-if="!layerShapes(layer.key).length" class="layer-empty">空</div>
        </div>
      </section>

      <section class="panel">
        <h4>吸附模式</h4>
        <div class="snap-grid">
          <button v-for="m in snapModes" :key="m.key" :class="{ active: store.snapMode === m.key }" @click="store.snapMode = m.key">
            {{ m.label }}
          </button>
        </div>
        <div class="snap-tip">靠近目标 12px 内自动显示参考线</div>
      </section>

      <section class="panel">
        <h4>布尔运算（选两个形状）</h4>
        <div class="bool-row">
          <button class="btn" :disabled="store.selection.length !== 2" @click="doBool('union')">并集 ∪</button>
          <button class="btn" :disabled="store.selection.length !== 2" @click="doBool('intersect')">交集 ∩</button>
          <button class="btn" :disabled="store.selection.length !== 2" @click="doBool('difference')">差集 −</button>
        </div>
        <div class="snap-tip">结果保留圆角，自动合并重叠节点</div>
      </section>

      <section class="panel" v-if="selectedOne">
        <h4>属性 / 节拍标注</h4>
        <label class="field">名称<input v-model="selectedOne.name" @change="commit" /></label>
        <template v-if="selectedOne.type === 'rect'">
          <div class="row2">
            <label class="field">宽<input type="number" v-model.number="selectedOne.width" @change="commit" /></label>
            <label class="field">高<input type="number" v-model.number="selectedOne.height" @change="commit" /></label>
          </div>
          <label class="field">圆角半径<input type="number" v-model.number="selectedOne.cornerRadius" @change="commit" /></label>
        </template>
        <template v-if="selectedOne.type === 'circle'">
          <label class="field">半径<input type="number" v-model.number="selectedOne.radius" @change="commit" /></label>
        </template>
        <template v-if="selectedOne.type === 'robot'">
          <label class="field">朝向角度<input type="number" v-model.number="selectedOne.angle" @change="commit" /></label>
        </template>
        <template v-if="selectedOne.type === 'path'">
          <div class="snap-tip">节点 {{ selectedOne.nodes.length }} 个 · 双击边线插入节点 · 节点工具拖曲率手柄</div>
        </template>
        <div class="row2">
          <label class="field">节拍时间<input v-model="selectedOne.beat" placeholder="00:18" @change="commitBeat" /></label>
          <label class="field">负责演员<input v-model="selectedOne.actor" placeholder="演员/组" @change="commitBeat" /></label>
        </div>
        <div class="row2" style="margin-top:8px">
          <button class="btn" @click="duplicateShapes([...store.selection])">复制</button>
          <button class="btn danger" @click="removeShapes([...store.selection])">删除</button>
        </div>
      </section>

      <section class="panel history">
        <h4>操作历史</h4>
        <div class="hist-row">
          <button class="btn" :disabled="!canUndo(show.id)" @click="undo()">↶ 撤销</button>
          <button class="btn" :disabled="!canRedo(show.id)" @click="redo()">↷ 重做</button>
        </div>
        <div class="snap-tip">撤销/重做只回退图形内容，不改变图层层序</div>
      </section>
    </aside>
  </div>
  <div v-else class="no-show">
    <p>请先从「剧目列表」打开一个剧目</p>
    <button class="btn primary" @click="store.view = 'shows'">前往剧目列表</button>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue'
import StageCanvas from '../components/StageCanvas.vue'
import {
  store, currentShow, LAYER_DEFS, mirrorSelection, applyBoolean,
  removeShapes, duplicateShapes, pushHistory, undo, redo, canUndo, canRedo,
  annotate, showToast
} from './canvas-helpers.js'
import { downloadSVG } from '../lib/svg.js'

const show = currentShow
const canvasRef = ref(null)

const tools = [
  { key: 'select', icon: '➤', label: '选择/移动' },
  { key: 'rect', icon: '▭', label: '矩形（候场区）' },
  { key: 'circle', icon: '◯', label: '圆' },
  { key: 'polygon', icon: '⬡', label: '多边形' },
  { key: 'path', icon: '〰', label: '自绘行走路径' },
  { key: 'node', icon: '⊕', label: '节点/曲率编辑' },
  { key: 'robot', icon: '⬡', label: '机器人投放' }
]
const snapModes = [
  { key: 'grid', label: '网格' }, { key: 'endpoint', label: '端点' },
  { key: 'midpoint', label: '中点' }, { key: 'equidistant', label: '等距' }
]

const selectedOne = computed(() =>
  store.selection.length === 1 ? show.value.shapes.find(s => s.id === store.selection[0]) : null)

function layerShapes(key) { return show.value.shapes.filter(s => s.layer === key) }
function pickTool(key) {
  store.tool = key
  if (key !== 'robot') store.robotModel = null
}
function pickRobot(m) { store.tool = 'robot'; store.robotModel = m }
function onDragStart(m, e) {
  store.tool = 'robot'; store.robotModel = m
  e.dataTransfer.setData('text/plain', m.id)
}
function onDrop(e) {
  // 画布内部自行处理 pointer；此处保证拖放后工具就绪
  e.preventDefault()
}
function selectLayer(id, ev) {
  store.selection = ev.shiftKey ? [...store.selection, id] : [id]
}
function toggleVisible(s) { s.visible = s.visible === false; pushHistory('切换可见性') }
function doBool(op) {
  if (store.selection.length !== 2) return showToast('请按住 Ctrl/Shift 选择两个形状')
  applyBoolean(op, store.selection[0], store.selection[1])
}
function commit() { pushHistory('修改属性') }
function commitBeat() {
  if (selectedOne.value) annotate(selectedOne.value.id, selectedOne.value.beat, selectedOne.value.actor)
}
function downloadSvg(s) { downloadSVG(s); showToast('已导出干净 SVG（三层分组）') }
</script>

<style scoped>
.editor { display: grid; grid-template-columns: 56px 190px 1fr 310px; height: 100%; min-height: 0; }
.toolbar { background: var(--panel); border-right: 1px solid var(--line); display: flex; flex-direction: column; align-items: center; padding: 10px 0; gap: 6px; }
.toolbar button { width: 40px; height: 40px; border-radius: 9px; border: 1px solid transparent; background: transparent; color: var(--muted); font-size: 17px; cursor: pointer; }
.toolbar button:hover { background: var(--panel2); color: var(--text); }
.toolbar button.active { background: rgba(88, 166, 255, 0.15); border-color: var(--accent); color: var(--accent); }
.toolbar .sep { width: 26px; height: 1px; background: var(--line); margin: 4px 0; }
.robot-tray { background: var(--panel); border-right: 1px solid var(--line); padding: 14px 10px; overflow: auto; }
.tray-title { font-size: 12px; color: var(--muted); margin-bottom: 10px; }
.robot-chip { display: flex; gap: 8px; align-items: center; padding: 9px; border: 1px solid var(--line); border-radius: 10px; margin-bottom: 8px; cursor: grab; background: var(--panel2); }
.robot-chip.active { border-color: var(--orange); }
.robot-chip .dot { width: 12px; height: 12px; border-radius: 50%; flex: 0 0 auto; }
.rn { font-size: 12.5px; }
.rs { font-size: 11px; color: var(--muted); }
.stage-area { position: relative; min-width: 0; }
.sidebar { background: var(--panel); border-left: 1px solid var(--line); overflow: auto; padding: 12px; display: flex; flex-direction: column; gap: 12px; }
.panel { background: var(--panel2); border: 1px solid var(--line); border-radius: 10px; padding: 12px; }
.panel h4 { margin: 0 0 10px; font-size: 13px; color: var(--accent); }
.layer-group { margin-bottom: 8px; }
.layer-head { display: flex; justify-content: space-between; font-size: 12px; color: var(--muted); padding: 4px 2px; }
.count { background: var(--line); border-radius: 999px; padding: 0 8px; font-size: 11px; }
.layer-item { display: flex; align-items: center; gap: 6px; padding: 5px 8px; border-radius: 7px; cursor: pointer; font-size: 12.5px; }
.layer-item:hover { background: rgba(88, 166, 255, 0.08); }
.layer-item.sel { background: rgba(88, 166, 255, 0.16); color: var(--accent); }
.eye { background: none; border: none; cursor: pointer; color: var(--muted); padding: 0; }
.lname { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.layer-empty { font-size: 11px; color: #55607c; padding: 2px 8px 6px; }
.snap-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
.snap-grid button { background: var(--panel); border: 1px solid var(--line); color: var(--muted); border-radius: 7px; padding: 7px; cursor: pointer; font-size: 12px; }
.snap-grid button.active { border-color: var(--accent); color: var(--accent); background: rgba(88, 166, 255, 0.12); }
.snap-tip { font-size: 11.5px; color: var(--muted); margin-top: 8px; line-height: 1.5; }
.bool-row { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; }
.bool-row .btn { padding: 7px 4px; font-size: 12px; }
.field { display: grid; gap: 5px; font-size: 12px; color: var(--muted); margin-bottom: 9px; }
.row2 { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.hist-row { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.no-show { height: 100%; display: grid; place-content: center; gap: 14px; color: var(--muted); justify-items: center; }
</style>
