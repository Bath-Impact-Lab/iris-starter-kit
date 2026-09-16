import { expect, it } from 'vitest';
import { describePreviewMode, getCommonResolutionOptions, getCommonFpsOptions, nativeCameraProfiles, previewVideoConstraints, selectCommonConfig } from './camera-probe';
import type { CameraMode } from '../../../shared/capture';

const mode = (width: number, height: number, numerator: number, denominator = 1, format = 'MJPEG'): CameraMode =>
  ({ width, height, fpsNumerator: numerator, fpsDenominator: denominator, format });
const devices = [
  { id: 'a', label: 'A', modes: [mode(1920, 1080, 30), mode(1280, 720, 30), mode(1280, 720, 60), mode(1280, 720, 120)] },
  { id: 'b', label: 'B', modes: [mode(1920, 1080, 30), mode(1280, 720, 30), mode(1280, 720, 60)] },
];

it('offers FPS for a shared resolution rather than independent capability maxima', () => {
  expect(getCommonResolutionOptions(devices)).toEqual(['1920x1080', '1280x720']);
  expect(getCommonFpsOptions(devices, '1920x1080')).toEqual([30]);
  expect(getCommonFpsOptions(devices, '1280x720')).toEqual([60, 30]);
  expect(getCommonFpsOptions([devices[0]], '1280x720')).toEqual([120, 60, 30]);
  expect(selectCommonConfig(devices)).toEqual({ resolution: '1920x1080', fps: 30 });
});

it('retains fractional rates and collapses equivalent advertised rates', () => {
  const cameras = [{ id: 'a', label: 'A', modes: [mode(1280, 720, 60000, 1001), mode(1280, 720, 120000, 2002)] }];
  expect(getCommonFpsOptions(cameras, '1280x720')).toEqual([60000 / 1001]);
});

it('does not offer raw formats or a resolution with no shared FPS', () => {
  const cameras = [devices[0], { id: 'b', label: 'B', modes: [mode(1920, 1080, 25), mode(1280, 720, 60, 1, 'YUY2')] }];
  expect(getCommonResolutionOptions(cameras)).toEqual([]);
  expect(getCommonFpsOptions(cameras, '1920x1080')).toEqual([]);
});

it('uses browser ranges only as fallback candidates without capping at 60', () => {
  expect(getCommonFpsOptions([{ id: 'a', label: 'A', minFps: 25, maxFps: 120 }], '1280x720'))
    .toEqual([120, 90, 60, 50, 30, 25]);
});

it('assigns separate previews to identical models in enumeration order', () => {
  const native = [{ index: 4, name: 'Same camera', devicePath: 'path-a' }, { index: 7, name: 'Same camera', devicePath: 'path-b' }];
  expect(nativeCameraProfiles(native, [{ deviceId: 'browser-a', label: 'Same camera (1234:abcd)' },
    { deviceId: 'browser-b', label: 'Same camera (1234:abcd)' }]).map(profile => [profile.label, profile.browserDeviceId]))
    .toEqual([['Same camera 1', 'browser-a'], ['Same camera 2', 'browser-b']]);
  expect(nativeCameraProfiles(native, [{ deviceId: 'browser', label: 'Same camera' }]).map(profile => profile.browserDeviceId))
    .toEqual(['browser', undefined]);
  expect(nativeCameraProfiles([native[0]], [{ deviceId: 'browser', label: 'Same camera' }])[0])
    .toMatchObject({ id: 'path-a', nativeIndex: 4, browserDeviceId: 'browser' });
});

it('requests the selected capture shape and reports negotiated differences', () => {
  expect(previewVideoConstraints('camera-a', '1920x1080', 30)).toMatchObject({
    deviceId: { exact: 'camera-a' },
    width: { exact: 1920 },
    height: { exact: 1080 },
    frameRate: { ideal: 30 },
    aspectRatio: { ideal: 16 / 9 },
    resizeMode: { ideal: 'none' },
  });
  expect(previewVideoConstraints('camera-a', '1920x1080', 30, false)).toMatchObject({
    width: { ideal: 1920 }, height: { ideal: 1080 },
  });
  expect(describePreviewMode({ width: 1920, height: 1080, frameRate: 29.97 }, '1920x1080', 30))
    .toEqual({ width: 1920, height: 1080, fps: 29.97, approximate: false });
  expect(describePreviewMode({ width: 640, height: 480, frameRate: 30 }, '1920x1080', 30).approximate).toBe(true);
});
