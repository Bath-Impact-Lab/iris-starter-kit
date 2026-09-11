<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import type { Point2, RoiCamera } from '../../../shared/roi';
import { orientedSize, rotatePoint } from '../utils/roiGeometry';

const props = defineProps<{
  camera: RoiCamera;
  getFrame: (streamId: number) => HTMLCanvasElement | undefined;
  rotation: number;
}>();
const canvas = ref<HTMLCanvasElement>();
const available = ref(false);
const size = computed(() => orientedSize(props.camera.width, props.camera.height, props.rotation));
const point = (p: Point2) => { const q = rotatePoint(p, props.rotation); return [q[0] * size.value[0], q[1] * size.value[1]]; };
const outline = computed(() => props.camera.segments.map(s => {
  const a = point([s[0] / props.camera.width, s[1] / props.camera.height]);
  const b = point([s[2] / props.camera.width, s[3] / props.camera.height]);
  return `M${a}L${b}`;
}).join(' '));
let timer: ReturnType<typeof setInterval>;
function draw() {
  const source = props.getFrame(props.camera.streamId);
  const valid = Boolean(source && source.width === props.camera.width && source.height === props.camera.height);
  available.value = valid;
  if (!valid || !source || !canvas.value) return;
  const [w, h] = size.value;
  if (canvas.value.width !== w || canvas.value.height !== h) { canvas.value.width = w; canvas.value.height = h; }
  const ctx = canvas.value.getContext('2d')!;
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, w, h);
  ctx.translate(w / 2, h / 2); ctx.rotate(props.rotation * Math.PI / 180);
  ctx.drawImage(source, -source.width / 2, -source.height / 2);
}
onMounted(() => { draw(); timer = setInterval(draw, 80); });
onBeforeUnmount(() => clearInterval(timer));
</script>

<template>
  <div class="area-image">
    <canvas ref="canvas" />
    <svg :viewBox="`0 0 ${size[0]} ${size[1]}`" aria-label="Capture area projected into camera">
      <path :d="outline" class="applied" />
    </svg>
    <div v-if="!available" class="unavailable">Waiting for matching calibrated video</div>
  </div>
</template>

<style scoped>
.area-image { position: relative; height: 210px; background: #080c12; border-radius: 8px; overflow: hidden; }
canvas, svg { position: absolute; width: 100%; height: 100%; object-fit: contain; inset: 0; }
svg { overflow: hidden; touch-action: none; }
.applied { fill: none; stroke: #52d6ad; stroke-width: 2; vector-effect: non-scaling-stroke; pointer-events: none; }
.unavailable { position: absolute; inset: 0; display: grid; place-items: center; background: #080c12dd; color: #a6b0c4; pointer-events: none; }
</style>
