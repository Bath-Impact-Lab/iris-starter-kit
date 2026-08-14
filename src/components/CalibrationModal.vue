<script setup lang="ts">
import { onBeforeUnmount, ref } from 'vue';
import type { CameraConfig } from '../types';
import AppModal from './AppModal.vue';

const props = defineProps<{
  open: boolean;
  cameras: CameraConfig[];
}>();

const emit = defineEmits<{
  complete: [];
  close: [];
}>();

const status = ref<'idle' | 'running' | 'done'>('idle');
const progress = ref(0);
const error = ref<string | null>(null);
const sessionId = ref<string | undefined>();
let cleanupPoseListener: (() => void) | null = null;
let cleanupCliListener: (() => void) | null = null;

function updateFromCli(payload: { channel: string; line: string }) {
  const text = payload.line ?? '';
  if (!text) return;

  if (/calib|calibration|startup/i.test(text)) {
    progress.value = Math.min(90, progress.value + 15);
  }

  if (/done|complete|ready|success/i.test(text)) {
    status.value = 'done';
    progress.value = 100;
    emit('complete');
  }
}

function getIrisApi(): any {
  return (window as any).irisStarter ?? (window as any).starterKit ?? (window as any).irisDispatcher ?? null;
}

function attachListeners() {
  const api = getIrisApi();
  if (!api?.onPoseData || !api?.onCliOutput) return;

  cleanupPoseListener = api.onPoseData((frame: unknown) => {
    const value = frame as Record<string, any>;
    if (!value || typeof value !== 'object') return;

    const joints = value.joints ?? value.keypoints ?? value.people ?? value.pose ?? [];
    const hasPoseData = Array.isArray(joints) ? joints.length > 0 : Boolean(joints);
    if (hasPoseData) {
      status.value = 'done';
      progress.value = 100;
      emit('complete');
    }
  });

  cleanupCliListener = api.onCliOutput((payload: { channel: string; line: string }) => {
    updateFromCli(payload);
  });
}

function detachListeners() {
  cleanupPoseListener?.();
  cleanupPoseListener = null;
  cleanupCliListener?.();
  cleanupCliListener = null;
}

async function startCalibration() {
  if (status.value === 'running') return;

  const api = getIrisApi();
  if (!api || typeof api.startPoseStream !== 'function') {
    error.value = 'IRIS backend is unavailable';
    status.value = 'idle';
    progress.value = 0;
    return;
  }

  status.value = 'running';
  progress.value = 0;
  error.value = null;
  attachListeners();

  try {
    const result = await api.startPoseStream({
      mode: 'da3_startup',
      cameras: props.cameras,
      calibration: { type: 'da3_startup' },
      output: { shm_name: 'iris_shm_ipc' },
    });

    if (!result.ok) {
      throw new Error(result.error || 'IRIS calibration failed to start');
    }

    sessionId.value = result.sessionId;
    progress.value = 35;
  } catch (err) {
    detachListeners();
    error.value = err instanceof Error ? err.message : 'IRIS calibration failed to start';
    status.value = 'idle';
    progress.value = 0;
  }
}

async function stopCalibration() {
  const api = getIrisApi();

  if (!sessionId.value) {
    detachListeners();
    status.value = 'idle';
    progress.value = 0;
    return;
  }

  if (!api?.stopSession) {
    detachListeners();
    sessionId.value = undefined;
    status.value = 'idle';
    progress.value = 0;
    return;
  }

  try {
    await api.stopSession(sessionId.value);
  } catch {
    // ignore shutdown errors; UI can recover gracefully
  } finally {
    detachListeners();
    sessionId.value = undefined;
    if (status.value === 'running') {
      status.value = 'idle';
      progress.value = 0;
    }
  }
}

function onStart() {
  if (status.value === 'done') {
    emit('complete');
    return;
  }
  void startCalibration();
}

function onClose() {
  void stopCalibration();
  emit('close');
}

onBeforeUnmount(() => {
  void stopCalibration();
});
</script>

<template>
  <AppModal title="Calibration" :open="open" @close="onClose">
    <p class="lead">IRIS will auto-calibrate the stage using DA3. Keep the capture area clear.</p>

    <div class="progress-wrap">
      <div class="progress-bar">
        <div class="progress-fill" :style="{ width: `${progress}%` }" />
      </div>
      <span class="progress-label">
        <template v-if="status === 'idle' && !error">Ready to calibrate</template>
        <template v-else-if="status === 'running'">Calibrating… {{ progress }}%</template>
        <template v-else-if="error">{{ error }}</template>
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
