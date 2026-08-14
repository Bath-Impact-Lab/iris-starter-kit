<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import type { CameraConfig, CameraDevice, Resolution } from '../types';
import { ROTATION_OPTIONS } from '../data/mock';
import { ensurePermission, getCommonFpsOptions, getCommonResolutionOptions, listVideoInputs, probeCamera, selectCommonConfig, startCameraLogger } from '../utils/camera-probe';
import AppModal from './AppModal.vue';

const props = defineProps<{
  open: boolean;
}>();

const emit = defineEmits<{
  continue: [cameras: CameraConfig[]];
  close: [];
}>();

const cameras = ref<CameraConfig[]>([]);
const deviceProfiles = ref<CameraDevice[]>([]);
const expandedIds = ref<Set<string>>(new Set());
const showAllPreviews = ref(false);
const videoElements = ref<Record<string, HTMLVideoElement | null>>({});
const activeStreams = ref<Record<string, MediaStream>>({});
const loading = ref(false);
const loggers = ref<Record<string, { stop: () => void }>>({});

const selectableResolutions = computed<Resolution[]>(() => {
  const common = getCommonResolutionOptions(deviceProfiles.value);
  if (common.length > 0) return common;

  const unique = new Set<Resolution>();
  for (const cam of cameras.value) {
    unique.add(cam.resolution);
  }
  const values = [...unique].sort((a, b) => {
    const aSize = Number(a.split('x')[0]) * Number(a.split('x')[1]);
    const bSize = Number(b.split('x')[0]) * Number(b.split('x')[1]);
    return bSize - aSize;
  });
  return values.length > 0 ? values : ['1280x720' as Resolution];
});

const selectableFps = computed<number[]>(() => {
  const common = getCommonFpsOptions(deviceProfiles.value);
  if (common.length > 0) return common;

  const values = [...new Set(cameras.value.map((cam) => cam.fps))].sort((a, b) => b - a);
  return values.length > 0 ? values : [30];
});

function defaultConfig(device: CameraDevice, index: number): CameraConfig {
  const friendlyLabel = device.label && device.label.trim() ? device.label : `Camera ${index + 1}`;
  return {
    deviceId: device.id,
    label: friendlyLabel,
    resolution: device.suggestedResolution ?? (index === 0 ? '1920x1080' : '1280x720'),
    fps: device.suggestedFps ?? 30,
    rotation: device.defaultRotation ?? 0,
  };
}

async function loadCameras() {
  loading.value = true;
  try {
    await ensurePermission();
    const devices = await listVideoInputs();
    const probed = await Promise.all(devices.map((d) => probeCamera(d.deviceId)));
    deviceProfiles.value = probed as CameraDevice[];
    const common = selectCommonConfig(deviceProfiles.value);
    const preferredResolution = common.resolution ?? '1920x1080';
    const preferredFps = common.fps ?? 30;

    cameras.value = probed.map((device, index) => {
      const dev = device as CameraDevice;
      const base = defaultConfig(dev, index);
      // Load persisted per-device config only for label and rotation
      const persistedRaw = localStorage.getItem(`camera-config:${dev.id}`);
      let persisted: Partial<Record<string, any>> | null = null;
      try {
        persisted = persistedRaw ? JSON.parse(persistedRaw) : null;
      } catch {
        persisted = null;
      }

      return {
        ...base,
        label: persisted?.displayName ?? base.label,
        resolution: preferredResolution,
        fps: preferredFps,
        rotation: persisted?.rotation ?? base.rotation,
      } as CameraConfig;
    });
    try {
      console.log('[camera-setup] common config', common, 'final cameras', JSON.parse(JSON.stringify(cameras.value)));
    } catch {}
  } catch (err) {
    // fallback to existing bridge if present
    if ((window as any).starterKit && (window as any).starterKit.listCameras) {
      const devices = await (window as any).starterKit.listCameras();
      deviceProfiles.value = devices as CameraDevice[];
      cameras.value = devices.map((device: CameraDevice, index: number) => defaultConfig(device, index));
    } else {
      deviceProfiles.value = [];
      cameras.value = [];
    }
  } finally {
    loading.value = false;
  }
}

// After loading, auto-expand all and start previews; mark global best
async function postLoadSetup() {
  // dump full camera details to console for inspect element
  try {
    console.log('[camera-setup] cameras', JSON.parse(JSON.stringify(cameras.value)));
  } catch {}

  // expand all and start previews
  const all = new Set<string>();
  cameras.value.forEach((c) => all.add(c.deviceId));
  expandedIds.value = all;
  await nextTick();
  await Promise.all(cameras.value.map((c) => startPreview(c.deviceId)));
}

