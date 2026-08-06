<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';
import type { AppPhase, CameraConfig } from './types';
import CameraSetupModal from './components/CameraSetupModal.vue';
import CalibrationModal from './components/CalibrationModal.vue';
import LiveView from './components/LiveView.vue';

const phase = ref<AppPhase>('camera-setup');
const cameras = ref<CameraConfig[]>([]);
const cameraSetupOpen = ref(true);
const calibrationOpen = ref(true);
const settingsOpen = ref(false);
const mockFps = ref(30);
const mockJoints = ref({ valid: 15, total: 17 });

let fpsTick: number | undefined;

onMounted(() => {
  fpsTick = window.setInterval(() => {
    if (phase.value !== 'live') return;
    mockFps.value = 28 + Math.floor(Math.random() * 4);
    mockJoints.value = { valid: 14 + Math.floor(Math.random() * 3), total: 17 };
  }, 1000);
});

onUnmounted(() => {
  if (fpsTick !== undefined) window.clearInterval(fpsTick);
});

function onCameraSetupContinue(config: CameraConfig[]) {
  cameras.value = config;
  void window.irisStarter.saveSessionConfig({ cameras: config });
  cameraSetupOpen.value = false;
  phase.value = 'calibration';
  calibrationOpen.value = true;
}

function onCameraSetupClose() {
  cameraSetupOpen.value = false;
}

function onCalibrationComplete() {
  calibrationOpen.value = false;
  phase.value = 'live';
}

function onCalibrationClose() {
  calibrationOpen.value = false;
}

function reopenSetup() {
  settingsOpen.value = false;
  phase.value = 'camera-setup';
  cameraSetupOpen.value = true;
}

function reopenCalibration() {
  settingsOpen.value = false;
  phase.value = 'calibration';
  calibrationOpen.value = true;
}
</script>

<template>
  <div class="shell">
    <header class="topbar">
      <span class="brand">IRIS Starter Kit</span>
      <div class="topbar-right">
        <span v-if="phase === 'live'" class="status live">Live</span>
        <button
          type="button"
          class="icon-btn"
          aria-label="Settings"
          @click="settingsOpen = !settingsOpen"
        >
          ⚙
        </button>
      </div>
    </header>

    <main class="main">
      <LiveView
        v-if="phase === 'live'"
        :cameras="cameras"
        :fps="mockFps"
        :joints-valid="mockJoints.valid"
        :joints-total="mockJoints.total"
      />
      <div v-else class="placeholder">
        <p>{{ phase === 'camera-setup' ? 'Configure cameras to begin.' : 'Run calibration to continue.' }}</p>
        <button
          v-if="phase === 'camera-setup' && !cameraSetupOpen"
          type="button"
          class="btn"
          @click="cameraSetupOpen = true"
        >
          Open camera setup
        </button>
        <button
          v-if="phase === 'calibration' && !calibrationOpen"
          type="button"
          class="btn"
          @click="calibrationOpen = true"
        >
          Open calibration
        </button>
      </div>
    </main>

    <CameraSetupModal
      :open="phase === 'camera-setup' && cameraSetupOpen"
      @continue="onCameraSetupContinue"
      @close="onCameraSetupClose"
    />
    <CalibrationModal
      :open="phase === 'calibration' && calibrationOpen"
      @complete="onCalibrationComplete"
      @close="onCalibrationClose"
    />

    <div v-if="settingsOpen" class="settings" @click.self="settingsOpen = false">
      <div class="settings-panel">
        <h3>Settings</h3>
        <button type="button" class="btn" @click="reopenSetup">Camera setup</button>
        <button type="button" class="btn" @click="reopenCalibration">Re-calibrate</button>
        <button type="button" class="btn ghost" @click="settingsOpen = false">Close</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.shell {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 16px;
  border-bottom: 1px solid #252b38;
  background: #141820;
  flex-shrink: 0;
}

.brand {
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.03em;
}

.topbar-right {
  display: flex;
  align-items: center;
  gap: 12px;
}

.status {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: #8b93a7;
}

.status.live {
  color: #4ade80;
}

.status.live::before {
  content: '● ';
}

.icon-btn {
  background: none;
  border: none;
  color: #8b93a7;
  font-size: 18px;
  cursor: pointer;
  padding: 4px;
  line-height: 1;
}

.icon-btn:hover {
  color: #e8eaed;
}

.main {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
  background: #0f1115;
}

.placeholder {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  color: #6b7280;
  font-size: 13px;
}

.settings {
  position: fixed;
  inset: 0;
  z-index: 200;
  background: rgba(0, 0, 0, 0.4);
  display: flex;
  justify-content: flex-end;
}

.settings-panel {
  width: 240px;
  background: #171b24;
  border-left: 1px solid #2a3140;
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.settings-panel h3 {
  margin: 0 0 12px;
  font-size: 14px;
  font-weight: 600;
}

.btn {
  border-radius: 4px;
  border: 1px solid #2a3140;
  background: #1e2430;
  color: #e8eaed;
  padding: 8px 12px;
  font-size: 13px;
  cursor: pointer;
  text-align: left;
}

.btn.ghost {
  background: transparent;
  margin-top: 8px;
}

.btn:hover {
  background: #252b38;
}
</style>
