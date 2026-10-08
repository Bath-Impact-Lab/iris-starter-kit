<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';
import type { CameraConfig, MocapViewSettings, PoseFrame, VideoStreamDescriptor } from '../types';
import { H264AnnexBDecoder } from '../utils/h264-annexb-decoder';
import PoseScene3D from './PoseScene3D.vue';
import CaptureAreaWorkspace from './CaptureAreaWorkspace.vue';
import type { Da3Scene, RoiState, SavedRoi } from '../../../shared/roi';

const props = defineProps<{
  cameras: CameraConfig[];
  fps: number;
  jointsValid: number;
  jointsTotal: number;
  people: number;
  pose?: PoseFrame | null;
  videoStreams: VideoStreamDescriptor[];
  // What IRIS actually baked into the video already (camera 0's rotation at last run start).
  bakedRotation: number;
}>();

const mocapSettings = defineModel<MocapViewSettings>('mocapSettings', { required: true });

// IRIS already rotated the incoming video by bakedRotation; only the leftover delta still needs
// applying here (0 for camera 0 itself, in the common case).
function displayRotation(rotation: number): number {
  return ((rotation - props.bakedRotation) % 360 + 360) % 360;
}

// A camera's final (corrected) orientation is what its own configured angle says,
// regardless of how much of that correction IRIS already baked in vs. what's left for CSS.
function isPortrait(rotation: number): boolean {
  return rotation === 90 || rotation === 270;
}

// Decodes IRIS's own video output rather than grabbing the camera again,
// since IRIS already holds it while running.
const canvasElements = new Map<number, HTMLCanvasElement>();
const decoders = new Map<number, H264AnnexBDecoder>();
const decoderUrls = new Map<number, string>();
const lastVideoFrame = new Map<number, number>();
const roiOpen = ref(false);
const roiState = ref<RoiState | null>(null);
const savedRoi = ref<SavedRoi | null>(null);
const roiError = ref('');
const showDa3 = ref(false);
const da3Scene = shallowRef<Da3Scene | null>(null);
const da3Loading = ref(false);
const da3Error = ref('');
const da3Key = computed(() => roiState.value?.runId && roiState.value.calibrationVersion > 0
  ? `${roiState.value.runId}:${roiState.value.calibrationVersion}` : null);
let da3Sequence = 0;
async function loadDa3() {
  const state = roiState.value;
  const sequence = ++da3Sequence;
  da3Scene.value = null;
  da3Error.value = '';
  da3Loading.value = false;
  if (!showDa3.value || !state?.runId || !state.calibrationVersion) return;
  da3Loading.value = true;
  try {
    const result = await window.irisStarter.roiScene({ runId: state.runId, calibrationVersion: state.calibrationVersion });
    if (disposed || sequence !== da3Sequence) return;
    if (result.ok && result.scene?.runId === state.runId && result.scene.calibrationVersion === state.calibrationVersion) {
      da3Scene.value = result.scene;
    } else {
      da3Error.value = result.error ?? 'DA3 reconstruction is unavailable.';
    }
  } catch (error) {
    if (!disposed && sequence === da3Sequence) da3Error.value = String(error);
  } finally {
    if (sequence === da3Sequence) da3Loading.value = false;
  }
}
watch([showDa3, da3Key], () => { void loadDa3(); });
let pollingRoi = false;
let disposed = false;
let roiTimer: ReturnType<typeof setInterval>;
async function refreshRoi() {
  if (pollingRoi || !window.irisStarter?.roiGet) return;
  pollingRoi = true;
  try {
    const reply = await window.irisStarter.roiGet();
    if (disposed) return;
    roiState.value = reply.ok ? reply.state ?? null : null;
    savedRoi.value = reply.saved ?? null;
    roiError.value = reply.ok ? '' : reply.error ?? 'Capture area is unavailable';
  } catch (error) { if (!disposed) { roiState.value = null; roiError.value = String(error); } }
  finally { pollingRoi = false; }
}
function getRoiFrame(streamId: number) {
  return hasStream(streamId) && Date.now() - (lastVideoFrame.get(streamId) ?? 0) < 3000 ? canvasElements.get(streamId) : undefined;
}
function roiRotation(streamId: number) { return displayRotation(props.cameras[streamId]?.rotation ?? props.bakedRotation); }
onMounted(() => { void refreshRoi(); roiTimer = setInterval(() => void refreshRoi(), 1500); });
const failedStreams = ref<Set<number>>(new Set());

