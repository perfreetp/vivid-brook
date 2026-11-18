<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import { useWorkStore } from '../stores/work';
import { DEFAULT_PARAMS } from '../stores/terrain';
import { SLOPE_GRADE_LABELS } from '../terrain/config';
import type { TerrainParams } from '../types';

const work = useWorkStore();
const router = useRouter();

const showCreate = ref(false);
const title = ref('');
const requirement = ref('');
const seed = ref(20260101);
const assignee = ref<string | null>(null);
const params = ref<TerrainParams>({ ...DEFAULT_PARAMS });
const filter = ref<string>('all');
const formError = ref('');

const filtered = computed(() =>
  filter.value === 'all' ? work.orders : work.orders.filter((o) => o.status === filter.value),
);

const statusLabel: Record<string, string> = {
  pending: '待派单',
  modeling: '建模中',
  qc: '质检中',
  passed: '质检通过',
  rejected: '已打回',
  done: '已归档',
};

function openCreate() {
  title.value = '';
  requirement.value = '';
  seed.value = Math.floor(Math.random() * 90000000) + 10000000;
  params.value = { ...DEFAULT_PARAMS };
  assignee.value = null;
  formError.value = '';
  showCreate.value = true;
}

function submitCreate() {
  if (!title.value.trim()) {
    formError.value = '请填写需求标题';
    return;
  }
  const o = work.createOrder({
    title: title.value.trim(),
    requirement: requirement.value.trim(),
    seed: seed.value,
    params: { ...params.value },
    assignee: assignee.value,
  });
  showCreate.value = false;
  router.push(`/editor/${o.id}`);
}

function paramSummary(p: TerrainParams): string {
  return `坡${SLOPE_GRADE_LABELS[p.slopeGrade]} / 台${p.stepHeight.toFixed(2)}m / 碎石${Math.round(p.gravelDensity * 100)}% / 沟${p.trenchWidth.toFixed(2)}m / 水${p.waterDepth.toFixed(2)}m`;
}

function fmtTime(ts: number): string {
  const d = new Date(ts);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
</script>

<template>
  <div class="view">
    <div class="panel" style="margin-bottom: 12px">
      <div class="row" style="justify-content: space-between">
        <h3 style="margin: 0">客户测试需求单</h3>
        <div class="row">
          <select v-model="filter" style="width: 140px">
            <option value="all">全部状态</option>
            <option v-for="(lbl, key) in statusLabel" :key="key" :value="key">{{ lbl }}</option>
          </select>
          <button class="primary" @click="openCreate">+ 新建需求单</button>
        </div>
      </div>
    </div>

    <div class="panel">
      <table v-if="filtered.length">
        <thead>
          <tr>
            <th>单号</th><th>标题</th><th>参数摘要</th><th>seed</th><th>负责人</th>
            <th>状态</th><th>返工</th><th>更新时间</th><th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="o in filtered" :key="o.id">
            <td class="mono">{{ o.id }}</td>
            <td>
              {{ o.title }}
              <div class="muted" style="font-size: 11px">{{ o.requirement }}</div>
            </td>
            <td style="font-size: 11px; max-width: 260px">{{ paramSummary(o.params) }}</td>
            <td class="mono">{{ o.seed }}</td>
            <td>
              <template v-if="o.assignee">{{ o.assignee }}</template>
              <select
                v-else
                style="width: 110px"
                :value="''"
                @change="work.assignOrder(o.id, ($event.target as HTMLSelectElement).value)"
              >
                <option value="" disabled>派给…</option>
                <option v-for="m in work.modelers" :key="m.name" :value="m.name">{{ m.name }}</option>
              </select>
            </td>
            <td :class="`status-${o.status}`">{{ statusLabel[o.status] }}</td>
            <td>
              <span :style="{ color: o.reworkCount ? 'var(--danger)' : 'var(--muted)' }">{{ o.reworkCount }}</span>
            </td>
            <td class="muted">{{ fmtTime(o.updatedAt) }}</td>
            <td>
              <div class="row">
                <button @click="router.push(`/editor/${o.id}`)">
                  {{ work.currentUser.role === 'modeler' ? '去建模' : '查看' }}
                </button>
                <button v-if="o.status === 'passed'" @click="work.markDone(o.id)">归档</button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
      <p v-else class="muted" style="padding: 24px; text-align: center">暂无需求单，点击右上角「新建需求单」开始。</p>
    </div>

    <!-- 建单弹层 -->
    <div v-if="showCreate" class="modal-mask" @click.self="showCreate = false">
      <div class="panel modal">
        <h3>新建测试场地需求单</h3>
        <div style="margin-bottom: 10px">
          <label>需求标题 *</label>
          <input v-model="title" placeholder="例如：爬坡 + 台阶综合耐力测试" />
        </div>
        <div style="margin-bottom: 10px">
          <label>客户测试需求描述</label>
          <textarea v-model="requirement" placeholder="测试目的、机器人型号、通过性判定标准等"></textarea>
        </div>
        <div class="grid2">
          <div>
            <label>随机种子 seed</label>
            <input type="number" v-model.number="seed" />
          </div>
          <div>
            <label>派单给（可稍后再派）</label>
            <select v-model="assignee">
              <option :value="null">暂不派单</option>
              <option v-for="m in work.modelers" :key="m.name" :value="m.name">{{ m.name }}</option>
            </select>
          </div>
        </div>
        <div class="grid2" style="margin-top: 10px">
          <div>
            <label>坡度档位：{{ SLOPE_GRADE_LABELS[params.slopeGrade] }}</label>
            <input type="range" min="0" max="5" step="1" v-model.number="params.slopeGrade" />
          </div>
          <div>
            <label>台阶高度 {{ params.stepHeight.toFixed(2) }}m</label>
            <input type="range" min="0" max="0.4" step="0.01" v-model.number="params.stepHeight" />
          </div>
          <div>
            <label>碎石密度 {{ Math.round(params.gravelDensity * 100) }}%</label>
            <input type="range" min="0" max="1" step="0.05" v-model.number="params.gravelDensity" />
          </div>
          <div>
            <label>沟槽宽度 {{ params.trenchWidth.toFixed(2) }}m</label>
            <input type="range" min="0" max="2" step="0.05" v-model.number="params.trenchWidth" />
          </div>
          <div>
            <label>涉水深度 {{ params.waterDepth.toFixed(2) }}m</label>
            <input type="range" min="0" max="1.2" step="0.05" v-model.number="params.waterDepth" />
          </div>
        </div>
        <p v-if="formError" style="color: var(--danger); margin: 10px 0 0">{{ formError }}</p>
        <div class="row" style="justify-content: flex-end; margin-top: 14px">
          <button @click="showCreate = false">取消</button>
          <button class="primary" @click="submitCreate">建单并进入编辑器</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.modal-mask {
  position: fixed; inset: 0;
  background: rgba(5, 9, 14, 0.65);
  display: flex; align-items: center; justify-content: center;
  z-index: 50;
}
.modal { width: 640px; max-height: 88vh; overflow: auto; }
</style>
