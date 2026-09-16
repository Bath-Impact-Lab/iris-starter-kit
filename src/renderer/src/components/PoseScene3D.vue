<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { MocapViewSettings, PoseFrame } from '../types';
import { skeletonForFrame, extractJointCenters3D, type JointCenter3D } from '../utils/pose';
import { fillTorsoAnchors, fitAnnyToJoints, loadAnnyBody, resetMeasurements, type AnnyBody, type HalpeName } from '../utils/annyBody';

const props = defineProps<{
  pose?: PoseFrame | null;
  settings: MocapViewSettings;
}>();

const emit = defineEmits<{
  // Whether the Anny body mesh in public/anny could be loaded.
  'body-status': [status: 'ready' | 'missing'];
}>();

const containerRef = ref<HTMLElement | null>(null);

const JOINT_RADIUS = 0.035;
// Per-frame joint data can be noisy/intermittent (occlusion, low confidence). Smooth
// positions toward each new reading instead of snapping, and give a joint a short grace
// period of missed frames before hiding it, instead of vanishing on the very first miss.
const SMOOTHING_ALPHA = 0.35;
const MISS_FRAMES_BEFORE_HIDE = 5;

interface JointState {
  smoothed: THREE.Vector3;
  missCount: number;
  everValid: boolean;
}

let renderer: THREE.WebGLRenderer | null = null;
let scene: THREE.Scene | null = null;
let camera: THREE.PerspectiveCamera | null = null;
let controls: OrbitControls | null = null;
let resizeObserver: ResizeObserver | null = null;
let animationFrameId: number | null = null;

const jointGeometry = new THREE.SphereGeometry(JOINT_RADIUS, 16, 12);
const jointMaterial = new THREE.MeshStandardMaterial({ color: 0x6b9fff, emissive: 0x0d1c3a, roughness: 0.4 });
const boneMaterial = new THREE.MeshStandardMaterial({ color: 0x4a72c4, roughness: 0.5 });

const joints = new Map<string, THREE.Mesh>();
const bones = new Map<string, THREE.Mesh>();
const jointState = new Map<string, JointState>();
// Joint spheres and bone capsules live in one group so the body view can hide them all at once --
// their own `visible` flags double as "this joint is currently valid" for the bone and body fit.
const skeletonGroup = new THREE.Group();
let body: AnnyBody | null = null;

function isValid(center: JointCenter3D | undefined): center is JointCenter3D {
  return !!center && [center.x, center.y, center.z].every(Number.isFinite) &&
    (center.x !== 0 || center.y !== 0 || center.z !== 0);
}

function buildScene(container: HTMLElement): void {
  scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x0a0c10, 3, 10);

  camera = new THREE.PerspectiveCamera(45, 1, 0.05, 50);
  camera.position.set(1.6, 1.4, 2.4);

  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  container.appendChild(renderer.domElement);

  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.target.set(0, 0.9, 0);
  controls.minDistance = 0.6;
  controls.maxDistance = 8;

  scene.add(new THREE.HemisphereLight(0xffffff, 0x1a2030, 1.1));
  const key = new THREE.DirectionalLight(0xffffff, 1.2);
  key.position.set(2, 3, 2);
  scene.add(key);

  const grid = new THREE.GridHelper(10, 20, 0x35507a, 0x1c2431);
  scene.add(grid);
  scene.add(skeletonGroup);

  void loadAnnyBody('./anny')
    .catch((error) => {
      console.error('[mocap] Anny body mesh failed to load', error);
      return null;
    })
    .then((loaded) => {
      if (!scene) {
        // Unmounted while loading.
        loaded?.mesh.geometry.dispose();
        (loaded?.mesh.material as THREE.Material | undefined)?.dispose();
        return;
      }
      body = loaded;
      if (body) scene.add(body.group);
      emit('body-status', body ? 'ready' : 'missing');
      updateScene();
    });

  rebuildSkeleton();

  resizeScene(container.clientWidth, container.clientHeight);
  resizeObserver = new ResizeObserver((entries) => {
    for (const entry of entries) resizeScene(entry.contentRect.width, entry.contentRect.height);
  });
  resizeObserver.observe(container);

  const animate = (): void => {
    animationFrameId = requestAnimationFrame(animate);
    controls?.update();
    if (renderer && scene && camera) renderer.render(scene, camera);
  };
  animationFrameId = requestAnimationFrame(animate);
}

let skeleton = skeletonForFrame(null);
function rebuildSkeleton(): void {
  if (!scene) return;
  for (const mesh of joints.values()) skeletonGroup.remove(mesh);
  for (const mesh of bones.values()) { skeletonGroup.remove(mesh); mesh.geometry.dispose(); }
  joints.clear();
  bones.clear();
  jointState.clear();
  skeleton = skeletonForFrame(props.pose);
  for (const name of skeleton.names) {
    const mesh = new THREE.Mesh(jointGeometry, jointMaterial);
    mesh.visible = false;
    if (name.startsWith('face_') || name.includes('_hand_')) mesh.scale.setScalar(0.25);
    joints.set(name, mesh);
    jointState.set(name, { smoothed: new THREE.Vector3(), missCount: 0, everValid: false });
    skeletonGroup.add(mesh);
  }
  for (const [from, to] of skeleton.bones) {
    const mesh = new THREE.Mesh(new THREE.CapsuleGeometry(props.settings.boneThickness, 0.1, 4, 8), boneMaterial);
    mesh.visible = false;
    mesh.userData.detail = from.startsWith('face_') || from.includes('_hand_');
    bones.set(`${from}-${to}`, mesh);
    skeletonGroup.add(mesh);
  }

  updateScene();
}

