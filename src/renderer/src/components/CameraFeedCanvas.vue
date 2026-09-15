<script setup lang="ts">
// Single-camera version of LiveView.vue's decode-and-draw logic, kept
// separate so it doesn't touch the already-working live view.
import { onBeforeUnmount, ref, watch } from 'vue';
import type { VideoStreamDescriptor } from '../types';
import { H264AnnexBDecoder } from '../utils/h264-annexb-decoder';

const props = defineProps<{
  cameraId: number;
  videoStreams: VideoStreamDescriptor[];
}>();

const canvasRef = ref<HTMLCanvasElement | null>(null);
const failed = ref(false);
let decoder: H264AnnexBDecoder | null = null;
let decoderUrl: string | null = null;

function streamUrl(): string | null {
  return props.videoStreams.find((stream) => stream.cameraId === props.cameraId)?.url ?? null;
}

function detach(): void {
  decoder?.stop();
  decoder = null;
  decoderUrl = null;
}

function attach(): void {
  const url = streamUrl();
  if (!url || failed.value || !canvasRef.value) return;
  if (decoderUrl === url) return;

  detach();
  decoder = new H264AnnexBDecoder(
    url,
    (frame) => {
      const canvas = canvasRef.value;
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
        failed.value = true;
        detach();
      }
    },
  );
  decoder.start();
  decoderUrl = url;
}

watch(canvasRef, (el) => {
  if (el) attach();
});

watch(
  () => props.videoStreams,
  () => {
    failed.value = false;
    attach();
  },
);

onBeforeUnmount(() => detach());
</script>

<template>
  <canvas v-if="streamUrl() && !failed" ref="canvasRef" class="feed-video" />
  <div v-else class="feed-inner">
    <span class="feed-label">No feed</span>
  </div>
</template>

<style scoped>
.feed-video {
  width: 100%;
  height: 100%;
  object-fit: contain;
  background: #0a0c10;
}

.feed-inner {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: repeating-linear-gradient(45deg, #11141a, #11141a 12px, #0d0f14 12px, #0d0f14 24px);
}

.feed-label {
  font-size: 12px;
  color: #4a5264;
}
</style>
