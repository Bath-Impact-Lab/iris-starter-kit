<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import type { CameraConfig, CameraDevice, Resolution, VideoStreamDescriptor } from '../types';
import { ROTATION_OPTIONS } from '../data/mock';
import { ensurePermission, getCommonFpsOptions, getCommonResolutionOptions, listVideoInputs, probeCamera, selectCommonConfig } from '../utils/camera-probe';
import { H264AnnexBDecoder } from '../utils/h264-annexb-decoder';
import AppModal from './AppModal.vue';

const props = defineProps<{
  open: boolean;
  // True when reopened from Settings to edit an already-running setup.
  editing?: boolean;
  // IRIS's own live video streams -- reused for the preview since IRIS
  // already holds each device and a second getUserMedia() grab would fail.
  videoStreams?: VideoStreamDescriptor[];
  // The config IRIS is actually running right now (while editing).
  currentConfig?: CameraConfig[];
  // What IRIS actually baked into the video already (camera 0's rotation at last run start).
  bakedRotation?: number;
}>();

// IRIS already rotated the IRIS-stream preview by bakedRotation; only the leftover delta still
// needs applying here. The getUserMedia() fallback below shows the true unrotated source instead,
// so it always needs the full configured angle, not this delta.
function displayRotation(rotation: number): number {
  return ((rotation - (props.bakedRotation ?? 0)) % 360 + 360) % 360;
}

const emit = defineEmits<{
  continue: [cameras: CameraConfig[]];
  close: [];
}>();

const cameras = ref<CameraConfig[]>([]);
const deviceProfiles = ref<CameraDevice[]>([]);
const expandedIds = ref<Set<string>>(new Set());
// Devices the OS reports but the user has ruled out (stale/ghost entries that don't
// actually exist, or cameras they just don't want IRIS to use). Defaults to selected.
const selectedIds = ref<Set<string>>(new Set());
const showAllPreviews = ref(false);
const videoElements = ref<Record<string, HTMLVideoElement | null>>({});
const activeStreams = ref<Record<string, MediaStream>>({});
const loading = ref(false);

// IRIS-stream-backed previews, decoded like LiveView. Keyed by deviceId, not rendering position --
// videoStreams is indexed by position in currentConfig, which this modal's own device order can disagree with.
const canvasElements = new Map<string, HTMLCanvasElement>();
const irisDecoders = new Map<string, H264AnnexBDecoder>();
const irisDecoderUrls = new Map<string, string>();
const failedIrisStreams = ref<Set<string>>(new Set());

function irisStreamIndexFor(deviceId: string): number {
  return props.currentConfig?.findIndex((c) => c.deviceId === deviceId) ?? -1;
}

function irisStreamUrlFor(deviceId: string): string | null {
  const streamIndex = irisStreamIndexFor(deviceId);
  if (streamIndex < 0) return null;
  return props.videoStreams?.find((stream) => stream.cameraId === streamIndex)?.url ?? null;
}

function hasIrisStream(deviceId: string): boolean {
  return !!props.editing && irisStreamUrlFor(deviceId) !== null && !failedIrisStreams.value.has(deviceId);
}

function detachIrisDecoder(deviceId: string): void {
  const decoder = irisDecoders.get(deviceId);
  if (!decoder) return;

  decoder.stop();
  irisDecoders.delete(deviceId);
  irisDecoderUrls.delete(deviceId);
}

function attachIrisDecoder(deviceId: string): void {
  const url = irisStreamUrlFor(deviceId);
  if (!url || failedIrisStreams.value.has(deviceId)) return;
  if (irisDecoderUrls.get(deviceId) === url) return;

  detachIrisDecoder(deviceId);

  const decoder = new H264AnnexBDecoder(
    url,
    (frame) => {
      const canvas = canvasElements.get(deviceId);
      if (canvas) {
        if (canvas.width !== frame.displayWidth || canvas.height !== frame.displayHeight) {
          canvas.width = frame.displayWidth;
          canvas.height = frame.displayHeight;
        }
        canvas.getContext('2d')?.drawImage(frame, 0, 0);
      }
      frame.close();
    },
    (status) => {
      if (status === 'failed') {
        failedIrisStreams.value = new Set(failedIrisStreams.value).add(deviceId);
        detachIrisDecoder(deviceId);
      }
    },
  );
  decoder.start();

  irisDecoders.set(deviceId, decoder);
  irisDecoderUrls.set(deviceId, url);
}

function setCanvasRef(deviceId: string) {
  return (el: unknown) => {
    if (el instanceof HTMLCanvasElement) {
      canvasElements.set(deviceId, el);
      attachIrisDecoder(deviceId);
    } else {
      canvasElements.delete(deviceId);
    }
  };
}