// Persist per-device config whenever user changes settings
watch(
  cameras,
  (next) => {
    next.forEach((cam) => {
      const key = `camera-config:${cam.deviceId}`;
      const prevRaw = localStorage.getItem(key);
      const prev = prevRaw ? JSON.parse(prevRaw) : {};
      const toStore = { ...(prev || {}), displayName: cam.label, rotation: cam.rotation };
      try {
        localStorage.setItem(key, JSON.stringify(toStore));
      } catch {
        // ignore storage failures
      }
    });
  },
  { deep: true },
);

function setVideoRef(deviceId: string) {
  return (el: HTMLVideoElement | null) => {
    videoElements.value[deviceId] = el;
    if (el && activeStreams.value[deviceId]) {
      el.srcObject = activeStreams.value[deviceId];
    }
  };
}

async function startPreview(deviceId: string) {
  if (activeStreams.value[deviceId]) {
    return;
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { deviceId: { exact: deviceId } } });
    activeStreams.value[deviceId] = stream;
    await nextTick();
    const video = videoElements.value[deviceId];
    if (video) {
      video.srcObject = stream;
      video.play().catch(() => {
        // ignore autoplay restrictions
      });
      // start logger for this preview
      try {
        const logger = startCameraLogger(video, deviceId);
        loggers.value[deviceId] = logger;
      } catch {
        // ignore logger failures
      }
    }
  } catch {
    // ignore preview failures; user can still configure camera settings
  }
}

function stopPreview(deviceId: string) {
  const stream = activeStreams.value[deviceId];
  if (!stream) {
    return;
  }

  stream.getTracks().forEach((track) => track.stop());
  delete activeStreams.value[deviceId];
  // stop logger if present
  const lg = loggers.value[deviceId];
  if (lg && lg.stop) {
    try { lg.stop(); } catch {}
    delete loggers.value[deviceId];
  }
}

function stopAllPreviews() {
  Object.keys(activeStreams.value).forEach((deviceId) => stopPreview(deviceId));
}

async function toggleCameraExpansion(deviceId: string) {
  const nextExpanded = new Set(expandedIds.value);
  if (nextExpanded.has(deviceId)) {
    nextExpanded.delete(deviceId);
    stopPreview(deviceId);
  } else {
    nextExpanded.add(deviceId);
    await startPreview(deviceId);
  }
  expandedIds.value = nextExpanded;
}

async function toggleAllPreviews() {
  showAllPreviews.value = !showAllPreviews.value;
  if (showAllPreviews.value) {
    cameras.value.forEach((cam) => expandedIds.value.add(cam.deviceId));
    await Promise.all(cameras.value.map((cam) => startPreview(cam.deviceId)));
  } else {
    expandedIds.value.clear();
    stopAllPreviews();
  }
}

watch(
  () => props.open,
  (isOpen) => {
    if (isOpen && cameras.value.length === 0) {
        void loadCameras().then(() => postLoadSetup());
    }
    if (!isOpen) {
      expandedIds.value.clear();
      showAllPreviews.value = false;
      stopAllPreviews();
    }
  },
);

onMounted(() => {
  void loadCameras().then(() => postLoadSetup());
});

onUnmounted(() => {
  stopAllPreviews();
});

function persistCameraConfig() {
  cameras.value.forEach((cam) => {
    const key = `camera-config:${cam.deviceId}`;
    const prevRaw = localStorage.getItem(key);
    const prev = prevRaw ? JSON.parse(prevRaw) : {};
    const next = { ...(prev || {}), displayName: cam.label, rotation: cam.rotation, resolution: cam.resolution, fps: cam.fps };
    try {
      localStorage.setItem(key, JSON.stringify(next));
    } catch {
      // ignore
    }
  });
}

function onContinue() {
  persistCameraConfig();
  emit('continue', cameras.value);
}

function onClose() {
  emit('close');
}

function onDisplayNameChange(cam: CameraConfig) {
  const key = `camera-config:${cam.deviceId}`;
  try {
    const prevRaw = localStorage.getItem(key);
    const prev = prevRaw ? JSON.parse(prevRaw) : {};
    const next = { ...(prev || {}), displayName: cam.label, rotation: cam.rotation, resolution: cam.resolution, fps: cam.fps };
    localStorage.setItem(key, JSON.stringify(next));
  } catch {
    // ignore
  }
}
</script>