function resizeScene(width: number, height: number): void {
  if (!renderer || !camera || width <= 0 || height <= 0) return;
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}

function scaledPosition(center: JointCenter3D): THREE.Vector3 {
  const scale = props.settings.scale;
  return new THREE.Vector3(center.x * scale, center.y * scale, center.z * scale);
}

function updateBone(start: THREE.Vector3, end: THREE.Vector3, mesh: THREE.Mesh): void {
  const length = start.distanceTo(end);
  if (length < 0.005) {
    mesh.visible = false;
    return;
  }

  mesh.geometry.dispose();
  const detail = mesh.userData.detail ? 0.25 : 1;
  mesh.geometry = new THREE.CapsuleGeometry(props.settings.boneThickness * detail, length, 4, 8);
  mesh.visible = true;
  mesh.position.copy(start).add(end).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), end.clone().sub(start).normalize());
}

function updateScene(): void {
  if (skeleton !== skeletonForFrame(props.pose)) { rebuildSkeleton(); return; }
  const centers = extractJointCenters3D(props.pose);
  const byName = new Map(centers.map((center) => [center.name, center]));

  for (const [name, mesh] of joints) {
    const state = jointState.get(name)!;
    const center = byName.get(name);

    if (isValid(center)) {
      const raw = scaledPosition(center);
      if (state.everValid) state.smoothed.lerp(raw, SMOOTHING_ALPHA);
      else state.smoothed.copy(raw);
      state.everValid = true;
      state.missCount = 0;
      mesh.visible = true;
      mesh.position.copy(state.smoothed);
    } else if (state.everValid && state.missCount < MISS_FRAMES_BEFORE_HIDE) {
      // Brief dropout -- hold the last known position instead of vanishing immediately.
      state.missCount += 1;
    } else {
      mesh.visible = false;
    }
  }

  for (const [from, to] of skeleton.bones) {
    const mesh = bones.get(`${from}-${to}`);
    const fromMesh = joints.get(from);
    const toMesh = joints.get(to);
    if (!mesh || !fromMesh || !toMesh) continue;

    if (fromMesh.visible && toMesh.visible) {
      updateBone(jointState.get(from)!.smoothed, jointState.get(to)!.smoothed, mesh);
    } else {
      mesh.visible = false;
    }
  }

  // Without the mesh (not loaded, or failed to) the body view falls back to the skeleton.
  const showBody = props.settings.view === 'mesh' && body !== null;
  skeletonGroup.visible = !showBody;
  if (!body) return;
  body.group.visible = false;
  if (!showBody) return;

  const visibleJoints = new Map<HalpeName, THREE.Vector3>();
  for (const [name, mesh] of joints) {
    if (mesh.visible) visibleJoints.set(name as HalpeName, jointState.get(name)!.smoothed);
  }
  if (!skeleton.names.includes('pelvis')) fillTorsoAnchors(visibleJoints);
  if (!visibleJoints.has('pelvis')) return;
  fitAnnyToJoints(body, visibleJoints);
  body.group.visible = true;
}

// The body's size and limb lengths are measured once from joint positions, so re-measure whenever those
// change underneath it: the length slider rescales them, and a new run may be tracking someone else.
// Registered before the watchers below so the reset lands before the frame that triggered it is fitted.
watch([() => props.settings.scale, () => props.pose?.run_id], () => {
  if (body) resetMeasurements(body);
});

watch(() => props.pose, updateScene);

// scale/boneThickness are picked up on the next updateScene() call, which this triggers immediately.
watch(() => props.settings, updateScene, { deep: true });

onMounted(() => {
  if (containerRef.value) buildScene(containerRef.value);
});

onBeforeUnmount(() => {
  if (animationFrameId !== null) cancelAnimationFrame(animationFrameId);
  resizeObserver?.disconnect();
  controls?.dispose();
  for (const mesh of bones.values()) mesh.geometry.dispose();
  jointGeometry.dispose();
  jointMaterial.dispose();
  boneMaterial.dispose();
  body?.mesh.geometry.dispose();
  (body?.mesh.material as THREE.Material | undefined)?.dispose();
  body = null;
  scene = null;
  renderer?.dispose();
  renderer?.domElement.remove();
});
</script>

<template>
  <div ref="containerRef" class="scene3d"></div>
</template>

<style scoped>
.scene3d {
  width: 100%;
  height: 100%;
}

.scene3d :deep(canvas) {
  display: block;
  width: 100%;
  height: 100%;
}
</style>
