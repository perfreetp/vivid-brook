<template>
  <div class="app-shell">
    <header class="app-header">
      <div>
        <h1>笔杆雕刻纹样工作室</h1>
        <div class="sub">圆周展开画布 · 贝塞尔纹样 · 布尔运算 · 窄缝检测 · 批次放行</div>
      </div>
      <nav class="tabs">
        <button :class="{ active: tab === 'editor' }" @click="tab = 'editor'">纹样编辑</button>
        <button :class="{ active: tab === 'batch' }" @click="tab = 'batch'">批次放行</button>
      </nav>
      <div class="header-spacer"></div>
      <span class="sub" v-if="tab === 'editor'">
        周长 {{ Wmm.toFixed(2) }}mm ｜ 历史 {{ state.historySize }}/{{ state.historyLimit }}
        <span v-if="gapCount" style="color:#fecaca">｜窄缝 {{ gapCount }}</span>
      </span>
      <span class="sub" v-else>
        待复核 {{ summary.byReview.pending }}/{{ summary.total }}
      </span>
    </header>

    <div class="workspace">
      <template v-if="tab === 'editor'">
        <aside class="sidebar">
          <LeftPanel />
        </aside>
        <main class="canvas-area">
          <CanvasStage />
          <ToastStack />
        </main>
        <aside class="sidebar right">
          <RightPanel />
        </aside>
      </template>
      <template v-else>
        <main class="canvas-area">
          <BatchReview />
          <ToastStack />
        </main>
      </template>
    </div>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue'
import CanvasStage from './components/CanvasStage.vue'
import LeftPanel from './components/LeftPanel.vue'
import RightPanel from './components/RightPanel.vue'
import BatchReview from './components/BatchReview.vue'
import ToastStack from './components/ToastStack.vue'
import { useEditor, narrowGapReport } from './editor/store.js'
import { canvasWidthMm } from './editor/model.js'
import { useBatch } from './editor/batch.js'

const tab = ref('editor')
const { state } = useEditor()
const { batchSummary } = useBatch()
const summary = batchSummary
const Wmm = computed(() => canvasWidthMm(state.doc))
const gapCount = computed(() => narrowGapReport.value.markers.length)
</script>
