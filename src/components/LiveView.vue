<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue';
import type { CameraConfig, PoseFrame, VideoStreamDescriptor } from '../types';
import { H264AnnexBDecoder } from '../utils/h264-annexb-decoder';
import PoseScene3D from './PoseScene3D.vue';

const props = defineProps<{
  cameras: CameraConfig[];
  fps: number;
  jointsValid: number;
  jointsTotal: number;
  pose?: PoseFrame | null;
  videoStreams: VideoStreamDescriptor[];
}>();

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
          <PoseScene3D :pose="pose" />
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
        </div>
      </aside>
    </div>

    <div class="camera-grid">
      <section v-for="(cam, index) in cameras" :key="cam.deviceId" class="pane">
        <header class="pane-head">
          <span>{{ cam.label }}</span>
          <span class="meta">{{ cam.resolution }} · {{ cam.fps }} fps · {{ cam.rotation }}°</span>
        </header>
        <div class="feed">
          <canvas
            v-if="hasStream(index)"
            :ref="setVideoRef(index)"
            class="feed-video"
            :style="{ transform: `rotate(${cam.rotation}deg)` }"
          />
          <div v-else class="feed-inner" :style="{ transform: `rotate(${cam.rotation}deg)` }">
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

.camera-grid {
  flex: 2;
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 12px;
  min-height: 0;
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
}

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
