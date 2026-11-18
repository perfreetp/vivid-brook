<template>
  <div class="batch-wrap">
    <!-- 批次头部 -->
    <div class="section" style="display:flex; align-items:center; gap:16px; flex-wrap:wrap">
      <div>
        <h3 style="margin:0 0 4px">素材批次放行台</h3>
        <span class="hint">供应商交料 → 系统自动检查（线宽 / 断点 / 窄缝）→ 复核员逐条确认或驳回 → 整批处理完方可放行雕刻组</span>
      </div>
      <span style="flex:1"></span>
      <button class="primary" @click="loadSampleBatch">📦 载入示例批次</button>
    </div>

    <div v-if="!batch.items.length" class="section empty-state">
      <p style="font-size:15px">当前没有待处理批次</p>
      <p>点击「载入示例批次」生成 6 条覆盖合格 / 警告 / 退回三级的素材用于演示。</p>
    </div>

    <template v-else>
      <!-- 批次信息 -->
      <div class="section" style="display:flex; gap:28px; flex-wrap:wrap; align-items:center">
        <div><span class="hint">批次号：</span><b>{{ batch.batchNo }}</b></div>
        <div><span class="hint">供应商：</span><b>{{ batch.supplier }}</b></div>
        <div><span class="hint">收料时间：</span>{{ fmt(batch.receivedAt) }}</div>
        <div v-if="batch.released">
          <span class="badge pass" style="font-size:13px">✓ 已放行 {{ fmt(batch.releasedAt) }}</span>
        </div>
      </div>

      <!-- 统计卡片 -->
      <div class="stat-cards">
        <div class="stat-card">
          <div class="num">{{ summary.total }}</div>
          <div class="lbl">素材总数</div>
        </div>
        <div class="stat-card">
          <div class="num" style="color:var(--ok)">{{ summary.byLevel.pass }}</div>
          <div class="lbl">自动检查：合格</div>
        </div>
        <div class="stat-card">
          <div class="num" style="color:var(--warn)">{{ summary.byLevel.warn }}</div>
          <div class="lbl">自动检查：警告</div>
        </div>
        <div class="stat-card">
          <div class="num" style="color:var(--danger)">{{ summary.byLevel.reject }}</div>
          <div class="lbl">自动检查：退回</div>
        </div>
        <div class="stat-card">
          <div class="num" style="color:#7c3aed">{{ summary.byReview.pending }}</div>
          <div class="lbl">待复核</div>
        </div>
        <div class="stat-card">
          <div class="num" style="color:var(--ok)">{{ summary.byReview.confirmed }}</div>
          <div class="lbl">已确认</div>
        </div>
        <div class="stat-card">
          <div class="num" style="color:var(--danger)">{{ summary.byReview.rejected }}</div>
          <div class="lbl">已驳回（回供应商）</div>
        </div>
      </div>

      <!-- 素材明细表 -->
      <div class="section" style="padding:0; overflow:hidden">
        <table class="batch-table">
          <thead>
            <tr>
              <th style="width:44px">#</th>
              <th style="width:150px">素材 / 编号</th>
              <th style="width:120px">预览</th>
              <th>自动检查结果</th>
              <th style="width:190px">指标</th>
              <th style="width:300px">复核操作（{{ reviewer || '未署名' }}）</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(item, idx) in batch.items" :key="item.id"
                :style="{ background: rowTint(item) }">
              <td>{{ idx + 1 }}</td>
              <td>
                <b>{{ item.name }}</b><br />
                <span class="hint">{{ item.code }}</span><br />
                <span :class="['badge', item.check.level]">{{ LEVEL_META[item.check.level].label }}</span>
              </td>
              <td>
                <svg class="mini-svg" :width="110" :height="90" :viewBox="miniBox(item)">
                  <rect :x="miniBounds(item).x0 - 1" :y="miniBounds(item).y0 - 1"
                        :width="miniBounds(item).w + 2" :height="miniBounds(item).h + 2"
                        fill="none" stroke="#e2e8f0" stroke-width="0.3" />
                  <path v-for="(p, pi) in item.paths" :key="pi"
                        :d="toD(p)" fill="none"
                        :stroke="hasNarrow(item) ? '#dc2626' : '#2563eb'"
                        :stroke-width="0.4" />
                </svg>
              </td>
              <td>
                <ul class="reason-list">
                  <li v-for="(r, ri) in item.check.reasons" :key="ri"
                      :class="reasonClass(r.code)">
                    {{ r.text }}
                  </li>
                </ul>
              </td>
              <td>
                <span class="hint">最细线宽：</span>
                <b :style="{ color: item.check.metrics.minLineWidthMm < CHECK_RULES.minLineWidthMm ? '#dc2626' : 'inherit' }">
                  {{ item.check.metrics.minLineWidthMm }}mm
                </b><br />
                <span class="hint">断点数：</span>{{ item.check.metrics.breakpoints }}<br />
                <span class="hint">窄缝：</span>
                <b :style="{ color: item.check.metrics.narrowGapCount ? '#dc2626' : 'inherit' }">
                  {{ item.check.metrics.narrowGapCount }} 处
                </b>
                <template v-if="item.check.metrics.minGapMm">
                  <br /><span class="hint">最窄：</span>{{ item.check.metrics.minGapMm }}mm
                </template>
              </td>
              <td>
                <template v-if="item.review.status === REVIEW.PENDING">
                  <input v-model="reviewDrafts[item.id]" placeholder="驳回原因（驳回必填）/ 复核备注" />
                  <div class="review-actions">
                    <button class="primary" @click="onConfirm(item)">✓ 确认通过</button>
                    <button class="danger" @click="onReject(item)">✕ 驳回退回</button>
                  </div>
                </template>
                <template v-else>
                  <span :class="['badge', item.review.status]">
                    {{ item.review.status === REVIEW.CONFIRMED ? '已确认' : '已驳回' }}
                  </span>
                  <div class="hint" style="margin-top:6px">
                    复核人：{{ item.review.reviewer }}<br />
                    时间：{{ fmt(item.review.at) }}
                  </div>
                  <div v-if="item.review.comment"
                       :style="{ marginTop: '6px', padding: '6px 8px', borderRadius: '6px',
                                 background: item.review.status === REVIEW.REJECTED ? 'var(--danger-soft)' : '#f1f5f9',
                                 color: item.review.status === REVIEW.REJECTED ? '#991b1b' : 'inherit' }">
                    「{{ item.review.comment }}」
                  </div>
                  <div class="review-actions" style="margin-top:6px">
                    <button @click="resetReview(item.id)">↺ 撤回重新复核</button>
                  </div>
                </template>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- 放行栏 -->
      <div class="release-bar section">
        <div style="flex:1">
          <template v-if="batch.released">
            <span class="badge pass" style="font-size:13px">本批次已放行给雕刻组</span>
            <span class="hint" style="margin-left:10px">放行单已可导出，随附确认素材的 SVG 数据</span>
          </template>
          <template v-else-if="!summary.allHandled">
            <b>还差 {{ summary.byReview.pending }} 条未复核</b>
            <span class="hint">— 整批全部处理完（确认或驳回）后才能放行</span>
          </template>
          <template v-else-if="summary.byReview.confirmed === 0">
            <b style="color:var(--danger)">全部素材均被驳回，无可放行内容</b>
          </template>
          <template v-else>
            <b style="color:var(--ok)">全部 {{ summary.total }} 条已处理完毕（确认 {{ summary.byReview.confirmed }} / 驳回 {{ summary.byReview.rejected }}），可以放行</b>
          </template>
        </div>
        <input v-model="reviewer.name" placeholder="复核员姓名" style="width:130px" />
        <button @click="onExportReject" :disabled="!summary.byReview.rejected">
          📤 导出退回清单（{{ summary.byReview.rejected }}）
        </button>
        <button class="primary" :disabled="!summary.canRelease || batch.released" @click="onRelease">
          🏭 整批放行给雕刻组
        </button>
        <button @click="onExportRelease" :disabled="!batch.released">导出放行单</button>
      </div>
    </template>
  </div>
