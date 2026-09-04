<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue';
import type { CameraConfig, MocapViewSettings, PoseFrame, VideoStreamDescriptor } from '../types';
import { H264AnnexBDecoder } from '../utils/h264-annexb-decoder';
import PoseScene3D from './PoseScene3D.vue';

const props = defineProps<{
  cameras: CameraConfig[];
  fps: number;
  jointsValid: number;
  jointsTotal: number;
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
  return (el: HTMLCanvasElement | null) => {
    if (el) {
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
  for (const cameraId of [...decoders.keys()]) detachDecoder(cameraId);
});

</script>

<template>
  <div class="live">
    <div class="top-row">
      <section class="pane mocap">
        <header class="pane-head">
          <span>Live mocap</span>
          <span class="meta">{{ jointsValid }}/{{ jointsTotal }} joints · {{ fps }} fps</span>
        </header>
        <div class="feed mocap-feed">
          <PoseScene3D :pose="pose" :settings="mocapSettings" />
        </div>
      </section>

      <aside class="pane settings-panel">
        <header class="pane-head">
          <span>Live settings</span>
        </header>
        <div class="settings-body">
          <div class="stat">
            <span class="stat-label">Joints</span>
            <span class="stat-value">{{ jointsValid }}/{{ jointsTotal }}</span>
          </div>
          <div class="stat">
            <span class="stat-label">FPS</span>
            <span class="stat-value">{{ fps }}</span>
          </div>
          <div class="stat">
            <span class="stat-label">Cameras</span>
            <span class="stat-value">{{ cameras.length }}</span>
          </div>

          <h4 class="settings-subhead">Mocap view</h4>
          <label class="field">
            <span>Skeleton length ({{ mocapSettings.scale.toFixed(1) }}x)</span>
            <input type="range" min="0.8" max="2.5" step="0.1" v-model.number="mocapSettings.scale" />
          </label>
          <label class="field">
            <span>Bone thickness ({{ mocapSettings.boneThickness.toFixed(3) }})</span>
            <input type="range" min="0.006" max="0.03" step="0.002" v-model.number="mocapSettings.boneThickness" />
          </label>
        </div>
      </aside>
    </div>

    <div class="camera-grid">
      <section v-for="(cam, index) in cameras" :key="cam.deviceId" class="pane camera-pane">
        <header class="pane-head">
          <span>{{ cam.label }}</span>
          <span class="meta">{{ cam.resolution }} · {{ cam.fps }} fps · {{ cam.rotation }}°</span>
        </header>
        <div class="feed" :class="{ portrait: isPortrait(cam.rotation) }">
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
</template>

<style scoped>
.live {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 12px;
  min-height: 0;
}

.top-row {
  display: flex;
  gap: 12px;
  flex: 3;
  min-height: 0;
}

.mocap {
  flex: 3;
  min-width: 0;
}

.settings-panel {
  flex: 1;
  min-width: 200px;
  max-width: 280px;
}

.settings-body {
  flex: 1;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.stat {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  font-size: 12px;
}

.stat-label {
  color: #8b93a7;
}

.stat-value {
  color: #e8eaed;
  font-weight: 600;
}

.settings-subhead {
  margin: 4px 0 0;
  font-size: 12px;
  font-weight: 600;
  color: #e8eaed;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
  color: #8b93a7;
}

.field input[type='range'] {
  width: 100%;
}

.camera-grid {
  flex: 2;
  display: flex;
  flex-wrap: wrap;
  align-content: flex-start;
  gap: 12px;
  min-height: 0;
  overflow-y: auto;
}

/* Fixed-size, fixed-aspect tiles laid out together -- not grid cells stretched to fill
   whatever space happens to be available. */
.camera-pane {
  flex: 0 1 260px;
}

.camera-pane .feed {
  flex: none;
  width: 100%;
  min-height: 0;
  aspect-ratio: 3 / 2;
}

.camera-pane .feed.portrait {
  aspect-ratio: 4 / 5;
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
  padding: 8px 12px;
  font-size: 12px;
  font-weight: 600;
  border-bottom: 1px solid #252b38;
}

.meta {
  font-weight: 400;
  color: #8b93a7;
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
  object-fit: cover;
  background: #0a0c10;
}

.mocap-feed {
  background: radial-gradient(ellipse at center, #151a24 0%, #0a0c10 70%);
}
</style>
