<script setup lang="ts">
import { POSE_MODELS, poseModel, type PoseModelAvailability, type PoseModelId } from '../../../shared/poseModels';

defineProps<{ models: PoseModelAvailability[]; disabled?: boolean }>();
const selected = defineModel<PoseModelId>({ required: true });
</script>

<template>
  <label class="pose-model">
    <span>Pose model</span>
    <select v-model="selected" :disabled="disabled || !models.length">
      <option v-for="model in POSE_MODELS" :key="model.id" :value="model.id"
        :disabled="!models.find(item => item.id === model.id)?.available">
        {{ model.label }}{{ models.find(item => item.id === model.id)?.available ? '' : ' — Not installed' }}
      </option>
    </select>
    <small>{{ models.length ? poseModel(selected).description : 'Checking installed models…' }}</small>
  </label>
</template>

<style scoped>
.pose-model { display: grid; gap: 8px; margin: 12px 0; font-size: 13px; }
select { width: 100%; padding: 9px; border: 1px solid #354055; border-radius: 5px; background: #1e2430; color: #e8eaed; }
small { color: #a6b8cf; line-height: 1.4; }
</style>
