<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { Point2, RoiCamera } from '../../../shared/roi';
import { cameraRay, suggestedRectangle } from '../utils/roiGeometry';

const props = defineProps<{
  cameras: RoiCamera[]; floor: number; vertices: Point2[]; closed: boolean;
  segments: [number, number, number, number][]; editable: boolean; calibrationKey: string;
}>();
const emit = defineEmits<{ begin: []; change: [vertices: Point2[]]; close: [] }>();
const host = ref<HTMLElement>();
const orbit = ref(false);
const failure = ref('');
let renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.OrthographicCamera;
let controls: OrbitControls, observer: ResizeObserver, animation = 0;
let content: THREE.Group, handles: THREE.Object3D[] = [];
let span = 8, dragging = -1;
const raycaster = new THREE.Raycaster();
const target = new THREE.Vector3();
function dispose(group: THREE.Object3D) {
  group.traverse((o: any) => { o.geometry?.dispose(); if (Array.isArray(o.material)) o.material.forEach((m: any) => m.dispose()); else o.material?.dispose(); });
}
function line(points: THREE.Vector3[], color: number) {
  content.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), new THREE.LineBasicMaterial({ color })));
}
function floorPoint(p: Point2, offset = .015) { return new THREE.Vector3(p[0], props.floor + offset, p[1]); }
function rebuild() {
  if (!scene) return;
  if (content) { scene.remove(content); dispose(content); }
  content = new THREE.Group(); scene.add(content); handles = [];
  const grid = new THREE.GridHelper(100, 100, 0x536176, 0x263345); grid.position.y = props.floor; content.add(grid);
  for (const s of props.segments) line([floorPoint([s[0], s[1]]), floorPoint([s[2], s[3]])], 0x52d6ad);
  for (const c of props.cameras) {
    if (!c.position?.every(Number.isFinite)) continue;
    const origin = new THREE.Vector3(...c.position);
    const corners = [[0, 0], [c.width, 0], [c.width, c.height], [0, c.height]].map(([u, v]) => {
      const ray = cameraRay(c, u, v);
      return ray ? origin.clone().add(new THREE.Vector3(...ray).multiplyScalar(1.2)) : null;
    });
    const marker = new THREE.Mesh(new THREE.SphereGeometry(.09, 12, 8), new THREE.MeshBasicMaterial({ color: 0xffc574 }));
    marker.position.copy(origin); content.add(marker);
    line([origin, new THREE.Vector3(origin.x, props.floor, origin.z)], 0x786247);
    corners.forEach((p, i) => { if (p) { line([origin, p], 0xb38b52); const next = corners[(i + 1) % 4]; if (next) line([p, next], 0xb38b52); } });
    const label = document.createElement('canvas'); label.width = 256; label.height = 64;
    const ctx = label.getContext('2d')!; ctx.font = '26px sans-serif'; ctx.textAlign = 'center'; ctx.fillStyle = '#ffcf8a';
    ctx.fillText(`Camera ${c.cameraId + 1}`, 128, 42);
    const texture = new THREE.CanvasTexture(label);
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthTest: false }));
    // Map textures need separate disposal from materials.
    sprite.material.addEventListener('dispose', () => texture.dispose());
    sprite.position.copy(origin).add(new THREE.Vector3(0, .25, .35)); sprite.scale.set(2.4, .6, 1); content.add(sprite);
  }
  if (props.vertices.length) {
    const points = props.vertices.map(p => floorPoint(p, .035));
    if (props.closed) {
      points.push(points[0].clone());
      const shape = new THREE.Shape(props.vertices.map(p => new THREE.Vector2(p[0], -p[1])));
      const mesh = new THREE.Mesh(new THREE.ShapeGeometry(shape), new THREE.MeshBasicMaterial({ color: 0x79aaff, transparent: true, opacity: .2, side: THREE.DoubleSide, depthWrite: false }));
      mesh.rotation.x = -Math.PI / 2; mesh.position.y = props.floor + .02; content.add(mesh);
    }
    line(points, 0xa5c8ff);
    props.vertices.forEach((p, index) => {
      const handle = new THREE.Mesh(new THREE.SphereGeometry(Math.max(.05, span / 130), 16, 8), new THREE.MeshBasicMaterial({ color: index === 0 ? 0x52d6ad : 0xeaf2ff, depthTest: false }));
      handle.position.copy(floorPoint(p, .06)); handle.userData.index = index; handle.renderOrder = 10;
      content.add(handle); handles.push(handle);
    });
  }
}
function resize() {
  if (!renderer || !host.value) return;
  const w = host.value.clientWidth, h = host.value.clientHeight;
  const aspect = w / Math.max(h, 1);
  camera.left = -span * aspect / 2; camera.right = span * aspect / 2; camera.top = span / 2; camera.bottom = -span / 2;
  camera.updateProjectionMatrix(); renderer.setSize(w, h, false);
}
function view() {
  if (!camera) return;
  camera.up.set(0, orbit.value ? 1 : 0, orbit.value ? 0 : -1);
  camera.position.copy(target).add(orbit.value ? new THREE.Vector3(span * .6, span, span * .8) : new THREE.Vector3(0, span * 2, 0));
  controls.target.copy(target); controls.enableRotate = orbit.value; controls.update();
}
function fit() {
  if (!camera) return;
  const points: Point2[] = [...props.vertices, ...suggestedRectangle(props.cameras, props.floor)];
  props.cameras.forEach(c => { if (c.position?.every(Number.isFinite)) points.push([c.position[0], c.position[2]]); });
  props.segments.forEach(s => points.push([s[0], s[1]], [s[2], s[3]]));
  const xs = points.map(p => p[0]), zs = points.map(p => p[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minZ = Math.min(...zs), maxZ = Math.max(...zs);
  const aspect = (host.value?.clientWidth ?? 1) / Math.max(host.value?.clientHeight ?? 1, 1);
  span = Math.max(6, maxZ - minZ + 3, (maxX - minX + 3) / aspect);
  target.set((minX + maxX) / 2, props.floor, (minZ + maxZ) / 2); camera.zoom = 1; resize(); view(); rebuild();
}
function pointer(event: PointerEvent) {
  const rect = renderer.domElement.getBoundingClientRect();
  raycaster.setFromCamera(new THREE.Vector2((event.clientX - rect.left) / rect.width * 2 - 1, 1 - (event.clientY - rect.top) / rect.height * 2), camera);
  const hit = raycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -props.floor), new THREE.Vector3());
  return hit && Math.abs(hit.x) <= 10000 && Math.abs(hit.z) <= 10000 ? [hit.x, hit.z] as Point2 : null;
}
function down(event: PointerEvent) {
  if (!props.editable || orbit.value || event.button !== 0) return;
  const point = pointer(event); if (!point) return;
  const hit = raycaster.intersectObjects(handles)[0];
  if (hit?.object.userData.index === 0 && !props.closed && props.vertices.length >= 3) { emit('begin'); emit('close'); return; }
  if (!hit && (props.closed || props.vertices.length >= 32)) return;
  emit('begin');
  if (hit) { dragging = hit.object.userData.index; renderer.domElement.setPointerCapture(event.pointerId); }
  else emit('change', [...props.vertices, point]);
}
function move(event: PointerEvent) {
  if (dragging < 0 || !props.editable) return;
  const point = pointer(event); if (point) emit('change', props.vertices.map((p, i) => i === dragging ? point : p));
}
function up() { dragging = -1; }
watch(() => [props.vertices, props.closed, props.segments, props.cameras, props.floor], rebuild, { deep: true });
watch(() => props.calibrationKey, fit);
watch(orbit, view);
onMounted(() => {
  try {
    scene = new THREE.Scene(); scene.background = new THREE.Color(0x0d1520);
    camera = new THREE.OrthographicCamera(-5, 5, 5, -5, .01, 100000);
    renderer = new THREE.WebGLRenderer({ antialias: true }); renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    host.value!.appendChild(renderer.domElement);
    renderer.domElement.setAttribute('aria-label', 'Calibrated floor editor');
    controls = new OrbitControls(camera, renderer.domElement); controls.enableDamping = false;
    controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
    controls.minZoom = .1; controls.maxZoom = 30; controls.maxPolarAngle = Math.PI / 2 - .01;
    renderer.domElement.addEventListener('pointerdown', down); renderer.domElement.addEventListener('pointermove', move);
    renderer.domElement.addEventListener('pointerup', up); renderer.domElement.addEventListener('pointercancel', up);
    observer = new ResizeObserver(resize); observer.observe(host.value!); fit();
    const render = () => { animation = requestAnimationFrame(render); renderer.render(scene, camera); }; render();
  } catch { failure.value = 'The floor editor requires WebGL. Restart the app with graphics acceleration enabled.'; }
});
onBeforeUnmount(() => { cancelAnimationFrame(animation); observer?.disconnect(); controls?.dispose(); if (content) dispose(content); renderer?.dispose(); });
</script>

