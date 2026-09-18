<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { MocapViewSettings, PoseFrame, PosePerson } from '../types';
import type { Da3Scene } from '../../../shared/roi';
import { skeletonForFrame, extractJointCenters3D, type JointCenter3D } from '../utils/pose';

const props = defineProps<{ pose?: PoseFrame | null; settings: MocapViewSettings; pointCloud: Da3Scene | null }>();
const containerRef = ref<HTMLElement | null>(null);
const JOINT_RADIUS = 0.035;
// Core already filters valid 3D poses, so drawing them directly avoids another layer of motion lag.
const MISS_FRAMES_BEFORE_HIDE = 5;
const PERSON_FRAMES_BEFORE_REMOVE = 15;
const PERSON_COLOURS = [0x6b9fff, 0xff8a65, 0x62d49b, 0xc792ea, 0xffcb6b, 0x89ddff];

interface JointState {
  position: THREE.Vector3;
  missCount: number;
  everValid: boolean;
}

interface PersonVisual {
  group: THREE.Group;
  joints: Map<string, THREE.Mesh>;
  bones: Map<string, THREE.Mesh>;
  jointState: Map<string, JointState>;
  jointMaterial: THREE.MeshStandardMaterial;
  boneMaterial: THREE.MeshStandardMaterial;
  missedFrames: number;
}

let renderer: THREE.WebGLRenderer | null = null;
let scene: THREE.Scene | null = null;
let camera: THREE.PerspectiveCamera | null = null;
let controls: OrbitControls | null = null;
let resizeObserver: ResizeObserver | null = null;
let animationFrameId: number | null = null;
let cloud: THREE.Points | null = null;
let skeleton = skeletonForFrame(null);
let poseChanged = false;

const jointGeometry = new THREE.SphereGeometry(JOINT_RADIUS, 16, 12);
// Unit geometry is shared by every bone. Length/thickness are mesh scales,
// avoiding a GPU geometry allocation and disposal on every frame.
const boneGeometry = new THREE.CylinderGeometry(1, 1, 1, 8, 1, false);
const people = new Map<string, PersonVisual>();
const unitY = new THREE.Vector3(0, 1, 0);
const direction = new THREE.Vector3();

function isValid(center: JointCenter3D | undefined): center is JointCenter3D {
  return !!center && [center.x, center.y, center.z].every(Number.isFinite) &&
    (center.x !== 0 || center.y !== 0 || center.z !== 0);
}

function personKey(person: PosePerson, index: number): string {
  return Number.isFinite(person.person_id) ? `id:${person.person_id}` : `anonymous:${index}`;
}

function colourFor(key: string): number {
  let hash = 0;
  for (let i = 0; i < key.length; i += 1) hash = ((hash << 5) - hash + key.charCodeAt(i)) | 0;
  return PERSON_COLOURS[Math.abs(hash) % PERSON_COLOURS.length]!;
}

function createPersonVisual(key: string): PersonVisual {
  const group = new THREE.Group();
  group.userData.personKey = key;
  const colour = colourFor(key);
  const jointMaterial = new THREE.MeshStandardMaterial({
    color: colour, emissive: colour, emissiveIntensity: 0.08, roughness: 0.4,
  });
  const boneMaterial = new THREE.MeshStandardMaterial({ color: colour, roughness: 0.5 });
  const visual: PersonVisual = {
    group, joints: new Map(), bones: new Map(), jointState: new Map(),
    jointMaterial, boneMaterial, missedFrames: 0,
  };

  for (const name of skeleton.names) {
    const mesh = new THREE.Mesh(jointGeometry, jointMaterial);
    mesh.visible = false;
    if (name.startsWith('face_') || name.includes('_hand_')) mesh.scale.setScalar(0.25);
    visual.joints.set(name, mesh);
    visual.jointState.set(name, { position: new THREE.Vector3(), missCount: 0, everValid: false });
    group.add(mesh);
  }
  for (const [from, to] of skeleton.bones) {
    const mesh = new THREE.Mesh(boneGeometry, boneMaterial);
    mesh.visible = false;
    mesh.userData.detail = from.startsWith('face_') || from.includes('_hand_');
    visual.bones.set(`${from}-${to}`, mesh);
    group.add(mesh);
  }
  scene?.add(group);
  people.set(key, visual);
  return visual;
}