<template>
  <AppModal title="Camera setup" :open="open" @close="onClose">
    <div class="header-row">
      <div>
        <p class="lead">Select your connected cameras and verify their configuration.</p>
      </div>
      <button type="button" class="btn ghost" @click="toggleAllPreviews">
        {{ showAllPreviews ? 'Hide previews' : 'Show previews' }}
      </button>
    </div>

    <div v-if="loading" class="loader">
      <div class="spinner" aria-hidden="true"></div>
      <div class="loader-text">Detecting cameras…</div>
    </div>
    <div v-else class="camera-list">
      <div v-for="cam in cameras" :key="cam.deviceId" class="camera-card">
        <button type="button" class="camera-summary" @click="toggleCameraExpansion(cam.deviceId)">
          <div>
            <div class="camera-title">{{ cam.label }}</div>
              <div v-if="!expandedIds.has(cam.deviceId)" class="camera-meta">{{ cam.resolution }} · {{ cam.fps }} fps · {{ cam.rotation }}°</div>
          </div>
            <span class="arrow">{{ expandedIds.has(cam.deviceId) ? '▲' : '▼' }}</span>
        </button>

        <div v-if="expandedIds.has(cam.deviceId)" class="camera-body">
          <div class="preview-panel">
            <video
              :ref="setVideoRef(cam.deviceId)"
              class="preview"
              autoplay
              muted
              playsinline
            />
            <div class="preview-overlay">Live camera preview</div>
          </div>

          <div class="config-grid">
            <label class="field field-full">
              <span>Display name</span>
              <input type="text" v-model="cam.label" @change="onDisplayNameChange(cam)" />
            </label>

            <label class="field">
              <span>Resolution</span>
              <select v-model="cam.resolution">
                <option v-for="r in selectableResolutions" :key="r" :value="r">{{ r }}</option>
              </select>
            </label>

            <label class="field">
              <span>FPS</span>
              <select v-model.number="cam.fps">
                <option v-for="f in selectableFps" :key="f" :value="f">{{ f }}</option>
              </select>
            </label>

            <label class="field">
              <span>Angle</span>
              <select v-model.number="cam.rotation">
                <option v-for="deg in ROTATION_OPTIONS" :key="deg" :value="deg">{{ deg }}°</option>
              </select>
            </label>
          </div>
        </div>
      </div>
    </div>

    <template #footer>
      <button type="button" class="btn primary" @click="onContinue">Continue</button>
    </template>
  </AppModal>
</template>

<style scoped>
.header-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 18px;
}

.lead {
  margin: 0;
  font-size: 13px;
  color: #e6eefb;
}

.subtext {
  margin: 6px 0 0;
  font-size: 12px;
  color: #8b93a7;
}

.camera-list {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(520px, 1fr));
  gap: 14px;
}

.camera-card {
  background: #161b24;
  border: 1px solid #232a36;
  border-radius: 12px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.camera-summary {
  width: 100%;
  background: none;
  border: none;
  color: inherit;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 18px 20px;
  cursor: pointer;
  text-align: left;
}

.camera-title {
  font-size: 14px;
  font-weight: 600;
  color: #f3f7ff;
}

.camera-meta {
  margin-top: 4px;
  font-size: 12px;
  color: #8b93a7;
}

.camera-summary .arrow {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 6px;
  margin-left: 12px;
  background: transparent;
  border-radius: 6px;
  color: #aeb8cc;
}

.loader {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  height: 140px;
  background: #0f1115;
  border: 1px solid #232a36;
  border-radius: 12px;
}

.loader-text {
  color: #c7d2e3;
  font-size: 13px;
}

.spinner {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  border: 3px solid rgba(255,255,255,0.08);
  border-top-color: #3b6fd9;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.camera-body {
  padding: 0 20px 20px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.preview-panel {
  position: relative;
  width: 100%;
  aspect-ratio: 4 / 3;
  background: #0d1118;
  border-radius: 10px;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
}

.preview {
  width: 100%;
  height: 100%;
  object-fit: cover;
  background: #0d1118;
}

.preview-overlay {
  position: absolute;
  bottom: 12px;
  left: 12px;
  background: rgba(10, 14, 22, 0.92);
  color: #c7d2e3;
  font-size: 11px;
  padding: 6px 10px;
  border-radius: 999px;
  pointer-events: none;
}

.config-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 11px;
  color: #8b93a7;
}

.field-full {
  grid-column: span 3;
}

.field span {
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.field select {
  width: wrap;
  background: #0f1115;
  border: 1px solid #232a36;
  border-radius: 8px;
  color: #e8eaed;
  padding: 10px 12px;
  font-size: 13px;
}

.btn {
  border-radius: 8px;
  border: 1px solid #2a3140;
  background: #1e2430;
  color: #e8eaed;
  padding: 10px 16px;
  font-size: 13px;
  cursor: pointer;
}

.btn.ghost {
  background: transparent;
  border-color: #384164;
}

.btn.primary {
  background: #3b6fd9;
  border-color: #3b6fd9;
}

.btn.primary:hover,
.btn.ghost:hover {
  background: #314a7c;
}
</style>
