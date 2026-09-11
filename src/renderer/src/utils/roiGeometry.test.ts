import { describe, expect, it } from 'vitest';
import { rotatePoint, orientedSize, cameraRay, suggestedRectangle } from './roiGeometry';
describe('ROI image coordinates', () => {
  it.each([0, 90, 180, 270, -90, 450])('round trips rotation %i without changing canonical coordinates', rotation => {
    for (const point of [[0, 0], [1, 1], [.2, .7]] as [number, number][]) {
      const restored = rotatePoint(rotatePoint(point, rotation), -rotation);
      expect(restored[0]).toBeCloseTo(point[0]); expect(restored[1]).toBeCloseTo(point[1]);
    }
  });
  it('rotates non-widescreen dimensions and corners correctly', () => {
    expect(orientedSize(800, 600, 90)).toEqual([600, 800]);
    expect(rotatePoint([0, 0], 90)).toEqual([1, 0]);
    expect(rotatePoint([1, 0], 270)).toEqual([0, 0]);
  });
});

const camera = { cameraId: 7, streamId: 0, width: 1000, height: 600, segments: [],
  position: [0, 2, 0] as [number, number, number], rotation: [1, 0, 0, 0, -1, 0, 0, 0, -1], intrinsics: [500, 50, 500, 0, 500, 300, 0, 0, 1] };
it('uses pinhole skew and camera-to-world rotation for frustum rays', () => {
  expect(cameraRay(camera, 525, 550)).toEqual([0, -.5, -1]);
  expect(cameraRay({ ...camera, intrinsics: [] }, 0, 0)).toBeNull();
});
it('places a starter rectangle at forward floor intersections and handles missing geometry', () => {
  const rectangle = suggestedRectangle([{ ...camera, intrinsics: [500, 0, 500, 0, 500, 300, 0, 0, 1] }], 0);
  expect(rectangle[0][0]).toBe(-1); expect(rectangle[0][1]).toBeCloseTo(-2 / .3 - 1);
  expect(suggestedRectangle([], 0)).toEqual([[-1, -1], [1, -1], [1, 1], [-1, 1]]);
});
