<script setup lang="ts">
import type { CameraConfig } from '../types';

defineProps<{
  cameras: CameraConfig[];
  fps: number;
  jointsValid: number;
  jointsTotal: number;
}>();
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
        <svg viewBox="0 0 120 200" class="skeleton" aria-hidden="true">
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
