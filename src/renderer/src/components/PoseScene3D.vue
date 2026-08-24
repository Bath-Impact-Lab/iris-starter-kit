<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { PoseFrame } from '../types';
import { HALPE26_JOINT_NAMES, extractJointCenters3D, type JointCenter3D } from '../utils/pose';

const props = defineProps<{
  pose?: PoseFrame | null;
}>();

const containerRef = ref<HTMLElement | null>(null);

// Bone connectivity between HALPE26_JOINT_NAMES entries.
const BONE_PAIRS: Array<[(typeof HALPE26_JOINT_NAMES)[number], (typeof HALPE26_JOINT_NAMES)[number]]> = [
  ['nose', 'l_eye'], ['nose', 'r_eye'], ['l_eye', 'l_ear'], ['r_eye', 'r_ear'],
  ['head', 'neck'], ['neck', 'l_shoulder'], ['neck', 'r_shoulder'],
  ['l_shoulder', 'l_elbow'], ['l_elbow', 'l_wrist'],
  ['r_shoulder', 'r_elbow'], ['r_elbow', 'r_wrist'],
  ['l_shoulder', 'r_shoulder'],
  ['l_hip', 'r_hip'],
  ['l_hip', 'l_knee'], ['l_knee', 'l_ankle'],
  ['r_hip', 'r_knee'], ['r_knee', 'r_ankle'],
  ['neck', 'pelvis'], ['pelvis', 'l_hip'], ['pelvis', 'r_hip'],
  ['l_ankle', 'l_big_toe'], ['l_ankle', 'l_small_toe'], ['l_ankle', 'l_heel'],
  ['r_ankle', 'r_big_toe'], ['r_ankle', 'r_small_toe'], ['r_ankle', 'r_heel'],
];

const JOINT_RADIUS = 0.035;
const BONE_RADIUS = 0.022;

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

function isValid(center: JointCenter3D | undefined): center is JointCenter3D {
  return Boolean(center) && (center!.x !== 0 || center!.y !== 0 || center!.z !== 0);
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

  for (const name of HALPE26_JOINT_NAMES) {
    const mesh = new THREE.Mesh(jointGeometry, jointMaterial);
    mesh.visible = false;
    joints.set(name, mesh);
    scene.add(mesh);
  }
  for (const [from, to] of BONE_PAIRS) {
    const mesh = new THREE.Mesh(new THREE.CapsuleGeometry(BONE_RADIUS, 0.1, 4, 8), boneMaterial);
    mesh.visible = false;
    bones.set(`${from}-${to}`, mesh);
    scene.add(mesh);
  }

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

function resizeScene(width: number, height: number): void {
  if (!renderer || !camera || width <= 0 || height <= 0) return;
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}

function updateBone(from: JointCenter3D, to: JointCenter3D, mesh: THREE.Mesh): void {
  const start = new THREE.Vector3(from.x, from.y, from.z);
  const end = new THREE.Vector3(to.x, to.y, to.z);
  const length = start.distanceTo(end);
  if (length < 0.005) {
    mesh.visible = false;
    return;
  }

  mesh.geometry.dispose();
  mesh.geometry = new THREE.CapsuleGeometry(BONE_RADIUS, length, 4, 8);
  mesh.visible = true;
  mesh.position.copy(start).add(end).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), end.clone().sub(start).normalize());
}

function updateScene(): void {
  const centers = extractJointCenters3D(props.pose);
  const byName = new Map(centers.map((center) => [center.name, center]));

  for (const [name, mesh] of joints) {
    const center = byName.get(name);
    mesh.visible = isValid(center);
    if (center && mesh.visible) mesh.position.set(center.x, center.y, center.z);
  }

  for (const [from, to] of BONE_PAIRS) {
    const mesh = bones.get(`${from}-${to}`);
    const a = byName.get(from);
    const b = byName.get(to);
    if (!mesh) continue;
    if (isValid(a) && isValid(b)) updateBone(a, b, mesh);
    else mesh.visible = false;
  }
}

watch(() => props.pose, updateScene);

onMounted(() => {
  if (containerRef.value) buildScene(containerRef.value);
});

onBeforeUnmount(() => {
  if (animationFrameId !== null) cancelAnimationFrame(animationFrameId);
  resizeObserver?.disconnect();
  controls?.dispose();
  for (const mesh of bones.values()) mesh.geometry.dispose();
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