</template>

<script setup>
import { reactive, computed } from 'vue'
import {
  useBatch,
  CHECK_RULES,
  LEVEL_META,
  REVIEW
} from '../editor/batch.js'
import { nodesToD } from '../editor/model.js'
import { toast } from '../editor/store.js'

const {
  batch,
  batchSummary,
  confirmItem,
  rejectItem,
  resetReview,
  releaseBatch,
  exportRejectSheet,
  exportReleaseNote,
  loadSampleBatch
} = useBatch()

const summary = batchSummary
const reviewer = reactive({ name: '' })
const reviewDrafts = reactive({})

function toD(p) {
  return nodesToD(p)
}
function fmt(iso) {
  return iso ? new Date(iso).toLocaleString('zh-CN', { hour12: false }) : ''
}
function rowTint(item) {
  if (item.review.status === REVIEW.CONFIRMED) return '#f0fdf4'
  if (item.review.status === REVIEW.REJECTED) return '#fef2f2'
  return item.check.level === 'reject' ? '#fff7f7' : item.check.level === 'warn' ? '#fffbeb' : '#fff'
}
function hasNarrow(item) {
  return item.check.metrics.narrowGapCount > 0
}
function reasonClass(code) {
  if (code === 'LINE_WIDTH' || code === 'BREAK') return 'danger'
  if (code === 'OK') return ''
  return 'warn'
}
function miniBounds(item) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  item.paths.forEach((p) =>
    p.nodes.forEach((n) => {
      x0 = Math.min(x0, n.x)
      y0 = Math.min(y0, n.y)
      x1 = Math.max(x1, n.x)
      y1 = Math.max(y1, n.y)
    })
  )
  if (!isFinite(x0)) return { x0: 0, y0: 0, w: 10, h: 10 }
  return { x0, y0, w: Math.max(1, x1 - x0), h: Math.max(1, y1 - y0) }
}
function miniBox(item) {
  const b = miniBounds(item)
  const pad = 2
  return `${b.x0 - pad} ${b.y0 - pad} ${b.w + pad * 2} ${b.h + pad * 2}`
}
function onConfirm(item) {
  if (!reviewer.name.trim()) return toast('请先在右下角填写复核员姓名', 'warn')
  confirmItem(item.id, reviewer.name.trim(), reviewDrafts[item.id] || '')
  reviewDrafts[item.id] = ''
  toast(`「${item.name}」已确认通过`, 'success', 2000)
}
function onReject(item) {
  if (!reviewer.name.trim()) return toast('请先填写复核员姓名', 'warn')
  const reason = (reviewDrafts[item.id] || '').trim()
  if (!reason) return toast('驳回必须填写退回原因，供应商需要据此修改', 'error', 4200)
  rejectItem(item.id, reviewer.name.trim(), reason)
  reviewDrafts[item.id] = ''
  toast(`「${item.name}」已驳回，原因将随退回清单回供应商`, 'warn', 3200)
}
function onRelease() {
  if (!reviewer.name.trim()) return toast('放行需要复核员署名', 'warn')
  try {
    releaseBatch()
    toast('整批已放行给雕刻组，可导出放行单', 'success', 4000)
  } catch (e) {
    toast(e.message, 'error', 4000)
  }
}
function onExportReject() {
  const sheet = exportRejectSheet()
  if (sheet) toast(`退回清单已导出，含 ${sheet.items.length} 条素材及驳回原因`, 'success', 4000)
}
function onExportRelease() {
  exportReleaseNote()
  toast('放行单已导出（含确认素材 SVG）', 'success', 3000)
}
</script>
