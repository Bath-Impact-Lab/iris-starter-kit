<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import type { CameraConfig, RigCalibrationStatus, VideoStreamDescriptor } from '../types';
import AppModal from './AppModal.vue';
import CameraFeedCanvas from './CameraFeedCanvas.vue';
import { RIG_CALIBRATION_TOUR } from '../tutorial/steps';
import { useTour } from '../tutorial/useTour';

const props = defineProps<{
  open: boolean;
  cameras: CameraConfig[];
}>();

const emit = defineEmits<{
  close: [];
}>();

// No fixed recording duration, matching Recapture-V3's manual-stop capture.
// This just tracks elapsed time for display.
const RECOMMENDED_MINIMUM_SECONDS = 20;

type Step = 'setup' | 'recording' | 'calibrating' | 'ready' | 'failed';

const step = ref<Step>('setup');
const markerSizeMm = ref(270);
const markerId = ref(42);
const elapsedSeconds = ref(0);
const errorMessage = ref<string | null>(null);
const result = ref<RigCalibrationStatus | null>(null);
const videoStreams = ref<VideoStreamDescriptor[]>([]);
let elapsedTimer: ReturnType<typeof setInterval> | null = null;

const tour = useTour();
// One-time setup: this component stays mounted across opens/closes, so
// don't call this again on every open or watchers would stack up.
tour.syncToPhase(step);

watch(
  () => props.open,
  (isOpen) => {
    if (isOpen && !tour.hasCompletedTour(RIG_CALIBRATION_TOUR.id)) {
      tour.start(RIG_CALIBRATION_TOUR);
    }
  },
);

watch(step, (value) => {
  // No dedicated tour step for 'failed'; the modal's own error text covers
  // it, so just end the tour quietly instead of leaving a stale bubble.
  if (value === 'failed' && tour.active.value) tour.skip();
});

const canStart = computed(() => props.cameras.length >= 2 && markerSizeMm.value > 0);
// User-facing label for the internal mode value, never shown raw.
const modeLabel = computed(() => (result.value?.mode === 'da3-aruco' ? 'ArUco-scaled' : 'Standard auto-calibration (relative scale)'));

function getIrisApi(): any {
  return (window as any).irisStarter ?? null;
}

function stopElapsedTimer() {
  if (elapsedTimer !== null) {
    clearInterval(elapsedTimer);
    elapsedTimer = null;
  }
}

function mappedCameras() {
  // Same { id, ... } shape App.vue sends to startRun, so the fingerprint
  // matches what startRun computes later.
  return props.cameras.map((cam) => ({
    id: cam.deviceId,
    label: cam.label,
    resolution: cam.resolution,
    fps: cam.fps,
    rotation: cam.rotation,
  }));
}

async function startRecording() {
  const api = getIrisApi();
  if (!api?.beginRigCalibrationCapture) {
    errorMessage.value = 'IRIS backend is unavailable';
    return;
  }

  errorMessage.value = null;
  try {
    // Resolution/rotation don't need passing through: recording just taps
    // the already-running `run` process. fps does need forwarding, since
    // the CLI otherwise defaults it to 30 regardless of actual config.
    const status: RigCalibrationStatus = await api.beginRigCalibrationCapture({
      cameraCount: props.cameras.length,
      targetFps: props.cameras[0]?.fps,
    });
    videoStreams.value = status.videoStreams ?? [];
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : 'Failed to start recording';
    return;
  }

  step.value = 'recording';
  elapsedSeconds.value = 0;
  elapsedTimer = setInterval(() => {
    elapsedSeconds.value += 1;
  }, 1000);
}

async function finishRecording() {
  stopElapsedTimer();
  videoStreams.value = [];
  step.value = 'calibrating';

  const api = getIrisApi();
  if (!api?.finishRigCalibrationCapture) {
    errorMessage.value = 'IRIS backend is unavailable';
    step.value = 'failed';
    return;
  }

  try {
    const status: RigCalibrationStatus = await api.finishRigCalibrationCapture({
      cameras: mappedCameras(),
      markerSizeMm: markerSizeMm.value,
      markerId: markerId.value,
    });
    result.value = status;
    step.value = status.stage === 'ready' ? 'ready' : 'failed';
    if (status.stage !== 'ready') {
      errorMessage.value = status.errorMessage ?? 'Rig calibration failed';
    }
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : 'Rig calibration failed';
    step.value = 'failed';
  }
}

