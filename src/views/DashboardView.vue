<script setup lang="ts">
import { computed, ref } from 'vue';
import { useWorkStore } from '../stores/work';

const work = useWorkStore();
const range = ref<'all' | '7d' | '30d'>('all');

const now = Date.now();
const RANGE_MS: Record<string, number> = { all: Infinity, '7d': 7 * 86400000, '30d': 30 * 86400000 };

const scoped = computed(() =>
  work.orders.filter((o) => now - o.createdAt <= RANGE_MS[range.value]),
);

const statusBuckets = computed(() => {
  const labels: Record<string, string> = {
    pending: '待派单', modeling: '建模中', qc: '质检中', passed: '已通过', rejected: '已打回', done: '已归档',
  };
  const counts: Record<string, number> = {};
  for (const o of scoped.value) counts[o.status] = (counts[o.status] ?? 0) + 1;
  return Object.entries(labels).map(([key, label]) => ({ key, label, count: counts[key] ?? 0 }));
});
const maxBucket = computed(() => Math.max(1, ...statusBuckets.value.map((b) => b.count)));

/** 每位建模员：完成单量（通过+归档）、在办、返工率、平均返工次数 */
const personStats = computed(() => {
  return work.modelers.map((m) => {
    const mine = scoped.value.filter((o) => o.assignee === m.name);
    const done = mine.filter((o) => o.status === 'passed' || o.status === 'done').length;
    const active = mine.filter((o) => o.status === 'modeling' || o.status === 'qc' || o.status === 'rejected').length;
    const reworkOrders = mine.filter((o) => o.reworkCount > 0).length;
    const totalRework = mine.reduce((s, o) => s + o.reworkCount, 0);
    const handled = mine.filter((o) => o.submittedSnapshot).length;
    const reworkRate = handled ? Math.round((reworkOrders / handled) * 100) : 0;
    return { name: m.name, done, active, reworkRate, totalRework, handled, max: 0 };
  });
});
const maxDone = computed(() => Math.max(1, ...personStats.value.map((p) => p.done)));

const totals = computed(() => {
  const orders = scoped.value;
  const done = orders.filter((o) => o.status === 'passed' || o.status === 'done').length;
  const reworked = orders.filter((o) => o.reworkCount > 0).length;
  const submitted = orders.filter((o) => o.submittedSnapshot).length;
  return {
    total: orders.length,
    done,
    reworkRate: submitted ? Math.round((reworked / submitted) * 100) : 0,
    qcPending: orders.filter((o) => o.status === 'qc').length,
  };
});

/** 近 10 单返工流水 */
const recentRework = computed(() =>
  scoped.value
    .filter((o) => o.reworkCount > 0 || o.status === 'rejected')
    .slice(0, 10),
);

function fmt(ts: number) {
  const d = new Date(ts);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}
</script>

<template>
  <div class="view">
    <div class="row" style="justify-content: space-between; margin-bottom: 12px">
      <div class="kpi-row">
        <div class="kpi"><div class="num">{{ totals.total }}</div><div class="lbl">需求单总量</div></div>
        <div class="kpi"><div class="num">{{ totals.done }}</div><div class="lbl">完成单量</div></div>
        <div class="kpi" :class="totals.reworkRate > 30 ? 'warn-kpi' : ''">
          <div class="num">{{ totals.reworkRate }}%</div><div class="lbl">整体返工率</div>
        </div>
        <div class="kpi"><div class="num">{{ totals.qcPending }}</div><div class="lbl">待质检</div></div>
      </div>
      <div class="row">
        <button v-for="r in (['all','30d','7d'] as const)" :key="r"
          :class="{ primary: range === r }"
          @click="range = r">
          {{ r === 'all' ? '全部' : r === '30d' ? '近30天' : '近7天' }}
        </button>
      </div>
    </div>

    <div class="dash-grid">
      <div class="panel">
        <h3>单据状态分布</h3>
        <div class="bars">
          <div v-for="b in statusBuckets" :key="b.key" class="bar-row">
            <span class="bar-label">{{ b.label }}</span>
            <div class="bar-track">
              <div class="bar-fill" :class="b.key" :style="{ width: (b.count / maxBucket) * 100 + '%' }"></div>
            </div>
            <span class="bar-num">{{ b.count }}</span>
          </div>
        </div>
      </div>

      <div class="panel">
        <h3>建模员完成单量与返工率</h3>
        <table>
          <thead>
            <tr><th>建模员</th><th>完成</th><th>在办</th><th>已提交</th><th>返工率</th><th>累计返工</th></tr>
          </thead>
          <tbody>
            <tr v-for="p in personStats" :key="p.name">
              <td>{{ p.name }}</td>
              <td>
                <div class="mini-bar">
                  <div class="mini-fill" :style="{ width: (p.done / maxDone) * 100 + '%' }"></div>
                  <span>{{ p.done }}</span>
                </div>
              </td>
              <td>{{ p.active }}</td>
              <td>{{ p.handled }}</td>
              <td :style="{ color: p.reworkRate > 30 ? 'var(--danger)' : p.reworkRate > 0 ? 'var(--warn)' : 'var(--ok)' }">
                {{ p.reworkRate }}%
              </td>
              <td>{{ p.totalRework }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="panel">
        <h3>返工流水（最近）</h3>
        <table v-if="recentRework.length">
          <thead><tr><th>单号</th><th>负责人</th><th>返工次数</th><th>更新</th></tr></thead>
          <tbody>
            <tr v-for="o in recentRework" :key="o.id">
              <td class="mono">{{ o.id }}</td>
              <td>{{ o.assignee ?? '—' }}</td>
              <td style="color: var(--danger)">{{ o.reworkCount }}</td>
              <td class="muted">{{ fmt(o.updatedAt) }}</td>
            </tr>
          </tbody>
        </table>
        <p v-else class="muted" style="padding: 16px; text-align: center">🎉 所选范围内零返工</p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.kpi-row { display: flex; gap: 12px; }
.warn-kpi .num { color: var(--danger); }
.dash-grid { display: grid; grid-template-columns: 1fr 1.4fr; gap: 12px; }
.dash-grid .panel:last-child { grid-column: 1 / -1; }
.bars { display: flex; flex-direction: column; gap: 10px; }
.bar-row { display: grid; grid-template-columns: 70px 1fr 36px; align-items: center; gap: 8px; }
.bar-label { color: var(--muted); font-size: 12px; }
.bar-track { background: var(--panel-2); border-radius: 4px; height: 18px; overflow: hidden; }
.bar-fill { height: 100%; border-radius: 4px; background: var(--accent); transition: width 0.3s; }
.bar-fill.passed, .bar-fill.done { background: var(--ok); }
.bar-fill.rejected { background: var(--danger); }
.bar-fill.qc { background: #d3a545; }
.bar-fill.modeling { background: var(--accent); }
.bar-num { text-align: right; font-variant-numeric: tabular-nums; }
.mini-bar { position: relative; background: var(--panel-2); border-radius: 4px; height: 16px; min-width: 90px; }
.mini-fill { position: absolute; inset: 0 auto 0 0; background: var(--accent-2); border-radius: 4px; }
.mini-bar span { position: relative; padding-left: 6px; font-size: 12px; line-height: 16px; }
</style>