watch(
  () => props.videoStreams,
  () => {
    failedIrisStreams.value = new Set();
    for (const deviceId of [...irisDecoders.keys()]) {
      if (!hasIrisStream(deviceId)) detachIrisDecoder(deviceId);
    }
    for (const deviceId of canvasElements.keys()) {
      if (hasIrisStream(deviceId)) attachIrisDecoder(deviceId);
    }
  },
);

function detachAllIrisDecoders(): void {
  for (const deviceId of [...irisDecoders.keys()]) detachIrisDecoder(deviceId);
}

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

function readPersistedSelection(deviceId: string): boolean {
  const raw = localStorage.getItem(`camera-config:${deviceId}`);
  try {
    const persisted = raw ? JSON.parse(raw) : null;
    return persisted?.selected !== false;
  } catch {
    return true;
  }
}

async function loadCameras() {
  loading.value = true;
  try {
    await ensurePermission();
    const devices = await listVideoInputs();
    const knownByDeviceId = new Map((props.editing ? props.currentConfig : undefined)?.map((c) => [c.deviceId, c]) ?? []);

    // Probing a device IRIS already holds fails and overwrites its real resolution/fps with fallback defaults.
    const toProbe = devices.filter((d) => !knownByDeviceId.has(d.deviceId));
    const probed = await Promise.all(toProbe.map((d) => probeCamera(d.deviceId)));
    const probedById = new Map(probed.map((p) => [p.id, p]));

    deviceProfiles.value = devices.map((d) => {
      const known = knownByDeviceId.get(d.deviceId);
      return (
        probedById.get(d.deviceId) ??
        ({ id: d.deviceId, label: known?.label ?? d.label, defaultRotation: known?.rotation ?? 0 } as CameraDevice)
      );
    });

    const common = selectCommonConfig(deviceProfiles.value);
    const preferredResolution = common.resolution ?? '1920x1080';
    const preferredFps = common.fps ?? 30;

    cameras.value = devices.map((d, index) => {
      const known = knownByDeviceId.get(d.deviceId);
      if (known) return { ...known };

      const dev = probedById.get(d.deviceId) ?? ({ id: d.deviceId, label: d.label, defaultRotation: 0 } as CameraDevice);
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

    // A currently-running (known) device was selected when the run started; anything
    // else falls back to its persisted choice, defaulting to selected for new devices.
    selectedIds.value = new Set(
      cameras.value
        .filter((cam) => knownByDeviceId.has(cam.deviceId) || readPersistedSelection(cam.deviceId))
        .map((cam) => cam.deviceId),
    );
  } catch (err) {
    // fallback to existing bridge if present
    if ((window as any).irisStarter && (window as any).irisStarter.listCameras) {
      const devices = await (window as any).irisStarter.listCameras();
      deviceProfiles.value = devices as CameraDevice[];
      cameras.value = devices.map((device: CameraDevice, index: number) => defaultConfig(device, index));
      selectedIds.value = new Set(
        cameras.value.filter((cam) => readPersistedSelection(cam.deviceId)).map((cam) => cam.deviceId),
      );
    } else {
      deviceProfiles.value = [];
      cameras.value = [];
      selectedIds.value = new Set();
    }
  } finally {
    loading.value = false;
  }
}

async function postLoadSetup() {
  const all = new Set<string>();
  cameras.value.forEach((c) => all.add(c.deviceId));
  expandedIds.value = all;
  await nextTick();
  await Promise.all(
    cameras.value.map((c) => (hasIrisStream(c.deviceId) ? Promise.resolve() : startPreview(c.deviceId))),
  );
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

function isSelected(deviceId: string): boolean {
  return selectedIds.value.has(deviceId);
}

function persistSelection(deviceId: string, selected: boolean): void {
  const key = `camera-config:${deviceId}`;
  const prevRaw = localStorage.getItem(key);
  const prev = prevRaw ? JSON.parse(prevRaw) : {};
  try {
    localStorage.setItem(key, JSON.stringify({ ...(prev || {}), selected }));
  } catch {
    // ignore storage failures
  }
}

function toggleSelected(deviceId: string): void {
  const next = new Set(selectedIds.value);
  const nowSelected = !next.has(deviceId);
  if (nowSelected) next.add(deviceId);
  else next.delete(deviceId);
  selectedIds.value = next;
  persistSelection(deviceId, nowSelected);
}

function setVideoRef(deviceId: string) {
  return (value: unknown) => {
    const el = value instanceof HTMLVideoElement ? value : null;
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
    if (!hasIrisStream(deviceId)) {
      await startPreview(deviceId);
    }
  }
  expandedIds.value = nextExpanded;
}

async function toggleAllPreviews() {
  showAllPreviews.value = !showAllPreviews.value;
  if (showAllPreviews.value) {
    cameras.value.forEach((cam) => expandedIds.value.add(cam.deviceId));
    await Promise.all(
      cameras.value.map((cam) => (hasIrisStream(cam.deviceId) ? Promise.resolve() : startPreview(cam.deviceId))),
    );
  } else {
    expandedIds.value.clear();
    stopAllPreviews();
  }
}

watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) {
      // Re-probe on every open, not just the first, to pick up plugged/unplugged cameras.
      void loadCameras().then(() => postLoadSetup());
    } else {
      expandedIds.value.clear();
      showAllPreviews.value = false;
      stopAllPreviews();
      detachAllIrisDecoders();
    }
  },
);

