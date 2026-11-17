<template>
  <div class="app-shell">
    <header class="topbar">
      <div class="brand">
        <span class="logo">◈</span>
        <span>机器人剧场 · 走位与地面标线矢量编辑器</span>
      </div>
      <nav class="nav">
        <button v-for="v in views" :key="v.key" :class="{ active: store.view === v.key }" @click="store.view = v.key">
          {{ v.label }}
        </button>
      </nav>
    </header>

    <main class="content">
      <ShowsView v-if="store.view === 'shows'" />
      <CanvasView v-else-if="store.view === 'canvas'" />
      <LibraryView v-else-if="store.view === 'library'" />
      <AdminView v-else-if="store.view === 'admin'" />
    </main>

    <transition name="toast">
      <div v-if="store.toast" class="toast">{{ store.toast }}</div>
    </transition>
  </div>
</template>

<script setup>
import { onMounted, onBeforeUnmount } from 'vue'
import { store, undo, redo } from './store/store.js'
import ShowsView from './views/ShowsView.vue'
import CanvasView from './views/CanvasView.vue'
import LibraryView from './views/LibraryView.vue'
import AdminView from './views/AdminView.vue'

const views = [
  { key: 'shows', label: '剧目列表' },
  { key: 'canvas', label: '走位画布' },
  { key: 'library', label: '素材库' },
  { key: 'admin', label: '后台' }
]

function onKey(e) {
  const mod = e.ctrlKey || e.metaKey
  if (!mod) return
  const k = e.key.toLowerCase()
  if (k === 'z' && !e.shiftKey) { e.preventDefault(); undo() }
  else if ((k === 'z' && e.shiftKey) || k === 'y') { e.preventDefault(); redo() }
}
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<style>
:root {
  --bg: #0b0e16; --panel: #121624; --panel2: #171c2c; --line: #2a3247;
  --text: #e6e9f2; --muted: #8b98b5; --accent: #58a6ff; --green: #7ee787;
  --purple: #d2a8ff; --orange: #ffb84d; --red: #ff6b6b;
}
* { box-sizing: border-box; }
html, body, #app { height: 100%; margin: 0; }
body { background: var(--bg); color: var(--text); font: 14px/1.5 "Segoe UI", "Microsoft YaHei", sans-serif; }
.app-shell { display: flex; flex-direction: column; height: 100%; }
.topbar {
  display: flex; align-items: center; justify-content: space-between;
  padding: 0 20px; height: 56px; background: var(--panel); border-bottom: 1px solid var(--line); flex: 0 0 auto;
}
.brand { display: flex; align-items: center; gap: 10px; font-weight: 600; letter-spacing: 0.5px; }
.logo { color: var(--accent); font-size: 20px; }
.nav { display: flex; gap: 4px; }
.nav button {
  background: transparent; border: 1px solid transparent; color: var(--muted);
  padding: 8px 16px; border-radius: 8px; cursor: pointer; font-size: 14px;
}
.nav button:hover { color: var(--text); background: var(--panel2); }
.nav button.active { color: var(--accent); background: rgba(88, 166, 255, 0.12); border-color: rgba(88, 166, 255, 0.35); }
.content { flex: 1; min-height: 0; }
.toast {
  position: fixed; bottom: 28px; left: 50%; transform: translateX(-50%);
  background: #1d2436; border: 1px solid var(--accent); color: var(--text);
  padding: 10px 22px; border-radius: 10px; z-index: 100; box-shadow: 0 8px 30px rgba(0, 0, 0, 0.5);
}
.toast-enter-active, .toast-leave-active { transition: all 0.25s; }
.toast-enter-from, .toast-leave-to { opacity: 0; transform: translateX(-50%) translateY(10px); }
button { font-family: inherit; }
input, select, textarea {
  background: var(--panel2); border: 1px solid var(--line); color: var(--text);
  border-radius: 6px; padding: 7px 10px; font-size: 13px; outline: none;
}
input:focus, select:focus { border-color: var(--accent); }
.btn {
  background: var(--panel2); border: 1px solid var(--line); color: var(--text);
  padding: 8px 14px; border-radius: 8px; cursor: pointer; font-size: 13px;
}
.btn:hover { border-color: var(--accent); color: var(--accent); }
.btn.primary { background: rgba(88, 166, 255, 0.16); border-color: var(--accent); color: var(--accent); }
.btn.danger:hover { border-color: var(--red); color: var(--red); }
.btn:disabled { opacity: 0.4; cursor: not-allowed; }
.tag { display: inline-block; padding: 2px 9px; border-radius: 999px; font-size: 12px; }
.tag.draft { background: rgba(139, 152, 181, 0.18); color: var(--muted); }
.tag.scheduled { background: rgba(126, 231, 135, 0.15); color: var(--green); }
</style>