<template>
  <div class="floor-scene">
    <div class="view-tools"><button :aria-pressed="!orbit" @click="orbit = false">Top down · Edit</button><button :aria-pressed="orbit" @click="orbit = true">Orbit · Inspect</button><button @click="fit">Fit area</button></div>
    <div ref="host" class="viewport" />
    <p class="legend">{{ orbit ? 'Drag to orbit' : 'Click to draw · Drag corners' }} · Right-drag to pan · Scroll to zoom<br>Grid: 1 world unit · X right / −Z up in top view · Amber: camera frustums · Green: {{ segments.length ? 'area outline' : 'first corner' }}</p>
    <p v-if="failure" class="failure" role="alert">{{ failure }}</p>
  </div>
</template>

<style scoped>
.floor-scene { position: relative; background: #0d1520; min-height: 480px; height: 100%; border: 1px solid #2b3c51; border-radius: 10px; overflow: hidden; }
.viewport { position: absolute; inset: 0; touch-action: none; }
.viewport :deep(canvas) { display: block; width: 100%; height: 100%; }
.view-tools { position: absolute; top: 12px; left: 12px; display: flex; gap: 6px; z-index: 1; }
button { color: #dae6f8; background: #1c2b3e; border: 1px solid #445874; padding: 8px 10px; border-radius: 5px; cursor: pointer; }
button[aria-pressed=true] { border-color: #8ebaff; background: #294666; }
.legend { position: absolute; bottom: 8px; left: 12px; color: #a6b8cf; font-size: 12px; line-height: 1.7; pointer-events: none; }
.failure { position: absolute; inset: 100px 20px auto; color: #ffd18d; }
</style>