async function cancel() {
  stopElapsedTimer();
  videoStreams.value = [];
  const api = getIrisApi();
  try {
    await api?.cancelRigCalibrationCapture?.();
  } catch {
    // ignore cleanup errors; the UI is resetting regardless
  }
  step.value = 'setup';
  errorMessage.value = null;
}

function retry() {
  result.value = null;
  errorMessage.value = null;
  step.value = 'setup';
}

function onClose() {
  if (step.value === 'recording' || step.value === 'calibrating') {
    void cancel();
  }
  emit('close');
}

onBeforeUnmount(() => {
  stopElapsedTimer();
  if (step.value === 'recording' || step.value === 'calibrating') {
    void getIrisApi()?.cancelRigCalibrationCapture?.().catch(() => undefined);
  }
});
</script>

<template>
  <AppModal title="Rig calibration (ArUco marker)" :open="open" @close="onClose">
    <div v-if="step === 'setup'" class="section">
      <p class="lead">
        Print one ArUco marker (dictionary DICT_6X6_250) at a precisely known size. This replaces
        live auto-calibration with a calibration scaled to real-world units from the marker;
        if it can't get a good enough reading, it automatically falls back to standard
        auto-calibration so calibration still completes.
      </p>

      <div class="howto" data-tour="rig-howto">
        <h4>How to hold the marker</h4>
        <ol>
          <li>Hold it flat, facing the midpoint between the cameras, not tilted steeply toward either one.</li>
          <li>Move to a spot where it's clearly visible in <strong>both</strong> live feeds below, then <strong>stop moving completely for a full 3+ seconds</strong> before moving to the next spot.</li>
          <li>Repeat at 3-4 different positions/heights within the shared view of both cameras.</li>
        </ol>
        <p class="hint">
          The hold time matters more than it looks: calibration checks each camera's recording
          independently in short snapshots, so a brief pause can still land on a slightly different
          instant in each camera. A longer, truly motionless hold makes it far more likely both
          cameras get a matching moment. Brief pauses or continuous movement are the most common
          reason this fails.
        </p>
      </div>

      <div class="field-row" data-tour="rig-marker-fields">
        <label class="field">
          <span>Marker size (mm)</span>
          <input v-model.number="markerSizeMm" type="number" min="1" step="1" />
        </label>
        <label class="field">
          <span>Marker ID</span>
          <input v-model.number="markerId" type="number" min="0" step="1" />
        </label>
      </div>

      <p v-if="cameras.length < 2" class="warn">Select at least two cameras in Camera Setup first.</p>
      <p v-if="errorMessage" class="warn">{{ errorMessage }}</p>
    </div>

    <div v-else-if="step === 'recording'" class="section">
      <div class="centered">
        <p class="lead">Hold the marker still for 3+ seconds at a time, in spots visible to both feeds below.</p>
        <div class="countdown">{{ elapsedSeconds }}s</div>
        <p class="hint">
          Click "Stop &amp; calibrate" once you've held it motionless at 3-4 different positions,
          each clearly visible in every camera ({{ RECOMMENDED_MINIMUM_SECONDS }}s total is a
          reasonable minimum).
        </p>
      </div>

      <div class="camera-grid" data-tour="rig-camera-grid">
        <div v-for="(cam, index) in cameras" :key="cam.deviceId" class="camera-pane">
          <header class="camera-pane-head">{{ cam.label }}</header>
          <div class="camera-pane-feed">
            <CameraFeedCanvas :camera-id="index" :video-streams="videoStreams" />
          </div>
        </div>
      </div>
    </div>

    <div v-else-if="step === 'calibrating'" class="section centered">
      <p class="lead">Running calibration…</p>
      <p class="hint">Analyzing the marker recording, falling back to standard auto-calibration if needed.</p>
    </div>

    <div v-else-if="step === 'ready'" class="section">
      <p class="success">
        Calibration published ({{ modeLabel }}).
      </p>
      <dl class="stats" data-tour="rig-stats">
        <dt>Mode</dt>
        <dd>{{ modeLabel }}</dd>
        <dt>Metric scale</dt>
        <dd>{{ result?.metricValid ? 'Yes' : 'No (relative scale only)' }}</dd>
        <!-- The fallback mode never sets this; showing its default 0.0 would look like a perfect fit. -->
        <template v-if="result?.mode === 'da3-aruco' && result?.meanReprojectionErrorPx !== undefined">
          <dt>Mean reprojection error</dt>
          <dd>{{ result.meanReprojectionErrorPx.toFixed(2) }}px</dd>
        </template>
      </dl>
      <p class="hint">This calibration is used automatically the next time you start a run with this exact camera setup.</p>
    </div>

    <div v-else class="section">
      <p class="warn">{{ errorMessage ?? 'Rig calibration failed' }}</p>
    </div>

    <template #footer>
      <button v-if="step === 'recording'" type="button" class="btn ghost" @click="cancel">Cancel</button>
      <button v-if="step === 'recording'" type="button" class="btn primary" data-tour="rig-stop" @click="finishRecording">
        Stop &amp; calibrate
      </button>

      <button
        v-if="step === 'setup'"
        type="button"
        class="btn primary"
        data-tour="rig-start"
        :disabled="!canStart"
        @click="startRecording"
      >
        Start recording
      </button>

      <button v-if="step === 'failed'" type="button" class="btn ghost" @click="retry">Retry</button>
      <button v-if="step === 'ready' || step === 'failed'" type="button" class="btn primary" @click="onClose">Done</button>
    </template>
  </AppModal>