function streamUrlFor(cameraId: number): string | null {
  return props.videoStreams.find((stream) => stream.cameraId === cameraId)?.url ?? null;
}

function hasStream(cameraId: number): boolean {
  return streamUrlFor(cameraId) !== null && !failedStreams.value.has(cameraId);
}

function detachDecoder(cameraId: number): void {
  const decoder = decoders.get(cameraId);
  if (!decoder) return;

  decoder.stop();
  decoders.delete(cameraId);
  decoderUrls.delete(cameraId);
}

function attachDecoder(cameraId: number): void {
  const url = streamUrlFor(cameraId);
  if (!url || failedStreams.value.has(cameraId)) return;
  if (decoderUrls.get(cameraId) === url) return;

  detachDecoder(cameraId);

  const decoder = new H264AnnexBDecoder(
    url,
    (frame) => {
      const canvas = canvasElements.get(cameraId);
      if (canvas) {
        if (canvas.width !== frame.displayWidth || canvas.height !== frame.displayHeight) {
          canvas.width = frame.displayWidth;
          canvas.height = frame.displayHeight;
        }
        canvas.getContext('2d')?.drawImage(frame, 0, 0);
        lastVideoFrame.set(cameraId, Date.now());
      }
      frame.close();
    },
    (status) => {
      if (status === 'failed') {
        failedStreams.value = new Set(failedStreams.value).add(cameraId);
        detachDecoder(cameraId);
      }
    },
  );
  decoder.start();

  decoders.set(cameraId, decoder);
  decoderUrls.set(cameraId, url);
}

function setVideoRef(cameraId: number) {
  return (el: unknown) => {
    if (el instanceof HTMLCanvasElement) {
      canvasElements.set(cameraId, el);
      attachDecoder(cameraId);
    } else {
      canvasElements.delete(cameraId);
    }
  };
}

watch(
  () => props.videoStreams,
  (streams) => {
    failedStreams.value = new Set();
    const wanted = new Set(streams.map((stream) => stream.cameraId));
    for (const cameraId of [...decoders.keys()]) {
      if (!wanted.has(cameraId)) detachDecoder(cameraId);
    }
    for (const stream of streams) {
      if (canvasElements.has(stream.cameraId)) attachDecoder(stream.cameraId);
    }
  },
  { immediate: true },
);

onBeforeUnmount(() => {
  disposed = true;
  da3Sequence++;
  clearInterval(roiTimer);
  for (const cameraId of [...decoders.keys()]) detachDecoder(cameraId);
});

</script>

