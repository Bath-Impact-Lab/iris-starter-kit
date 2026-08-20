<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import type { CameraConfig, PoseFrame, VideoStreamDescriptor } from '../types';
import { countValidKeypoints, extractBodyKeypoints2D, type PoseKeypoint2D } from '../utils/pose';
import { H264AnnexBDecoder } from '../utils/h264-annexb-decoder';

const props = defineProps<{
  cameras: CameraConfig[];
  fps: number;
  jointsValid: number;
  jointsTotal: number;
  pose?: PoseFrame | null;
  videoStreams: VideoStreamDescriptor[];
}>();

// Camera panes decode IRIS's own video-pipe output rather than a browser
// `getUserMedia` grab -- see dont commit/IRIS-INTEGRATION-NOTES.md.
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

// Raw points_2d are camera-pixel coordinates; project them into the
// skeleton's small viewBox, preserving aspect ratio so the figure doesn't
// distort regardless of the source camera's resolution.
const VIEW_WIDTH = 120;
const VIEW_HEIGHT = 200;

function parseResolution(resolution: string | undefined): { width: number; height: number } {
  const [width, height] = (resolution ?? '').split('x').map((value) => parseInt(value, 10));
  return {
    width: Number.isFinite(width) && width > 0 ? width : 1920,
    height: Number.isFinite(height) && height > 0 ? height : 1080,
  };
}

const posePoints = computed<Array<PoseKeypoint2D | null>>(() => {
  const raw = extractBodyKeypoints2D(props.pose, 0);
  const { width, height } = parseResolution(props.cameras[0]?.resolution);
  const scale = Math.min(VIEW_WIDTH / width, VIEW_HEIGHT / height);
  const offsetX = (VIEW_WIDTH - width * scale) / 2;
  const offsetY = (VIEW_HEIGHT - height * scale) / 2;

  return raw.map((point) => (point ? { x: offsetX + point.x * scale, y: offsetY + point.y * scale } : null));
});

const validPoseCount = computed(() => countValidKeypoints(posePoints.value));

const skeletonPairs = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [1, 5], [5, 6], [6, 7],
  [1, 8], [8, 9], [9, 10],
  [8, 11], [11, 12], [12, 13],
  [11, 14], [14, 15], [15, 16],
];

function pointAt(index: number) {
  return posePoints.value[index] ?? null;
}
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
          <svg v-if="validPoseCount > 0" viewBox="0 0 120 200" class="skeleton" aria-hidden="true">
            <g>
              <template v-for="([a, b], index) in skeletonPairs" :key="index">
                <line v-if="pointAt(a) && pointAt(b)" :x1="pointAt(a)?.x" :y1="pointAt(a)?.y" :x2="pointAt(b)?.x" :y2="pointAt(b)?.y" stroke="#6b9fff" stroke-width="2" />
              </template>
              <template v-for="(point, index) in posePoints" :key="index">
                <circle v-if="point" :cx="point.x" :cy="point.y" r="4" fill="#6b9fff" stroke="#dfe8ff" stroke-width="1" />
              </template>
            </g>
          </svg>
          <svg v-else viewBox="0 0 120 200" class="skeleton" aria-hidden="true">
            <circle cx="60" cy="24" r="10" fill="none" stroke="#6b9fff" stroke-width="2" />
            <line x1="60" y1="34" x2="60" y2="90" stroke="#6b9fff" stroke-width="2" />
            <line x1="60" y1="50" x2="30" y2="75" stroke="#6b9fff" stroke-width="2" />
            <line x1="60" y1="50" x2="90" y2="75" stroke="#6b9fff" stroke-width="2" />
            <line x1="60" y1="90" x2="42" y2="140" stroke="#6b9fff" stroke-width="2" />
            <line x1="60" y1="90" x2="78" y2="140" stroke="#6b9fff" stroke-width="2" />
            <line x1="42" y1="140" x2="38" y2="185" stroke="#6b9fff" stroke-width="2" />
            <line x1="78" y1="140" x2="82" y2="185" stroke="#6b9fff" stroke-width="2" />
          </svg>
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

.skeleton {
  width: 120px;
  height: 200px;
  opacity: 0.9;
}
</style>
