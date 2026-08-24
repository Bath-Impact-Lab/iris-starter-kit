import type { PoseFrame } from '../types';

export const BODY_JOINT_COUNT = 17;

// Joint names for indices 0..25 of points_2d/joint_centers/joint_angles.
// Indices 26+ are face and hand landmarks and aren't named here.
export const HALPE26_JOINT_NAMES = [
  'nose', 'l_eye', 'r_eye', 'l_ear', 'r_ear',
  'l_shoulder', 'r_shoulder', 'l_elbow', 'r_elbow', 'l_wrist', 'r_wrist',
  'l_hip', 'r_hip', 'l_knee', 'r_knee', 'l_ankle', 'r_ankle',
  'head', 'neck', 'pelvis',
  'l_big_toe', 'r_big_toe', 'l_small_toe', 'r_small_toe', 'l_heel', 'r_heel',
] as const;

// Joints that come back with a real rotation in joint_angles; every other
// joint defaults to the identity rotation.
const JOINTS_WITH_REAL_ROTATION = new Set<string>([
  'l_hip', 'r_hip', 'l_knee', 'r_knee', 'l_shoulder', 'r_shoulder', 'l_elbow', 'r_elbow',
]);

export interface JointCenter3D {
  name: (typeof HALPE26_JOINT_NAMES)[number];
  x: number;
  y: number;
  z: number;
}

export interface JointRotation3D {
  name: (typeof HALPE26_JOINT_NAMES)[number];
  // [x, y, z, w], matching Unity's Quaternion constructor.
  x: number;
  y: number;
  z: number;
  w: number;
}

// 3D joint positions in metres. Undetected joints come back as (0, 0, 0).
export function extractJointCenters3D(frame: PoseFrame | null | undefined): JointCenter3D[] {
  const person = frame?.people?.[0];
  const centers = person?.joint_centers;
  if (!Array.isArray(centers)) return [];

  return HALPE26_JOINT_NAMES.map((name, i) => {
    const [x, y, z] = centers[i] ?? [0, 0, 0];
    return { name, x, y, z };
  });
}

// Rotations for the joints that have a real one (see
// JOINTS_WITH_REAL_ROTATION); the rest default to the identity rotation and
// are left out rather than returned as fake data.
export function extractJointRotations3D(frame: PoseFrame | null | undefined): JointRotation3D[] {
  const person = frame?.people?.[0];
  const angles = person?.joint_angles;
  if (!Array.isArray(angles)) return [];

  return HALPE26_JOINT_NAMES.map((name, i) => {
    const [w, x, y, z] = angles[i] ?? [1, 0, 0, 0];
    return { name, x, y, z, w };
  }).filter((joint) => JOINTS_WITH_REAL_ROTATION.has(joint.name));
}

export interface PoseKeypoint2D {
  x: number;
  y: number;
}

// `points_2d[jointIndex][cameraIndex] = [u, v]` raw pixel coords; COCO-17
// body joints are indices 0..16. (0, 0) means "no detection", there's no
// validity flag.
export function extractBodyKeypoints2D(frame: PoseFrame | null | undefined, cameraIndex = 0): Array<PoseKeypoint2D | null> {
  const person = frame?.people?.[0];
  const points = person?.points_2d;
  if (!Array.isArray(points)) return [];

  return points.slice(0, BODY_JOINT_COUNT).map((perCamera) => {
    const point = Array.isArray(perCamera) ? perCamera[cameraIndex] : undefined;
    if (!Array.isArray(point)) return null;
    const [x, y] = point;
    if (typeof x !== 'number' || typeof y !== 'number' || (x === 0 && y === 0)) return null;
    return { x, y };
  });
}

export function countValidKeypoints(points: Array<PoseKeypoint2D | null>): number {
  return points.filter((point): point is PoseKeypoint2D => point !== null).length;
}
