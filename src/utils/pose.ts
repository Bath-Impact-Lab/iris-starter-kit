import type { PoseFrame } from '../types';

export const BODY_JOINT_COUNT = 17;

export interface PoseKeypoint2D {
  x: number;
  y: number;
}

// `points_2d[jointIndex][cameraIndex] = [u, v]` raw pixel coords; COCO-17
// body joints are indices 0..16. (0, 0) means "no detection" -- there's no
// validity flag. See dont commit/IRIS-INTEGRATION-NOTES.md.
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
