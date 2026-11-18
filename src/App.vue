<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import { useWorkStore } from './stores/work';

const work = useWorkStore();
const route = useRoute();
const tabs = [
  { to: '/orders', label: '需求单' },
  { to: '/editor', label: '生成编辑' },
  { to: '/qc', label: '质检' },
  { to: '/dashboard', label: '看板' },
];
const pageTitle = computed(() => (route.meta.title as string) ?? '');
</script>

<template>
  <header class="app-header">
    <div class="brand">野外测试场 · 过程式路面编辑器</div>
    <nav class="nav">
      <RouterLink v-for="t in tabs" :key="t.to" :to="t.to">{{ t.label }}</RouterLink>
    </nav>
    <div class="user-box">
      <span class="muted">{{ pageTitle }}</span>
      <select :value="work.currentUser.name" @change="work.switchUser(($event.target as HTMLSelectElement).value)">
        <option v-for="u in work.users" :key="u.name" :value="u.name">
          {{ u.label }} · {{ u.name }}
        </option>
      </select>
    </div>
  </header>
  <RouterView />
</template>