<template>
  <div class="live">
    <div v-show="!roiOpen" class="main-col">
      <section class="pane mocap" data-tour="live-mocap">
        <header class="pane-head">
          <span>Live mocap</span>
          <span class="meta">{{ people }} {{ people === 1 ? 'person' : 'people' }} · {{ jointsValid }}/{{ jointsTotal }} joints · {{ fps }} pose updates/s</span>
        </header>
        <div class="feed mocap-feed">
          <PoseScene3D v-if="!roiOpen" :pose="pose" :settings="mocapSettings" :point-cloud="showDa3 ? da3Scene : null" />
        </div>
      </section>

      <div class="camera-strip">
        <section v-for="(cam, index) in cameras" :key="cam.deviceId" class="pane camera-pane" :class="{ portrait: isPortrait(cam.rotation) }">
          <header class="pane-head">
            <span>{{ cam.label }}</span>
            <span class="meta">{{ cam.resolution }} · {{ cam.fps }} fps · {{ cam.rotation }}°</span>
          </header>
          <div class="feed">
            <canvas
              v-if="hasStream(index)"
              :ref="setVideoRef(index)"
              class="feed-video"
              :class="`rotate-${displayRotation(cam.rotation)}`"
            />
            <div v-else class="feed-inner" :class="`rotate-${displayRotation(cam.rotation)}`">
              <span class="feed-label">Camera feed</span>
            </div>
          </div>
        </section>
      </div>
    </div>

    <aside v-show="!roiOpen" class="pane settings-panel" data-tour="live-settings">
      <header class="pane-head">
        <span>Live settings</span>
      </header>
      <div class="settings-body">
        <div class="stats">
          <div class="stat"><span class="stat-label">People</span><span class="stat-value">{{ people }}</span></div>
          <div class="stat"><span class="stat-label">Joints</span><span class="stat-value">{{ jointsValid }}/{{ jointsTotal }}</span></div>
          <div class="stat"><span class="stat-label" title="Pose updates received by the app per second, not camera capture FPS">Pose updates/s</span><span class="stat-value">{{ fps }}</span></div>
          <div class="stat"><span class="stat-label">Cameras</span><span class="stat-value">{{ cameras.length }}</span></div>
        </div>

        <section class="section">
          <h4 class="settings-subhead">Mocap view</h4>
          <div class="section-body">
            <label class="field">
              <span>Skeleton + DA3 scale ({{ mocapSettings.scale.toFixed(1) }}x)</span>
              <input type="range" min="0.8" max="5" step="0.1" v-model.number="mocapSettings.scale" />
            </label>
            <label class="field">
              <span>Bone thickness ({{ mocapSettings.boneThickness.toFixed(3) }})</span>
              <input type="range" min="0.006" max="0.03" step="0.002" v-model.number="mocapSettings.boneThickness" />
            </label>
            <label class="scene-toggle"><input type="checkbox" v-model="showDa3" /> Show DA3 reconstruction</label>
            <span v-if="showDa3 && !da3Key" class="meta" role="status">Waiting for calibration to provide a scene.</span>
            <span v-else-if="showDa3 && (da3Loading || da3Error)" class="meta" role="status">
              {{ da3Loading ? 'Loading DA3 reconstruction…' : da3Error }}
              <button v-if="da3Error" type="button" class="btn" @click="loadDa3">Retry</button>
            </span>
            <span v-else-if="showDa3 && da3Scene" class="meta">Scene shown in calibrated world coordinates.</span>
          </div>
        </section>

        <section class="section">
          <h4 class="settings-subhead">Capture area</h4>
          <div class="section-body">
            <span class="meta">{{ roiState ? `${roiState.mode} · ${roiState.availability.replaceAll('_', ' ')}` : 'Capture area unavailable' }}</span>
            <div class="actions">
              <button type="button" class="btn primary" @click="roiOpen = true; refreshRoi()">Edit capture area</button>
            </div>
          </div>
        </section>
      </div>
    </aside>

    <CaptureAreaWorkspace v-if="roiOpen" :state="roiState" :saved="savedRoi" :error="roiError" :get-frame="getRoiFrame"
      :rotation-for="roiRotation" @close="roiOpen = false" @refresh="refreshRoi" @applied="roiState = $event" />
  </div>
</template>

<style scoped>
/* Type scale for this view: 12px for labels, controls and buttons, 11px for hints/status. */
.live {
  flex: 1;
  display: flex;
  gap: 12px;
  padding: 12px;
  min-width: 0;
  min-height: 0;
}

.main-col {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-height: 0;
}

.mocap {
  flex: 3;
  min-height: 0;
}

.capture-workspace {
  min-width: 0;
}

