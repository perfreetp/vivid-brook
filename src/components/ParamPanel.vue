<script setup lang="ts">
import { computed } from 'vue';
import { SLOPE_GRADE_LABELS } from '../terrain/config';
import type { TerrainParams } from '../types';

const props = defineProps<{
  modelValue: TerrainParams;
  seed: number;
  disabled?: boolean;
}>();
const emit = defineEmits<{
  'update:modelValue': [v: TerrainParams];
  'update:seed': [v: number];
  change: [key: keyof TerrainParams, value: number];
  reseed: [];
  regenerate: [];
}>();

const p = computed(() => props.modelValue);

function set(key: keyof TerrainParams, value: number) {
  emit('update:modelValue', { ...p.value, [key]: value });
  emit('change', key, value);
}
function setSeed(v: number) {
  emit('update:seed', v);
}
</script>

<template>
  <div class="param-form">
    <div class="row" style="margin-bottom: 12px">
      <div style="flex: 1">
        <label>随机种子 seed（同 seed + 同参数 = 完全一致）</label>
        <input
          type="number"
          :value="seed"
          :disabled="disabled"
          @change="setSeed(Number(($event.target as HTMLInputElement).value))"
        />
      </div>
      <div style="align-self: end">
        <button :disabled="disabled" title="换一个种子" @click="emit('reseed')">🎲</button>
      </div>
    </div>

    <div style="margin-bottom: 12px">
      <label>坡度档位：{{ SLOPE_GRADE_LABELS[p.slopeGrade] }}</label>
      <div class="range-row">
        <input
          type="range" min="0" max="5" step="1"
          :value="p.slopeGrade" :disabled="disabled"
          @input="set('slopeGrade', Number(($event.target as HTMLInputElement).value))"
        />
        <span class="range-val mono">档 {{ p.slopeGrade }}</span>
      </div>
    </div>

    <div style="margin-bottom: 12px">
      <label>台阶高度（米，0 关闭）</label>
      <div class="range-row">
        <input
          type="range" min="0" max="0.4" step="0.01"
          :value="p.stepHeight" :disabled="disabled"
          @input="set('stepHeight', Number(($event.target as HTMLInputElement).value))"
        />
        <span class="range-val mono">{{ p.stepHeight.toFixed(2) }}m</span>
      </div>
    </div>

    <div style="margin-bottom: 12px">
      <label>碎石密度（0 关闭）</label>
      <div class="range-row">
        <input
          type="range" min="0" max="1" step="0.05"
          :value="p.gravelDensity" :disabled="disabled"
          @input="set('gravelDensity', Number(($event.target as HTMLInputElement).value))"
        />
        <span class="range-val mono">{{ Math.round(p.gravelDensity * 100) }}%</span>
      </div>
    </div>

    <div style="margin-bottom: 12px">
      <label>沟槽宽度（米，0 关闭）</label>
      <div class="range-row">
        <input
          type="range" min="0" max="2" step="0.05"
          :value="p.trenchWidth" :disabled="disabled"
          @input="set('trenchWidth', Number(($event.target as HTMLInputElement).value))"
        />
        <span class="range-val mono">{{ p.trenchWidth.toFixed(2) }}m</span>
      </div>
    </div>

    <div style="margin-bottom: 12px">
      <label>涉水深度（米，0 关闭）</label>
      <div class="range-row">
        <input
          type="range" min="0" max="1.2" step="0.05"
          :value="p.waterDepth" :disabled="disabled"
          @input="set('waterDepth', Number(($event.target as HTMLInputElement).value))"
        />
        <span class="range-val mono">{{ p.waterDepth.toFixed(2) }}m</span>
      </div>
    </div>

    <button class="primary" style="width: 100%" :disabled="disabled" @click="emit('regenerate')">
      整片重新生成（锁定区保留 + 边界过渡）
    </button>
  </div>
</template>