function removePersonVisual(key: string): void {
  const visual = people.get(key);
  if (!visual) return;
  scene?.remove(visual.group);
  visual.jointMaterial.dispose();
  visual.boneMaterial.dispose();
  people.delete(key);
}

function clearPeople(): void {
  for (const key of [...people.keys()]) removePersonVisual(key);
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
  scene.add(new THREE.GridHelper(10, 20, 0x35507a, 0x1c2431));
  rebuildCloud();

  resizeScene(container.clientWidth, container.clientHeight);
  resizeObserver = new ResizeObserver((entries) => {
    for (const entry of entries) resizeScene(entry.contentRect.width, entry.contentRect.height);
  });
  resizeObserver.observe(container);

  const animate = (): void => {
    animationFrameId = requestAnimationFrame(animate);
    controls?.update();
    if (poseChanged) { poseChanged = false; updateScene(); }
    if (renderer && scene && camera) renderer.render(scene, camera);
  };
  poseChanged = true;
  animationFrameId = requestAnimationFrame(animate);
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
  if (length < 0.005) { mesh.visible = false; return; }
  const detail = mesh.userData.detail ? 0.25 : 1;
  const radius = props.settings.boneThickness * detail;
  mesh.visible = true;
  mesh.position.copy(start).add(end).multiplyScalar(0.5);
  direction.copy(end).sub(start).normalize();
  mesh.quaternion.setFromUnitVectors(unitY, direction);
  mesh.scale.set(radius, length, radius);
}

function updatePerson(frame: PoseFrame, person: PosePerson, visual: PersonVisual): void {
  visual.missedFrames = 0;
  const byName = new Map(extractJointCenters3D(frame, person).map((center) => [center.name, center]));
  for (const [name, mesh] of visual.joints) {
    const state = visual.jointState.get(name)!;
    const center = byName.get(name);
    if (isValid(center)) {
      state.position.copy(scaledPosition(center));
      state.everValid = true;
      state.missCount = 0;
      mesh.visible = true;
      mesh.position.copy(state.position);
    } else if (state.everValid && state.missCount < MISS_FRAMES_BEFORE_HIDE) {
      state.missCount += 1;
    } else {
      mesh.visible = false;
    }
  }

  for (const [from, to] of skeleton.bones) {
    const mesh = visual.bones.get(`${from}-${to}`);
    const fromMesh = visual.joints.get(from);
    const toMesh = visual.joints.get(to);
    if (!mesh || !fromMesh || !toMesh) continue;
    if (fromMesh.visible && toMesh.visible) {
      updateBone(visual.jointState.get(from)!.position, visual.jointState.get(to)!.position, mesh);
    } else {
      mesh.visible = false;
    }
  }
}

function updateScene(): void {
  cloud?.scale.setScalar(props.settings.scale);
  const nextSkeleton = skeletonForFrame(props.pose);
  if (skeleton !== nextSkeleton) { skeleton = nextSkeleton; clearPeople(); }

  const frame = props.pose;
  const activeKeys = new Set<string>();
  for (const [index, person] of (frame?.people ?? []).entries()) {
    const key = personKey(person, index);
    activeKeys.add(key);
    updatePerson(frame!, person, people.get(key) ?? createPersonVisual(key));
  }
  for (const [key, visual] of people) {
    if (activeKeys.has(key)) continue;
    visual.missedFrames += 1;
    if (visual.missedFrames > PERSON_FRAMES_BEFORE_REMOVE) removePersonVisual(key);
  }
}

watch(() => props.pose, () => { poseChanged = true; });
watch(() => props.settings, () => { poseChanged = true; }, { deep: true });
watch(() => props.pointCloud, () => {
  rebuildCloud();
  poseChanged = true;
});
onMounted(() => { if (containerRef.value) buildScene(containerRef.value); });
onBeforeUnmount(() => {
  if (animationFrameId !== null) cancelAnimationFrame(animationFrameId);
  resizeObserver?.disconnect();
  controls?.dispose();
  clearPeople();
  if (cloud) { cloud.geometry.dispose(); (cloud.material as THREE.Material).dispose(); }
  jointGeometry.dispose();
  boneGeometry.dispose();
  renderer?.dispose();
  renderer?.domElement.remove();
});
</script>

<template>
  <div ref="containerRef" class="scene3d"></div>
</template>

<style scoped>
.scene3d { width: 100%; height: 100%; }
.scene3d :deep(canvas) { display: block; width: 100%; height: 100%; }
</style>
