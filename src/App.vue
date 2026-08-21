<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';
import type { AppPhase, CameraConfig, PoseFrame, VideoStreamDescriptor } from './types';
import { BODY_JOINT_COUNT, countValidKeypoints, extractBodyKeypoints2D } from './utils/pose';
import CameraSetupModal from './components/CameraSetupModal.vue';
import CalibrationModal from './components/CalibrationModal.vue';
import LiveView from './components/LiveView.vue';

const phase = ref<AppPhase>('camera-setup');
const cameras = ref<CameraConfig[]>([]);
const cameraSetupOpen = ref(true);
const calibrationOpen = ref(true);
const settingsOpen = ref(false);
const liveFps = ref(0);
const liveJoints = ref({ valid: 0, total: BODY_JOINT_COUNT });
const livePose = ref<PoseFrame | null>(null);
const videoStreams = ref<VideoStreamDescriptor[]>([]);
let removePoseListener: (() => void) | null = null;

function getIrisApi(): any {
  return (window as any).irisStarter ?? null;
}

function extractPoseCount(frame: PoseFrame | null | undefined): { valid: number; total: number } {
  return { valid: countValidKeypoints(extractBodyKeypoints2D(frame)), total: BODY_JOINT_COUNT };
}

// Rolling count of pose frames received in the last second -- an honest
// live FPS reading, not a fake ticker.
const frameArrivalTimes: number[] = [];
function recordFrameArrival(): number {
  const now = performance.now();
  frameArrivalTimes.push(now);
  while (frameArrivalTimes.length > 0 && now - frameArrivalTimes[0]! > 1000) {
    frameArrivalTimes.shift();
  }
  return frameArrivalTimes.length;
}

onMounted(() => {
  const api = getIrisApi();

  if (api?.onPoseData) {
    removePoseListener = api.onPoseData((frame: unknown) => {
      livePose.value = (frame as PoseFrame) ?? null;
      liveJoints.value = extractPoseCount(livePose.value);
      liveFps.value = recordFrameArrival();
    });
  }

  if (api?.subscribe) {
    api.subscribe((status: unknown) => {
      console.log('[starter-kit] iris status:', status);
    });
  }
});

onUnmounted(() => {
  removePoseListener?.();

  try {
    const api = getIrisApi();
    void api?.stopAll?.();
  } catch {
    // ignore shutdown issues while tearing down the UI
  }
});

async function startIrisRun(config: CameraConfig[]) {
  const api = getIrisApi();
  if (!api || typeof api.startRun !== 'function') {
    console.warn('[starter-kit] IRIS backend is unavailable; skipping startRun');
    return;
  }

  try {
    const payload = {
      run_id: `starter-${Date.now()}`,
      camera_width: 1920,
      camera_height: 1080,
      video_fps: 30,
      cameras: config.map((cam) => ({
        id: cam.deviceId,
        label: cam.label,
        resolution: cam.resolution,
        fps: cam.fps,
        rotation: cam.rotation,
      })),
    };

    const runResult = await api.startRun(payload);
    console.log('[starter-kit] startRun:', runResult);
  } catch (error) {
    console.warn('[starter-kit] startRun failed:', error);
  }
}

async function openIrisPreview() {
  const api = getIrisApi();
  if (!api || typeof api.openPreviewMonitor !== 'function') {
    console.warn('[starter-kit] IRIS backend is unavailable; skipping preview monitor');
    return;
  }

  try {
    const result = await api.openPreviewMonitor({
      sharedMemoryName: 'iris_shm_ipc',
      cameraCount: cameras.value.length,
      verbose: false,
    });
    console.log('[starter-kit] openPreviewMonitor:', result);
    videoStreams.value = Array.isArray(result?.videoStreams) ? result.videoStreams : [];
  } catch (error) {
    console.warn('[starter-kit] openPreviewMonitor failed:', error);
  }
}

function onCameraSetupContinue(config: CameraConfig[]) {
  cameras.value = config;
  cameraSetupOpen.value = false;
  phase.value = 'calibration';
  calibrationOpen.value = true;

  try {
    const api = getIrisApi();
    if (api?.saveRunConfig) {
      void api.saveRunConfig({
        cameras: config.map((cam) => ({
          deviceId: cam.deviceId,
          label: cam.label,
          resolution: cam.resolution,
          fps: cam.fps,
          rotation: cam.rotation,
        })),
      });
    }
  } catch {
    // ignore missing or failing bridge; navigation should still continue
  }

  void startIrisRun(config);
}

function onCameraSetupClose() {
  cameraSetupOpen.value = false;
}

function onCalibrationComplete() {
  if (phase.value === 'live') return;
  calibrationOpen.value = false;
  phase.value = 'live';
  void openIrisPreview();
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
        :fps="liveFps"
        :joints-valid="liveJoints.valid"
        :joints-total="liveJoints.total"
        :pose="livePose"
        :video-streams="videoStreams"
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
      :cameras="cameras"
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
  -webkit-app-region: drag;
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: env(titlebar-area-height, 40px);
  padding-left: max(16px, env(titlebar-area-x, 16px));
  padding-right: max(12px, calc(100% - env(titlebar-area-x, 0px) - env(titlebar-area-width, 100%)));
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  background: #141820;
  flex-shrink: 0;
}

.brand {
  font-size: 12.5px;
  font-weight: 600;
  letter-spacing: 0.01em;
  color: #c7cbd6;
}

.topbar-right {
  -webkit-app-region: no-drag;
  display: flex;
  align-items: center;
  gap: 10px;
}

.status {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0.02em;
  color: #8b93a7;
  background: rgba(255, 255, 255, 0.04);
  padding: 3px 8px;
  border-radius: 20px;
}

.status.live {
  color: #4ade80;
  background: rgba(74, 222, 128, 0.1);
}

.status::before {
  content: '';
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: currentColor;
  opacity: 0.5;
}

.status.live::before {
  opacity: 1;
}

.icon-btn {
  -webkit-app-region: no-drag;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  background: none;
  border: none;
  border-radius: 6px;
  color: #8b93a7;
  font-size: 15px;
  cursor: pointer;
  padding: 0;
  line-height: 1;
  transition: background-color 0.1s ease, color 0.1s ease;
}

.icon-btn:hover {
  background: rgba(255, 255, 255, 0.06);
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
