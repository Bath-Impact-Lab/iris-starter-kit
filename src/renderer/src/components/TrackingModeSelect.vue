<script setup lang="ts">
import type { TrackingMode } from '../types';

defineProps<{ disabled?: boolean }>();
const mode = defineModel<TrackingMode>({ required: true });
</script>

<template>
  <label class="field">
    <span>People</span>
    <select v-model="mode" :disabled="disabled">
      <option value="single">Single subject</option>
      <option value="multi">Multiple people</option>
    </select>
    <small>
      {{ mode === 'single'
        ? 'Locks pose output to one stable tracked identity and uses a lighter detector cadence.'
        : 'Tracks and renders every associated person; detection runs on every frame.' }}
    </small>
  </label>
</template>

<style scoped>
.field {
  display: flex;
  flex-direction: column;
  gap: 5px;
  color: #c7cbd6;
  font-size: 12px;
}

select {
  border: 1px solid #2a3140;
  border-radius: 4px;
  background: #1e2430;
  color: #e8eaed;
  padding: 7px 9px;
}

small { color: #8b93a7; line-height: 1.35; }
</style>
