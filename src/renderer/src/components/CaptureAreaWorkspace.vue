<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import type { Point2, RoiEdit, RoiMode, RoiState, SavedRoi } from '../../../shared/roi';
import CaptureFloorScene from './CaptureFloorScene.vue';
import CaptureCameraPreview from './CaptureCameraPreview.vue';
import { suggestedRectangle } from '../utils/roiGeometry';

const props = defineProps<{
  state: RoiState | null; saved: SavedRoi | null; error: string;
  getFrame: (streamId: number) => HTMLCanvasElement | undefined;
  rotationFor: (streamId: number) => number;
}>();
const emit = defineEmits<{ close: []; applied: [state: RoiState]; refresh: [] }>();
const mode = ref<RoiMode>('off');
const vertices = ref<Point2[]>([]), closed = ref(false), busy = ref(false), dirty = ref(false);
const message = ref(''), preview = ref<RoiState | null>(null);
const editCalibration = ref(0), editVersion = ref(0), editRun = ref<string>();
const history: Array<{ vertices: Point2[]; closed: boolean }> = [];
let serial = 0, alive = true;
let debounce: ReturnType<typeof setTimeout> | undefined;
const stale = computed(() => props.state && (props.state.runId !== editRun.value || props.state.calibrationVersion !== editCalibration.value || props.state.roiVersion !== editVersion.value));
const calibrated = computed(() => Boolean(props.state?.cameras.some(c => c.position && c.rotation && c.intrinsics)));
const editable = computed(() => calibrated.value && mode.value === 'manual' && !stale.value && !busy.value);
const canApply = computed(() => Boolean(props.state && !stale.value && !busy.value && preview.value && (mode.value !== 'manual' || (closed.value && preview.value.availability === 'active'))));
const canRestore = computed(() => Boolean(props.saved?.mode === 'manual' && props.saved.runId && props.saved.runId === props.state?.runId && props.saved.calibrationVersion === props.state?.calibrationVersion && props.saved.floorHeight === props.state?.floorHeight));
const viewState = computed(() => !stale.value && preview.value ? preview.value : props.state);
const area = computed(() => Math.abs(vertices.value.reduce((sum, p, i, all) => { const q = all[(i + 1) % all.length]; return sum + p[0] * q[1] - q[0] * p[1]; }, 0)) / 2);
function begin() { history.push({ vertices: vertices.value.map(p => [...p] as Point2), closed: closed.value }); if (history.length > 100) history.shift(); }
function undo() { const item = history.pop(); if (item) { vertices.value = item.vertices; closed.value = item.closed; } }
function rectangle() { begin(); vertices.value = suggestedRectangle(props.state?.cameras ?? [], props.state?.floorHeight ?? 0); closed.value = true; }
function edit(): RoiEdit {
  return { runId: editRun.value, mode: mode.value, calibrationVersion: editCalibration.value, roiVersion: editVersion.value,
    ...(mode.value === 'manual' ? { worldPolygon: vertices.value.map(p => [p[0], p[1]] as Point2) } : {}) };
}
function schedulePreview() {
  serial++; clearTimeout(debounce); preview.value = null; message.value = '';
  if (!props.state || stale.value || (mode.value === 'manual' && (!closed.value || !calibrated.value))) return;
  const sequence = serial;
  debounce = setTimeout(async () => {
    try {
      const result = await window.irisStarter.roiPreview(edit());
      if (!alive || sequence !== serial) return;
      preview.value = result.ok ? result.state ?? null : null;
      message.value = result.ok ? '' : result.error ?? 'Could not preview area';
    } catch (error) { if (alive && sequence === serial) message.value = String(error); }
  }, 250);
}
function reset() {
  mode.value = props.state?.mode ?? 'off';
  editCalibration.value = props.state?.calibrationVersion ?? 0; editVersion.value = props.state?.roiVersion ?? 0; editRun.value = props.state?.runId;
  // A polygon from a previous calibration has no valid location in the new frame.
  vertices.value = props.state?.availability === 'needs_review' ? [] : props.state?.worldPolygon.map(p => [...p] as Point2) ?? [];
  closed.value = vertices.value.length >= 3; history.length = 0;
  schedulePreview(); void nextTick(() => { dirty.value = false; });
}
watch([mode, vertices, closed], () => { dirty.value = true; schedulePreview(); }, { flush: 'sync' });
watch(stale, () => schedulePreview(), { flush: 'sync' });
watch(() => props.state, (state, previous) => { if (!previous && state && !dirty.value) reset(); });
reset();
async function apply() {
  if (!canApply.value) return;
  busy.value = true; serial++; clearTimeout(debounce);
  try {
    const result = await window.irisStarter.roiApply(edit());
    if (!alive) return;
    if (!result.ok || !result.state) { message.value = result.error ?? 'Could not apply area'; emit('refresh'); return; }
    editVersion.value = result.state.roiVersion; emit('applied', result.state);
    await nextTick(); clearTimeout(debounce); serial++; preview.value = result.state;
    dirty.value = false; message.value = result.saveError ?? 'Applied to IRIS and saved';
  } catch (error) { if (alive) { message.value = String(error); emit('refresh'); } }
  finally { busy.value = false; }
}
function restore() {
  if (!canRestore.value || !props.saved) return;
  begin(); mode.value = 'manual'; vertices.value = props.saved.worldPolygon.map(p => [...p] as Point2); closed.value = true;
}
function key(event: KeyboardEvent) {
  if (busy.value || ['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON'].includes((event.target as HTMLElement)?.tagName)) return;
  if (editable.value && event.key === 'Enter' && !closed.value && vertices.value.length >= 3) { begin(); closed.value = true; event.preventDefault(); }
  if (editable.value && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { undo(); event.preventDefault(); }
}
window.addEventListener('keydown', key);
onBeforeUnmount(() => { alive = false; serial++; clearTimeout(debounce); window.removeEventListener('keydown', key); });
</script>

<template>
  <section class="capture-workspace" aria-label="Capture area workspace">
    <header class="workspace-header">
      <div><h2>Capture area</h2><p>Define a shared floor area for tracking. Check its projection in each camera before applying.</p></div>
      <button :disabled="busy" @click="emit('close')">{{ dirty ? 'Discard draft / Back to live' : 'Back to live' }}</button>
    </header>
    <p v-if="error" role="alert" class="notice">{{ error }} <button @click="emit('refresh')">Retry</button></p>
    <p v-if="stale" class="notice" role="alert">Calibration or the applied area changed. This draft cannot be applied. <button :disabled="busy" @click="reset">Review current state</button></p>
    <p v-else-if="state?.availability === 'needs_review'" class="notice">Recalibration suspended the previous manual area. Draw a new area in this coordinate frame.</p>
    <div class="toolbar">
      <label>Mode <select v-model="mode" :disabled="busy || !state || !!stale"><option value="off">Off</option><option value="automatic">Automatic coverage</option><option value="manual">Manual floor area</option></select></label>
      <span>Applied: {{ state?.mode ?? 'unavailable' }} · {{ state?.availability.replaceAll('_', ' ') }}</span><span v-if="dirty">Unapplied draft</span>
    </div>
    <div v-if="mode === 'manual'" class="toolbar">
      <button :disabled="!editable" @click="rectangle">Start rectangle</button>
      <button :disabled="!editable" @click="undo">Undo</button>
      <button :disabled="!editable" @click="begin(); vertices = []; closed = false">Clear</button>
      <button :disabled="!editable || closed || vertices.length < 3" @click="begin(); closed = true">Close polygon</button>
      <span>{{ vertices.length }}/32 corners <template v-if="closed">· {{ area.toFixed(2) }} square world units</template></span>
    </div>
    <p v-if="!calibrated" class="notice">Waiting for camera geometry. This editor requires the updated IRIS Core build and calibrated cameras.</p>
    <p v-if="viewState?.availability === 'empty'" class="notice">No shared camera coverage was found. The area is not restricting tracking.</p>
    <p v-if="saved?.mode === 'manual' && state?.mode !== 'manual'" class="notice">{{ canRestore ? 'A saved area is available for this calibration.' : 'The saved area belongs to another coordinate frame. Draw a new area after recalibration.' }} <button v-if="canRestore" :disabled="!state || busy || !!stale" @click="restore">Load saved draft</button></p>
    <div class="workspace-body">
      <CaptureFloorScene :cameras="state?.cameras ?? []" :floor="state?.floorHeight ?? 0" :vertices="mode === 'manual' && !stale ? vertices : []"
        :closed="closed" :editable="editable" :segments="viewState?.worldSegments ?? []" :calibration-key="`${state?.runId}:${state?.calibrationVersion}`"
        @begin="begin" @change="vertices = $event" @close="closed = true" />
      <aside class="verification"><h3>{{ preview && dirty && !stale ? 'Draft preview' : 'Applied area' }}</h3>
        <p class="hint">Amber frustums show camera direction, not guaranteed visibility. Verify the floor boundary in these live views.</p>
        <section v-for="c in viewState?.cameras" :key="c.cameraId"><p>{{ c.label ?? 'Camera' }} · {{ c.cameraId + 1 }}</p>
          <CaptureCameraPreview :camera="c" :get-frame="getFrame" :rotation="rotationFor(c.streamId)" />
        </section>
      </aside>
    </div>
    <footer><span role="status">{{ message || (mode === 'manual' ? 'Click floor corners or start a rectangle. Drag corners to adjust; Enter closes the polygon.' : 'Changes take effect only after Apply.') }}</span>
      <button class="primary" :disabled="!canApply" @click="apply">{{ busy ? 'Applying…' : 'Apply capture area' }}</button></footer>
  </section>
</template>

<style scoped>
.capture-workspace { display: flex; flex-direction: column; flex: 1; min-height: 0; gap: 12px; color: #e5edf8; overflow-y: auto; padding-right: 4px; }
.workspace-header, .toolbar, footer { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.workspace-header, footer { justify-content: space-between; }
h2, h3, p { margin: 0; } h2 { font-size: 21px; margin-bottom: 6px; } h3 { font-size: 15px; }
.workspace-header p, .hint, .toolbar span, footer span { color: #a6b8cf; font-size: 13px; line-height: 1.5; }
.toolbar label { display: flex; align-items: center; gap: 8px; }
.workspace-body { display: grid; grid-template-columns: minmax(0, 1fr) 310px; gap: 14px; flex: 1; min-height: 520px; }
.verification { overflow-y: auto; max-height: 650px; display: flex; flex-direction: column; gap: 12px; }
.verification section > p { font-size: 13px; margin: 0 0 7px; }
.notice { padding: 10px 12px; border: 1px solid #576486; border-radius: 6px; background: #202a3c; font-size: 13px; }
button, select { background: #253044; border: 1px solid #536078; color: #eef4ff; border-radius: 5px; padding: 8px 12px; cursor: pointer; }
button:disabled, select:disabled { opacity: .45; cursor: default; }
.primary { background: #345fb0; white-space: nowrap; }
@media (max-width: 950px) { .workspace-body { grid-template-columns: 1fr; } .verification { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); max-height: none; } }
</style>
