<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { MocapViewSettings, PoseFrame } from '../types';
import type { Da3Scene } from '../../../shared/roi';
import { skeletonForFrame, extractJointCenters3D, type JointCenter3D } from '../utils/pose';

const props = defineProps<{
  pose?: PoseFrame | null;
  settings: MocapViewSettings;
  pointCloud: Da3Scene | null;
}>();

const containerRef = ref<HTMLElement | null>(null);



const JOINT_RADIUS = 0.035;
// Briefly retain a joint through intermittent detections. Core already filters
// valid 3D poses, so drawing them directly avoids another layer of motion lag.
const MISS_FRAMES_BEFORE_HIDE = 5;

interface JointState {
  position: THREE.Vector3;
  missCount: number;
  everValid: boolean;
}

let renderer: THREE.WebGLRenderer | null = null;
let scene: THREE.Scene | null = null;
let camera: THREE.PerspectiveCamera | null = null;
let controls: OrbitControls | null = null;
let resizeObserver: ResizeObserver | null = null;
let animationFrameId: number | null = null;
let cloud: THREE.Points | null = null;

const jointGeometry = new THREE.SphereGeometry(JOINT_RADIUS, 16, 12);
const jointMaterial = new THREE.MeshStandardMaterial({ color: 0x6b9fff, emissive: 0x0d1c3a, roughness: 0.4 });
const boneMaterial = new THREE.MeshStandardMaterial({ color: 0x4a72c4, roughness: 0.5 });

const joints = new Map<string, THREE.Mesh>();
const bones = new Map<string, THREE.Mesh>();
const jointState = new Map<string, JointState>();

function isValid(center: JointCenter3D | undefined): center is JointCenter3D {
  return !!center && [center.x, center.y, center.z].every(Number.isFinite) &&
    (center.x !== 0 || center.y !== 0 || center.z !== 0);
}

function rebuildCloud(): void {
  if (!scene) return;
  if (cloud) {
    scene.remove(cloud);
    cloud.geometry.dispose();
    (cloud.material as THREE.Material).dispose();
    cloud = null;
  }
  const data = props.pointCloud;
  if (!data) return;
  const colors = new Float32Array(data.colors.length);
  const color = new THREE.Color();
  for (let i = 0; i < data.colors.length; i += 3) {
    color.setRGB(data.colors[i] / 255, data.colors[i + 1] / 255, data.colors[i + 2] / 255, THREE.SRGBColorSpace);
    colors[i] = color.r;
    colors[i + 1] = color.g;
    colors[i + 2] = color.b;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(data.positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  cloud = new THREE.Points(geometry, new THREE.PointsMaterial({
    size: 2, sizeAttenuation: false, vertexColors: true, transparent: true, opacity: 0.55, depthWrite: false,
  }));
  cloud.scale.setScalar(props.settings.scale);
  scene.add(cloud);
}

function buildScene(container: HTMLElement): void {
  scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x0a0c10, 3, 50);

  camera = new THREE.PerspectiveCamera(45, 1, 0.05, 100);
  camera.position.set(1.6, 1.4, 2.4);

  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  container.appendChild(renderer.domElement);

  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.target.set(0, 0.9, 0);
  controls.minDistance = 0.6;
  controls.maxDistance = 40;

  scene.add(new THREE.HemisphereLight(0xffffff, 0x1a2030, 1.1));
  const key = new THREE.DirectionalLight(0xffffff, 1.2);
  key.position.set(2, 3, 2);
  scene.add(key);

  const grid = new THREE.GridHelper(10, 20, 0x35507a, 0x1c2431);
  scene.add(grid);

  rebuildCloud();

  rebuildSkeleton();

  resizeScene(container.clientWidth, container.clientHeight);
  resizeObserver = new ResizeObserver((entries) => {
    for (const entry of entries) resizeScene(entry.contentRect.width, entry.contentRect.height);
  });
  resizeObserver.observe(container);

  const animate = (): void => {
    animationFrameId = requestAnimationFrame(animate);
    controls?.update();
    if (poseChanged) {
      poseChanged = false;
      updateScene();
    }
    if (renderer && scene && camera) renderer.render(scene, camera);
  };
  animationFrameId = requestAnimationFrame(animate);
}

let skeleton = skeletonForFrame(null);
function rebuildSkeleton(): void {
  if (!scene) return;
  for (const mesh of joints.values()) scene.remove(mesh);
  for (const mesh of bones.values()) { scene.remove(mesh); mesh.geometry.dispose(); }
  joints.clear();
  bones.clear();
  jointState.clear();
  skeleton = skeletonForFrame(props.pose);
  for (const name of skeleton.names) {
    const mesh = new THREE.Mesh(jointGeometry, jointMaterial);
    mesh.visible = false;
    if (name.startsWith('face_') || name.includes('_hand_')) mesh.scale.setScalar(0.25);
    joints.set(name, mesh);
    jointState.set(name, { position: new THREE.Vector3(), missCount: 0, everValid: false });
    scene.add(mesh);
  }
  for (const [from, to] of skeleton.bones) {
    const mesh = new THREE.Mesh(new THREE.CapsuleGeometry(props.settings.boneThickness, 0.1, 4, 8), boneMaterial);
    mesh.visible = false;
    mesh.userData.detail = from.startsWith('face_') || from.includes('_hand_');
    bones.set(`${from}-${to}`, mesh);
    scene.add(mesh);
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
  // Use the same world-origin transform as the DA3 cloud so they stay aligned.
  return new THREE.Vector3(center.x, center.y, center.z).multiplyScalar(props.settings.scale);
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
  cloud?.scale.setScalar(props.settings.scale);
  const centers = extractJointCenters3D(props.pose);
  const byName = new Map(centers.map((center) => [center.name, center]));

  for (const [name, mesh] of joints) {
    const state = jointState.get(name)!;
    const center = byName.get(name);

    if (isValid(center)) {
      state.position.copy(scaledPosition(center));
      state.everValid = true;
      state.missCount = 0;
      mesh.visible = true;
      mesh.position.copy(state.position);
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
      updateBone(jointState.get(from)!.position, jointState.get(to)!.position, mesh);
    } else {
      mesh.visible = false;
    }
  }
}

// Pose frames can arrive faster than the display refreshes, and updateScene
// is not cheap. Apply only the newest pose, right before the next render,
// so no work is spent on poses that are never drawn.
let poseChanged = false;
watch(() => props.pose, () => { poseChanged = true; });

watch(() => props.settings.scale, updateScene);
watch(() => props.settings.boneThickness, updateScene);
watch(() => props.pointCloud, () => {
  rebuildCloud();
  updateScene();
});

onMounted(() => {
  if (containerRef.value) buildScene(containerRef.value);
});

onBeforeUnmount(() => {
  if (animationFrameId !== null) cancelAnimationFrame(animationFrameId);
  resizeObserver?.disconnect();
  controls?.dispose();
  for (const mesh of bones.values()) mesh.geometry.dispose();
  if (cloud) { cloud.geometry.dispose(); (cloud.material as THREE.Material).dispose(); }
  jointGeometry.dispose();
  jointMaterial.dispose();
  boneMaterial.dispose();
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
