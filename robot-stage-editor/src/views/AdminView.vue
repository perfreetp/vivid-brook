<template>
  <div class="page">
    <h2>后台 · 排期与统计</h2>

    <!-- 统计 -->
    <div class="stat-row">
      <div class="stat-card">
        <div class="num">{{ stats.rows.length }}</div><div class="lbl">剧目总数</div>
      </div>
      <div class="stat-card">
        <div class="num green">{{ stats.totalSessions }}</div><div class="lbl">已排场次</div>
      </div>
      <div class="stat-card">
        <div class="num orange">{{ fmtDur(stats.totalDuration) }}</div><div class="lbl">累计编排时长</div>
      </div>
    </div>

    <section class="block">
      <h3>剧目排期提交</h3>
      <table class="tbl">
        <thead>
          <tr><th>剧目</th><th>状态</th><th>场地</th><th>日期</th><th>时段</th><th>机器人</th><th>路径</th><th>编排时长</th><th>操作</th></tr>
        </thead>
        <tbody>
          <tr v-for="r in stats.rows" :key="r.id">
            <td>{{ nameOf(r.id) }}</td>
            <td><span class="tag" :class="statusOf(r.id)">{{ statusOf(r.id) === 'scheduled' ? '已排期' : '草稿' }}</span></td>
            <td>{{ sched(r.id).venue || '—' }}</td>
            <td>{{ sched(r.id).date || '—' }}</td>
            <td>{{ sched(r.id).slot || '—' }}</td>
            <td>{{ r.robotCount }}</td>
            <td>{{ r.pathCount }}</td>
            <td>{{ fmtDur(r.durationSec) }}</td>
            <td>
              <button class="btn sm primary" :disabled="statusOf(r.id) === 'scheduled'" @click="submit(r.id)">
                {{ statusOf(r.id) === 'scheduled' ? '已发布' : '提交排期' }}
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </section>

    <!-- 冲突弹窗：挡住发布 -->
    <div v-if="conflicts.length" class="modal-mask">
      <div class="modal conflict">
        <h3>⛔ 排期冲突，发布已拦截</h3>
        <p class="sub">以下节目在同一场地、同一日期的时段发生重叠，必须调整后才能发布：</p>
        <div v-for="(c, i) in conflicts" :key="i" class="conflict-item">
          <div class="pair">
            <span class="badge-a">{{ c.a }}</span>
            <span class="vs">撞</span>
            <span class="badge-b">{{ c.b }}</span>
          </div>
          <div class="where">{{ c.venue }} · {{ c.date }} · {{ c.slot }}</div>
        </div>
        <div class="modal-actions">
          <button class="btn primary" @click="conflicts = []">知道了，回去调整</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { store, adminStats, submitShow, showToast } from '../store/store.js'

const stats = adminStats
const conflicts = ref([])

const nameOf = (id) => store.shows.find(s => s.id === id)?.name
const statusOf = (id) => store.shows.find(s => s.id === id)?.status
const sched = (id) => store.shows.find(s => s.id === id)?.schedule || {}

function submit(id) {
  const res = submitShow(id)
  if (!res.ok) { conflicts.value = res.conflicts }
  else showToast('排期通过，节目已发布')
}
function fmtDur(sec) {
  if (!sec) return '00:00'
  const m = Math.floor(sec / 60), s = sec % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}
</script>

<style scoped>
.page { padding: 24px 28px; height: 100%; overflow: auto; }
h2 { margin: 0 0 20px; font-size: 20px; }
h3 { font-size: 15px; margin: 0 0 12px; }
.stat-row { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin-bottom: 26px; max-width: 720px; }
.stat-card { background: var(--panel); border: 1px solid var(--line); border-radius: 14px; padding: 20px; text-align: center; }
.num { font-size: 30px; font-weight: 700; }
.num.green { color: var(--green); }
.num.orange { color: var(--orange); }
.lbl { color: var(--muted); font-size: 13px; margin-top: 4px; }
.block { background: var(--panel); border: 1px solid var(--line); border-radius: 14px; padding: 18px; }
.tbl { width: 100%; border-collapse: collapse; }
.tbl th, .tbl td { padding: 10px 12px; text-align: left; font-size: 13px; border-bottom: 1px solid var(--line); }
.tbl th { color: var(--muted); font-weight: 500; }
.sm { padding: 5px 12px; font-size: 12px; }
.modal-mask { position: fixed; inset: 0; background: rgba(4, 6, 12, 0.7); display: flex; align-items: center; justify-content: center; z-index: 60; }
.modal { background: var(--panel); border: 1px solid var(--red); border-radius: 14px; padding: 26px; width: 520px; }
.conflict h3 { color: var(--red); margin: 0 0 10px; }
.sub { color: var(--muted); font-size: 13px; }
.conflict-item { background: rgba(255, 107, 107, 0.08); border: 1px solid rgba(255, 107, 107, 0.3); border-radius: 10px; padding: 14px; margin-bottom: 10px; }
.pair { display: flex; align-items: center; gap: 12px; font-weight: 600; }
.vs { background: var(--red); color: #fff; border-radius: 999px; padding: 2px 10px; font-size: 12px; }
.where { color: var(--muted); font-size: 12.5px; margin-top: 8px; }
.modal-actions { display: flex; justify-content: flex-end; margin-top: 16px; }
</style>
