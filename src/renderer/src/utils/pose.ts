import { SKELETONS } from '../../../shared/skeletons';
import { poseModel } from '../../../shared/poseModels';
import type { PoseFrame } from '../types';

export { HALPE26_JOINT_NAMES } from '../../../shared/skeletons';

export function skeletonForFrame(frame: PoseFrame | null | undefined) {
  return SKELETONS[poseModel(frame?.pose_model).layout];
}

// Joints that come back with a real rotation in joint_angles; every other
// joint defaults to the identity rotation.
const JOINTS_WITH_REAL_ROTATION = new Set<string>([
  'l_hip', 'r_hip', 'l_knee', 'r_knee', 'l_shoulder', 'r_shoulder', 'l_elbow', 'r_elbow',
]);

export interface JointCenter3D {
  name: string;
  x: number;
  y: number;
  z: number;
}

export interface JointRotation3D {
  name: string;
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

  return skeletonForFrame(frame).names.map((name, i) => {
    const [x, y, z] = centers[i] ?? [0, 0, 0];
    return { name, x, y, z };
  });
}

// Rotations for the joints that have a real one (see
// JOINTS_WITH_REAL_ROTATION); the rest default to the identity rotation and
// are left out rather than returned as fake data.
export function extractJointRotations3D(frame: PoseFrame | null | undefined): JointRotation3D[] {
  const person = frame?.people?.[0];
  // The core's rotation solver currently assumes HALPE-26.
  if (poseModel(frame?.pose_model).layout !== 'halpe26') return [];
  const angles = person?.joint_angles;
  if (!Array.isArray(angles)) return [];

  return skeletonForFrame(frame).names.map((name, i) => {
    const [w, x, y, z] = angles[i] ?? [1, 0, 0, 0];
    return { name, x, y, z, w };
  }).filter((joint) => JOINTS_WITH_REAL_ROTATION.has(joint.name));
}

export interface PoseKeypoint2D {
  x: number;
  y: number;
}

// `points_2d[jointIndex][cameraIndex] = [u, v]` raw pixel coordinates.
// (0, 0) means "no detection"; there is no separate validity flag.
export function extractKeypoints2D(frame: PoseFrame | null | undefined, cameraIndex = 0,
  count = skeletonForFrame(frame).names.length): Array<PoseKeypoint2D | null> {
  const person = frame?.people?.[0];
  const points = person?.points_2d;
  if (!Array.isArray(points)) return [];

  return points.slice(0, count).map((perCamera) => {
    const point = Array.isArray(perCamera) ? perCamera[cameraIndex] : undefined;
    if (!Array.isArray(point)) return null;
    const [x, y] = point;
    if (!Number.isFinite(x) || !Number.isFinite(y) || (x === 0 && y === 0)) return null;
    return { x, y };
  });
}

export function countValidKeypoints(points: Array<PoseKeypoint2D | null>): number {
  return points.filter((point): point is PoseKeypoint2D => point !== null).length;
}
