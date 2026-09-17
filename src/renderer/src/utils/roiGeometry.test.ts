import { describe, expect, it } from 'vitest';
import { orientedSize, cameraRay, suggestedRectangle } from './roiGeometry';
describe('ROI preview dimensions', () => {
  it.each([0, 180, 360])('preserves dimensions at %i degrees', rotation => {
    expect(orientedSize(800, 600, rotation)).toEqual([800, 600]);
  });
  it.each([90, 270, -90, 450])('swaps dimensions at %i degrees', rotation => {
    expect(orientedSize(800, 600, rotation)).toEqual([600, 800]);
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