/* One row of tiles sized off the strip's height; more cameras scroll sideways. */
.camera-strip {
  flex: 2;
  min-height: 160px;
  display: flex;
  gap: 12px;
  overflow-x: auto;
  overflow-y: hidden;
}

.camera-pane {
  flex: none;
  height: 100%;
  aspect-ratio: 3 / 2;
}

.camera-pane.portrait {
  aspect-ratio: 4 / 5;
}

.camera-pane .feed {
  min-height: 0;
}

.settings-panel {
  flex: none;
  width: 300px;
}

.settings-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  font-size: 12px;
  color: #c7cbd6;
}

.stats {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 8px;
}

.stat {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 6px 8px;
  background: #0f1219;
  border: 1px solid #252b38;
  border-radius: 5px;
}

.stat-label {
  font-size: 11px;
  color: #8b93a7;
}

.stat-value {
  font-size: 12px;
  font-weight: 600;
  color: #e8eaed;
}

.section {
  padding-top: 12px;
  border-top: 1px solid #252b38;
}

.section-body {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding-top: 10px;
}

.settings-subhead {
  margin: 0;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: #8b93a7;
}

.meta {
  font-size: 11px;
  font-weight: 400;
  line-height: 1.45;
  color: #8b93a7;
}

.pane-head .meta {
  line-height: normal;
}

/* Every button in the view shares this; .primary marks the main action of a section. */
.btn {
  font: inherit;
  font-size: 12px;
  font-weight: 600;
  line-height: 1.2;
  padding: 7px 12px;
  color: #eef4ff;
  background: #1e2636;
  border: 1px solid #3a4356;
  border-radius: 5px;
  cursor: pointer;
}

.btn:hover:not(:disabled) {
  border-color: #526784;
  background: #243048;
}

.btn.primary {
  background: #2f5fd0;
  border-color: #3b6fd9;
}

.btn.primary:hover:not(:disabled) {
  background: #3b6fd9;
}

.btn:disabled {
  opacity: 0.5;
  cursor: default;
}

.meta .btn {
  margin-left: 6px;
  padding: 3px 8px;
}

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.scene-toggle {
  display: flex;
  align-items: center;
  gap: 6px;
  color: #e8eaed;
  cursor: pointer;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  color: #8b93a7;
}

.field input[type='range'] {
  width: 100%;
}

.pane {
  display: flex;
  flex-direction: column;
  min-height: 0;
  background: #141820;
  border: 1px solid #252b38;
  border-radius: 6px;
  overflow: hidden;
}

.pane-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
  border-bottom: 1px solid #252b38;
}

.pane-head span {
  overflow: hidden;
  text-overflow: ellipsis;
}

.feed {
  flex: 1;
  min-height: 200px;
  background: #0a0c10;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  /* lets rotate-90/270 size themselves off this element's own box, not the viewport */
  container-type: size;
}

/* A 90/270 rotation swaps visual width/height, so the pre-rotation box must too --
   otherwise the rotated content is clipped to the original (wrong) aspect ratio. */
.feed-video.rotate-90,
.feed-inner.rotate-90,
.feed-video.rotate-270,
.feed-inner.rotate-270 {
  width: 100cqh;
  height: 100cqw;
}

.rotate-0 { transform: rotate(0deg); }
.rotate-90 { transform: rotate(90deg); }
.rotate-180 { transform: rotate(180deg); }
.rotate-270 { transform: rotate(270deg); }

.feed-inner {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: repeating-linear-gradient(
    45deg,
    #11141a,
    #11141a 12px,
    #0d0f14 12px,
    #0d0f14 24px
  );
}

.feed-label {
  font-size: 12px;
  color: #4a5264;
}

.feed-video {
  width: 100%;
  height: 100%;
  object-fit: contain;
  background: #0a0c10;
}

.mocap-feed {
  background: radial-gradient(ellipse at center, #151a24 0%, #0a0c10 70%);
}
</style>
