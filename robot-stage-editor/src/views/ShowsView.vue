<template>
  <div class="page">
    <div class="page-head">
      <h2>剧目档案</h2>
      <button class="btn primary" @click="create">＋ 新建剧目</button>
    </div>

    <div class="grid-cards">
      <div v-for="show in store.shows" :key="show.id" class="card">
        <div class="card-top">
          <h3>{{ show.name }}</h3>
          <span class="tag" :class="show.status">{{ show.status === 'scheduled' ? '已排期' : '草稿' }}</span>
        </div>
        <div class="meta">
          <div>场地：{{ show.schedule.venue || '未设置' }}</div>
          <div>日期：{{ show.schedule.date || '未设置' }}　时段：{{ show.schedule.slot || '未设置' }}</div>
          <div>图形 {{ show.shapes.length }} 个 · 机器人 {{ show.shapes.filter(s => s.type === 'robot').length }} 台 ·
            路径 {{ show.shapes.filter(s => s.layer === 'path').length }} 条</div>
        </div>
        <div class="card-actions">
          <button class="btn primary" @click="openShow(show.id)">打开走位画布</button>
          <button class="btn" @click="editMeta(show)">档案设置</button>
          <button class="btn danger" @click="remove(show.id)">删除</button>
        </div>
      </div>
      <div v-if="!store.shows.length" class="empty">还没有剧目，点击右上角新建</div>
    </div>

    <!-- 档案设置弹窗 -->
    <div v-if="editing" class="modal-mask" @click.self="editing = null">
      <div class="modal">
        <h3>剧目档案</h3>
        <label>剧目名称<input v-model="editing.name" /></label>
        <label>演出场地<input v-model="editing.schedule.venue" placeholder="如：一号厅" /></label>
        <div class="row2">
          <label>演出日期<input type="date" v-model="editing.schedule.date" /></label>
          <label>时段<input v-model="editing.schedule.slot" placeholder="19:30-20:30" /></label>
        </div>
        <div class="row2">
          <label>舞台宽<input type="number" v-model.number="editing.stage.width" min="200" /></label>
          <label>舞台高<input type="number" v-model.number="editing.stage.height" min="200" /></label>
        </div>
        <div class="modal-actions">
          <button class="btn" @click="editing = null">取消</button>
          <button class="btn primary" @click="saveMeta">保存</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { store, createShow, deleteShow, openShow, showToast } from '../store/store.js'

const editing = ref(null)

function create() {
  const s = createShow('新剧目 ' + (store.shows.length + 1))
  editing.value = s
}
function editMeta(show) { editing.value = show }
function saveMeta() { editing.value = null; showToast('剧目档案已保存') }
function remove(id) {
  if (confirm('确定删除该剧目及其全部走位数据？')) { deleteShow(id); showToast('已删除') }
}
</script>

<style scoped>
.page { padding: 24px 28px; height: 100%; overflow: auto; }
.page-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; }
h2 { margin: 0; font-size: 20px; }
.grid-cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 16px; }
.card { background: var(--panel); border: 1px solid var(--line); border-radius: 12px; padding: 18px; }
.card-top { display: flex; justify-content: space-between; align-items: center; }
.card h3 { margin: 0 0 10px; font-size: 16px; }
.meta { color: var(--muted); font-size: 13px; display: grid; gap: 4px; margin-bottom: 14px; }
.card-actions { display: flex; gap: 8px; flex-wrap: wrap; }
.empty { color: var(--muted); padding: 40px; }
.modal-mask { position: fixed; inset: 0; background: rgba(4, 6, 12, 0.65); display: flex; align-items: center; justify-content: center; z-index: 50; }
.modal { background: var(--panel); border: 1px solid var(--line); border-radius: 14px; padding: 24px; width: 460px; display: grid; gap: 14px; }
.modal h3 { margin: 0; }
.modal label { display: grid; gap: 6px; font-size: 13px; color: var(--muted); }
.row2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.modal-actions { display: flex; justify-content: flex-end; gap: 10px; }
</style>
