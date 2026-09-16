import { describe, expect, it } from 'vitest';
import { SKELETONS } from '../../../shared/skeletons';
import { extractJointCenters3D, extractJointRotations3D, extractKeypoints2D } from './pose';
import type { PoseFrame } from '../types';

describe('pose layouts', () => {
  it('uses model metadata rather than padded monitor array length', () => {
    const frame: PoseFrame = { pose_model: 'rtmpose-halpe26', people: [{
      joint_centers: Array.from({ length: 133 }, () => [1, 2, 3]),
    }] };
    expect(extractJointCenters3D(frame)).toHaveLength(26);
    expect(extractJointCenters3D(frame)[17]?.name).toBe('head');
    frame.pose_model = 'rtmw-coco133';
    const joints = extractJointCenters3D(frame);
    expect(joints).toHaveLength(133);
    expect(joints[17]?.name).toBe('l_big_toe');
    expect(joints[23]?.name).toBe('face_0');
    expect(joints[91]?.name).toBe('l_hand_0');
    expect(joints[112]?.name).toBe('r_hand_0');
    expect(extractJointRotations3D(frame)).toEqual([]);
  });

  it('only counts selected landmarks and rejects non-finite 2D coordinates', () => {
    const frame: PoseFrame = { pose_model: 'rtmpose-halpe26', people: [{
      points_2d: Array.from({ length: 133 }, () => [[100, 200]]),
    }] };
    frame.people![0]!.points_2d![0] = [[NaN, 1]];
    const points = extractKeypoints2D(frame);
    expect(points).toHaveLength(26);
    expect(points[0]).toBeNull();
  });

  it('connects only existing joints without duplicate names', () => {
    for (const layout of Object.values(SKELETONS)) {
      const names = new Set(layout.names);
      expect(names.size).toBe(layout.names.length);
      for (const [a, b] of layout.bones) {
        expect(names.has(a) && names.has(b)).toBe(true);
      }
    }
  });
});
