import type { PoseFrame } from '../types';

export const BODY_JOINT_COUNT = 17;

// Halpe26 skeleton indexing that `joint_centers`/`joint_angles` use for
// their first 26 entries (core/stages/kinematics/kinematic_solver.cpp's
// anonymous `Halpe26` enum). Indices 26+ continue into the same array's
// COCO-WholeBody face/hand landmarks that `points_2d` also carries.
export const HALPE26_JOINT_NAMES = [
  'nose', 'l_eye', 'r_eye', 'l_ear', 'r_ear',
  'l_shoulder', 'r_shoulder', 'l_elbow', 'r_elbow', 'l_wrist', 'r_wrist',
  'l_hip', 'r_hip', 'l_knee', 'r_knee', 'l_ankle', 'r_ankle',
  'head', 'neck', 'pelvis',
  'l_big_toe', 'r_big_toe', 'l_small_toe', 'r_small_toe', 'l_heel', 'r_heel',
] as const;

// Of the 26 Halpe26 joints, only these get a real bone-direction quaternion
// out of IRIS's unconstrained kinematic solver; every other `joint_angles`
// slot is left at the identity quaternion.
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
  // Reordered from the pipe's [w, x, y, z] to [x, y, z, w] to match Unity's
  // `Quaternion` constructor directly.
  x: number;
  y: number;
  z: number;
  w: number;
}

// 3D joint positions in metres, one entry per Halpe26 joint. Positions with
// no detection come back as (0, 0, 0) -- same "no validity flag" caveat as
// extractBodyKeypoints2D below.
export function extractJointCenters3D(frame: PoseFrame | null | undefined): JointCenter3D[] {
  const person = frame?.people?.[0];
  const centers = person?.joint_centers;
  if (!Array.isArray(centers)) return [];

  return HALPE26_JOINT_NAMES.map((name, i) => {
    const [x, y, z] = centers[i] ?? [0, 0, 0];
    return { name, x, y, z };
  });
}

// Bone-direction quaternions for the joints IRIS actually computes one for
// (see JOINTS_WITH_REAL_ROTATION) -- the rest of `joint_angles` is identity
// and deliberately left out here rather than returned as fake rotation data.
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
