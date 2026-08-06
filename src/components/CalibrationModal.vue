<script setup lang="ts">
import { ref } from 'vue';
import AppModal from './AppModal.vue';

defineProps<{
  open: boolean;
}>();

const emit = defineEmits<{
  complete: [];
  close: [];
}>();

const status = ref<'idle' | 'running' | 'done'>('idle');
const progress = ref(0);

async function startCalibration() {
  if (status.value === 'running') return;

  status.value = 'running';
  progress.value = 0;

  // Mock DA3 calibration — replaced by IRIS backend in a later stage.
  await new Promise<void>((resolve) => {
    const tick = window.setInterval(() => {
      progress.value = Math.min(100, progress.value + 8);
      if (progress.value >= 100) {
        window.clearInterval(tick);
        status.value = 'done';
        resolve();
      }
    }, 200);
  });
}

function onStart() {
  if (status.value === 'done') {
    emit('complete');
    return;
  }
  void startCalibration();
}

function onClose() {
  emit('close');
}
</script>

<template>
  <AppModal title="Calibration" :open="open" @close="onClose">
    <p class="lead">IRIS will auto-calibrate the stage using DA3. Keep the capture area clear.</p>

    <div class="progress-wrap">
      <div class="progress-bar">
        <div class="progress-fill" :style="{ width: `${progress}%` }" />
      </div>
      <span class="progress-label">
        <template v-if="status === 'idle'">Ready to calibrate</template>
        <template v-else-if="status === 'running'">Calibrating… {{ progress }}%</template>
        <template v-else>Calibration complete</template>
      </span>
    </div>

    <template #footer>
      <button type="button" class="btn primary" :disabled="status === 'running'" @click="onStart">
        {{ status === 'done' ? 'Start capture' : 'Calibrate' }}
      </button>
    </template>
  </AppModal>
</template>

<style scoped>
.lead {
  margin: 0 0 20px;
  font-size: 13px;
  color: #9aa3b5;
}

.progress-wrap {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.progress-bar {
  height: 6px;
  background: #0f1115;
  border-radius: 3px;
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  background: #3b6fd9;
  transition: width 0.15s ease;
}

.progress-label {
  font-size: 12px;
  color: #8b93a7;
}

.btn {
  border-radius: 4px;
  border: 1px solid #2a3140;
  background: #1e2430;
  color: #e8eaed;
  padding: 8px 16px;
  font-size: 13px;
  cursor: pointer;
}

.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn.primary {
  background: #3b6fd9;
  border-color: #3b6fd9;
}

.btn.primary:hover:not(:disabled) {
  background: #4a7de6;
}
</style>
