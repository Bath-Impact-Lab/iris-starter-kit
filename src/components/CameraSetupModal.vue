<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import type { CameraConfig, CameraDevice } from '../types';
import { FPS_OPTIONS, RESOLUTIONS, ROTATION_OPTIONS } from '../data/mock';
import AppModal from './AppModal.vue';

const props = defineProps<{
  open: boolean;
}>();

const emit = defineEmits<{
  continue: [cameras: CameraConfig[]];
  close: [];
}>();

const cameras = ref<CameraConfig[]>([]);

function defaultConfig(device: CameraDevice, index: number): CameraConfig {
  return {
    deviceId: device.id,
    label: device.label,
    resolution: index === 0 ? '1920x1080' : '1280x720',
    fps: 30,
    rotation: index === 0 ? 0 : 90,
  };
}

async function loadCameras() {
  const devices = await window.irisStarter.listCameras();
  cameras.value = devices.map((device, index) => defaultConfig(device, index));
}

onMounted(() => {
  void loadCameras();
});

watch(
  () => props.open,
  (isOpen) => {
    if (isOpen && cameras.value.length === 0) {
      void loadCameras();
    }
  },
);

function onContinue() {
  emit('continue', cameras.value);
}

function onClose() {
  emit('close');
}
</script>

<template>
  <AppModal title="Camera setup" :open="open" @close="onClose">
    <p class="lead">Detected cameras. Set resolution, FPS, and rotation for each.</p>

    <div v-for="cam in cameras" :key="cam.deviceId" class="cam-row">
      <div class="cam-name">{{ cam.label }}</div>

      <label class="field">
        <span>Resolution</span>
        <select v-model="cam.resolution">
          <option v-for="r in RESOLUTIONS" :key="r" :value="r">{{ r }}</option>
        </select>
      </label>

      <label class="field">
        <span>FPS</span>
        <select v-model.number="cam.fps">
          <option v-for="f in FPS_OPTIONS" :key="f" :value="f">{{ f }}</option>
        </select>
      </label>

      <label class="field">
        <span>Rotation</span>
        <select v-model.number="cam.rotation">
          <option v-for="deg in ROTATION_OPTIONS" :key="deg" :value="deg">{{ deg }}°</option>
        </select>
      </label>
    </div>

    <template #footer>
      <button type="button" class="btn primary" @click="onContinue">Continue</button>
    </template>
  </AppModal>
</template>

<style scoped>
.lead {
  margin: 0 0 16px;
  font-size: 13px;
  color: #9aa3b5;
}

.cam-row {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: 12px;
  align-items: end;
  padding: 14px 0;
  border-bottom: 1px solid #252b38;
}

.cam-row:last-child {
  border-bottom: none;
}

.cam-name {
  grid-column: 1 / -1;
  font-size: 13px;
  font-weight: 600;
  margin-bottom: 4px;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 11px;
  color: #8b93a7;
}

.field select {
  background: #0f1115;
  border: 1px solid #2a3140;
  border-radius: 4px;
  color: #e8eaed;
  padding: 6px 8px;
  font-size: 13px;
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

.btn.primary {
  background: #3b6fd9;
  border-color: #3b6fd9;
}

.btn.primary:hover {
  background: #4a7de6;
}
</style>
