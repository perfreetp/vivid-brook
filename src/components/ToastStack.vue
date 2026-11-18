<template>
  <div class="toast-stack">
    <div v-for="t in state.toasts" :key="t.id" :class="['toast', t.type]" @click="dismissToast(t.id)">
      {{ t.message }}
    </div>
  </div>
</template>

<script setup>
import { useEditor } from '../editor/store.js'
const { state, dismissToast } = useEditor()
</script>
