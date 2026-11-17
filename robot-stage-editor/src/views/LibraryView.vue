<template>
  <div class="page">
    <div class="page-head">
      <h2>机器人素材库</h2>
      <button class="btn primary" @click="openAdd">＋ 新增型号</button>
    </div>

    <table class="tbl">
      <thead>
        <tr><th>型号名称</th><th>类型</th><th>占位半径</th><th>速度 m/s</th><th>载重 kg</th><th>标识色</th><th>说明</th><th>操作</th></tr>
      </thead>
      <tbody>
        <tr v-for="m in store.materials" :key="m.id">
          <td><span class="dot" :style="{ background: m.color }"></span>{{ m.name }}</td>
          <td>{{ kindName(m.kind) }}</td>
          <td>{{ m.radius }}</td>
          <td>{{ m.speed }}</td>
          <td>{{ m.payload }}</td>
          <td><span class="color-chip" :style="{ background: m.color }"></span>{{ m.color }}</td>
          <td class="desc">{{ m.desc }}</td>
          <td>
            <button class="btn sm" @click="openEdit(m)">编辑</button>
            <button class="btn sm danger" @click="remove(m.id)">删除</button>
          </td>
        </tr>
      </tbody>
    </table>

    <div v-if="editing" class="modal-mask" @click.self="editing = null">
      <div class="modal">
        <h3>{{ editing.id ? '编辑型号' : '新增型号' }}</h3>
        <label>型号名称<input v-model="editing.name" /></label>
        <div class="row2">
          <label>底盘类型
            <select v-model="editing.kind">
              <option value="wheel">轮式</option><option value="leg">双足</option><option value="spider">六足</option>
            </select>
          </label>
          <label>标识色<input type="color" v-model="editing.color" /></label>
        </div>
        <div class="row3">
          <label>占位半径<input type="number" v-model.number="editing.radius" min="8" /></label>
          <label>速度<input type="number" v-model.number="editing.speed" step="0.1" /></label>
          <label>载重<input type="number" v-model.number="editing.payload" /></label>
        </div>
        <label>说明<input v-model="editing.desc" /></label>
        <div class="modal-actions">
          <button class="btn" @click="editing = null">取消</button>
          <button class="btn primary" @click="save">保存型号</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { store, upsertMaterial, removeMaterial, showToast } from '../store/store.js'

const editing = ref(null)
const kindName = (k) => ({ wheel: '轮式', leg: '双足人形', spider: '六足' }[k] || k)

function openAdd() {
  editing.value = { name: '新型号', kind: 'wheel', radius: 20, speed: 1, payload: 5, color: '#58a6ff', desc: '' }
}
function openEdit(m) { editing.value = { ...m } }
function save() {
  if (!editing.value.id) editing.value.id = 'rb-' + Math.random().toString(36).slice(2, 8)
  upsertMaterial(editing.value)
  editing.value = null
  showToast('素材库已更新并持久化')
}
function remove(id) {
  if (confirm('删除该型号？已投放到画布的实例不受影响。')) { removeMaterial(id); showToast('已删除型号') }
}
</script>

<style scoped>
.page { padding: 24px 28px; height: 100%; overflow: auto; }
.page-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 18px; }
h2 { margin: 0; font-size: 20px; }
.tbl { width: 100%; border-collapse: collapse; background: var(--panel); border-radius: 12px; overflow: hidden; }
.tbl th, .tbl td { padding: 11px 14px; text-align: left; font-size: 13px; border-bottom: 1px solid var(--line); }
.tbl th { color: var(--muted); font-weight: 500; background: var(--panel2); }
.tbl tr:hover td { background: rgba(88, 166, 255, 0.04); }
.dot { display: inline-block; width: 10px; height: 10px; border-radius: 50%; margin-right: 8px; }
.color-chip { display: inline-block; width: 16px; height: 16px; border-radius: 4px; margin-right: 6px; vertical-align: middle; border: 1px solid rgba(255,255,255,0.2); }
.desc { color: var(--muted); max-width: 260px; }
.sm { padding: 4px 10px; font-size: 12px; margin-right: 6px; }
.modal-mask { position: fixed; inset: 0; background: rgba(4, 6, 12, 0.65); display: flex; align-items: center; justify-content: center; z-index: 50; }
.modal { background: var(--panel); border: 1px solid var(--line); border-radius: 14px; padding: 24px; width: 480px; display: grid; gap: 14px; }
.modal h3 { margin: 0; }
.modal label { display: grid; gap: 6px; font-size: 13px; color: var(--muted); }
.row2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.row3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
.modal-actions { display: flex; justify-content: flex-end; gap: 10px; }
</style>
