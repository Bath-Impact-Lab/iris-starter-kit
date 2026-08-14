<script setup lang="ts">
import { computed } from 'vue';
import type { CameraConfig, PoseFrame, PoseKeypoint } from '../types';

const props = defineProps<{
  cameras: CameraConfig[];
  fps: number;
  jointsValid: number;
  jointsTotal: number;
  pose?: PoseFrame | null;
}>();

const posePoints = computed<PoseKeypoint[]>(() => {
  const source = props.pose ?? null;
  const candidates: PoseKeypoint[][] = [];

  if (source) {
    if (Array.isArray(source.keypoints)) candidates.push(source.keypoints as PoseKeypoint[]);
    if (Array.isArray(source.joints)) candidates.push(source.joints as PoseKeypoint[]);
    if (Array.isArray(source.pose)) candidates.push(source.pose as PoseKeypoint[]);
    if (Array.isArray(source.people)) {
      for (const person of source.people) {
        if (person) {
          if (Array.isArray(person.keypoints)) candidates.push(person.keypoints as PoseKeypoint[]);
          if (Array.isArray(person.joints)) candidates.push(person.joints as PoseKeypoint[]);
          if (Array.isArray(person.pose)) candidates.push(person.pose as PoseKeypoint[]);
        }
      }
    }
  }

  const points = candidates[0] ?? [];
  return points.filter((point) => typeof point?.x === 'number' && typeof point?.y === 'number');
});

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
    <section v-for="cam in cameras" :key="cam.deviceId" class="pane">
      <header class="pane-head">
        <span>{{ cam.label }}</span>
        <span class="meta">{{ cam.resolution }} · {{ cam.fps }} fps · {{ cam.rotation }}°</span>
      </header>
      <div class="feed">
        <div class="feed-inner" :style="{ transform: `rotate(${cam.rotation}deg)` }">
          <span class="feed-label">Camera feed</span>
        </div>
      </div>
    </section>

    <section class="pane mocap">
      <header class="pane-head">
        <span>Mocap</span>
        <span class="meta">{{ jointsValid }}/{{ jointsTotal }} joints · {{ fps }} fps</span>
      </header>
      <div class="feed mocap-feed">
        <svg v-if="posePoints.length >= 17" viewBox="0 0 120 200" class="skeleton" aria-hidden="true">
          <g>
            <line v-for="([a, b], index) in skeletonPairs" :key="index" v-if="pointAt(a) && pointAt(b)" :x1="pointAt(a)?.x" :y1="pointAt(a)?.y" :x2="pointAt(b)?.x" :y2="pointAt(b)?.y" stroke="#6b9fff" stroke-width="2" />
            <circle v-for="(point, index) in posePoints.slice(0, 17)" :key="index" :cx="point.x" :cy="point.y" r="4" fill="#6b9fff" stroke="#dfe8ff" stroke-width="1" />
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
  </div>
</template>

<style scoped>
.live {
  flex: 1;
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 12px;
  padding: 12px;
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

.mocap-feed {
  background: radial-gradient(ellipse at center, #151a24 0%, #0a0c10 70%);
}

.skeleton {
  width: 120px;
  height: 200px;
  opacity: 0.9;
}
</style>