onMounted(() => {
  void loadCameras().then(() => postLoadSetup());
});

onUnmounted(() => {
  stopAllPreviews();
  detachAllIrisDecoders();
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

const selectedCameras = computed(() => cameras.value.filter((cam) => isSelected(cam.deviceId)));

function onContinue() {
  if (selectedCameras.value.length === 0) return;
  persistCameraConfig();
  emit('continue', selectedCameras.value);
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
        <p class="subtext">Uncheck any camera that isn't actually connected (a stale or ghost entry) or that you don't want IRIS to use.</p>
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
      <div v-for="cam in cameras" :key="cam.deviceId" class="camera-card" :class="{ deselected: !isSelected(cam.deviceId) }">
        <div class="camera-summary">
          <label class="select-toggle" @click.stop>
            <input type="checkbox" :checked="isSelected(cam.deviceId)" @change="toggleSelected(cam.deviceId)" />
          </label>
          <button type="button" class="camera-summary-main" @click="toggleCameraExpansion(cam.deviceId)">
            <div>
              <div class="camera-title">{{ cam.label }}</div>
              <div v-if="!expandedIds.has(cam.deviceId)" class="camera-meta">
                {{ cam.resolution }} · {{ cam.fps }} fps · {{ cam.rotation }}°
                <span v-if="!isSelected(cam.deviceId)"> · not used</span>
              </div>
            </div>
            <span class="arrow">{{ expandedIds.has(cam.deviceId) ? '▲' : '▼' }}</span>
          </button>
        </div>

        <div v-if="expandedIds.has(cam.deviceId)" class="camera-body">
          <div class="preview-panel">
            <canvas
              v-if="hasIrisStream(cam.deviceId)"
              :ref="setCanvasRef(cam.deviceId)"
              class="preview"
              :class="`rotate-${displayRotation(cam.rotation)}`"
            />
            <video
              v-else
              :ref="setVideoRef(cam.deviceId)"
              class="preview"
              :class="`rotate-${cam.rotation}`"
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
      <span v-if="!loading && selectedCameras.length === 0" class="footer-warning">Select at least one camera to continue.</span>
      <button type="button" class="btn primary" :disabled="selectedCameras.length === 0" @click="onContinue">
        {{ editing ? 'Done' : 'Continue' }}{{ selectedCameras.length > 0 ? ` (${selectedCameras.length} selected)` : '' }}
      </button>
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
  transition: opacity 0.15s ease;
}

.camera-card.deselected {
  opacity: 0.55;
}

.camera-summary {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 4px;
  padding-left: 20px;
}

.select-toggle {
  display: flex;
  align-items: center;
  cursor: pointer;
  padding: 8px;
}

.select-toggle input {
  width: 16px;
  height: 16px;
  cursor: pointer;
  accent-color: #3b6fd9;
}

.camera-summary-main {
  flex: 1;
  min-width: 0;
  background: none;
  border: none;
  color: inherit;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 18px 20px 18px 4px;
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
  container-type: size;
}

.preview {
  width: 100%;
  height: 100%;
  object-fit: contain;
  background: #0d1118;
}

/* A 90/270 rotation swaps visual width/height, so the pre-rotation box must too. */
.preview.rotate-90,
.preview.rotate-270 {
  width: 100cqh;
  height: 100cqw;
}

.rotate-0 { transform: rotate(0deg); }
.rotate-90 { transform: rotate(90deg); }
.rotate-180 { transform: rotate(180deg); }
.rotate-270 { transform: rotate(270deg); }

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

.field input {
  width: 100%;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 8px;
  color: #e8eaed;
  padding: 10px 12px;
  font-size: 13px;
  font-family: inherit;
  transition: background-color 0.1s ease, border-color 0.1s ease;
}

.field input:hover {
  background: rgba(255, 255, 255, 0.07);
}

.field input:focus {
  outline: none;
  border-color: rgba(59, 111, 217, 0.55);
  background: rgba(255, 255, 255, 0.07);
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

.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn.primary:disabled:hover {
  background: #3b6fd9;
}

.footer-warning {
  align-self: center;
  font-size: 12px;
  color: #e0a951;
}
</style>