</template>

<style scoped>
.section {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.section.centered {
  align-items: center;
  text-align: center;
  padding: 20px 0;
}

.centered {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  text-align: center;
}

.camera-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}

.camera-pane {
  flex: 0 1 240px;
  display: flex;
  flex-direction: column;
  background: #141820;
  border: 1px solid #252b38;
  border-radius: 6px;
  overflow: hidden;
}

.camera-pane-head {
  padding: 6px 10px;
  font-size: 12px;
  font-weight: 600;
  border-bottom: 1px solid #252b38;
}

.camera-pane-feed {
  aspect-ratio: 3 / 2;
  background: #0a0c10;
}

.lead {
  margin: 0;
  font-size: 13px;
  color: #9aa3b5;
}

.hint {
  margin: 0;
  font-size: 12px;
  color: #6b7280;
}

.howto {
  background: #141820;
  border: 1px solid #252b38;
  border-radius: 6px;
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.howto h4 {
  margin: 0;
  font-size: 12px;
  font-weight: 600;
  color: #e8eaed;
}

.howto ol {
  margin: 0;
  padding-left: 18px;
  font-size: 12px;
  color: #9aa3b5;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.warn {
  margin: 0;
  font-size: 12px;
  color: #f2b8b5;
}

.success {
  margin: 0;
  font-size: 13px;
  color: #4ade80;
}

.field-row {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
  color: #9aa3b5;
  max-width: 200px;
}

.field input {
  background: #0f1115;
  border: 1px solid #2a3140;
  border-radius: 4px;
  color: #e8eaed;
  padding: 6px 8px;
  font-size: 13px;
}

.countdown {
  font-size: 42px;
  font-weight: 700;
  color: #3b6fd9;
  font-variant-numeric: tabular-nums;
}

.stats {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 4px 12px;
  margin: 0;
  font-size: 12px;
}

.stats dt {
  color: #6b7280;
}

.stats dd {
  margin: 0;
  color: #e8eaed;
}

.btn {
  border-radius: 4px;
  border: 1px solid #2a3140;
  background: #1e2430;
  color: #e8eaed;
  padding: 8px 16px;
  font-size: 13px;
  cursor: pointer;
}

.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn.ghost {
  background: transparent;
}

.btn.primary {
  background: #3b6fd9;
  border-color: #3b6fd9;
}

.btn.primary:hover:not(:disabled) {
  background: #4a7de6;
}
</style>
