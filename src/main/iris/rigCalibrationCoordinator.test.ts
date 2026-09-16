import { describe, expect, it, vi } from 'vitest';

import { RigCalibrationCoordinator } from './rigCalibrationCoordinator.js';
import type { ArucoCalibrationResult } from './arucoCalibration.js';

function fakeRuntime() {
  return {
    startRecording: vi.fn(async () => [
      { cameraId: 0, url: 'ws://127.0.0.1:1234/camera/0' },
      { cameraId: 1, url: 'ws://127.0.0.1:1234/camera/1' },
    ]),
    stopRecording: vi.fn(async () => undefined),
  };
}

function fakeStore(published: { extrinsicsFile: string; mode: 'da3-aruco' | 'da3'; fingerprint: string; metricValid: boolean } | null = null) {
  return {
    readActive: vi.fn(() => published),
    readActiveFor: vi.fn((fingerprint: string) => (published?.fingerprint === fingerprint ? published : null)),
    publish: vi.fn((input: any) => ({
      extrinsicsFile: 'C:\\rig\\active\\extrinsics.json',
      mode: input.mode,
      fingerprint: input.fingerprint,
      capturedAt: '2026-01-01T00:00:00.000Z',
      meanReprojectionErrorPx: input.meanReprojectionErrorPx,
      metricValid: input.mode === 'da3-aruco',
    })),
    clear: vi.fn(),
  };
}

function makeCoordinator(overrides: {
  runtime?: ReturnType<typeof fakeRuntime>;
  calibrate?: (options: any) => Promise<ArucoCalibrationResult>;
  store?: ReturnType<typeof fakeStore>;
  videos?: Array<{ cameraId: number; path: string }>;
} = {}) {
  const runtime = overrides.runtime ?? fakeRuntime();
  const store = overrides.store ?? fakeStore();
  const calibrate = overrides.calibrate ?? (async () => ({ success: true, mode: 'da3-aruco' as const, extrinsicsPath: 'C:\\capture\\extrinsics.json', meanReprojectionErrorPx: 1.1 }));
  const videos = overrides.videos ?? [{ cameraId: 0, path: 'C:\\capture\\recording_cam0.mp4' }, { cameraId: 1, path: 'C:\\capture\\recording_cam1.mp4' }];

  const coordinator = new RigCalibrationCoordinator({
    runtime,
    store: store as any,
    calibrate: calibrate as any,
    createCaptureDirectory: () => 'C:\\capture',
    listCapturedVideos: () => videos,
    removeCaptureDirectory: vi.fn(),
  });

  return { coordinator, runtime, store, calibrate };
}

describe('RigCalibrationCoordinator', () => {
  it('forwards the caller-provided targetFps through to the runtime instead of a hardcoded default', async () => {
    const { coordinator, runtime } = makeCoordinator();

    await coordinator.beginCapture(2, 60);

    expect(runtime.startRecording).toHaveBeenCalledWith('C:\\capture', 2, 60);
  });

  it('rejects beginCapture with fewer than two cameras without touching the runtime', async () => {
    const { coordinator, runtime } = makeCoordinator();

    await expect(coordinator.beginCapture(1)).rejects.toThrow(/at least two/);
    expect(runtime.startRecording).not.toHaveBeenCalled();
    expect(coordinator.getStatus().stage).toBe('idle');
  });

  it('goes idle -> recording -> ready on a successful capture', async () => {
    const { coordinator, runtime } = makeCoordinator();

    await coordinator.beginCapture(2);
    expect(runtime.startRecording).toHaveBeenCalledWith('C:\\capture', 2, undefined);
    expect(coordinator.getStatus()).toMatchObject({
      stage: 'recording',
      videoStreams: [
        { cameraId: 0, url: 'ws://127.0.0.1:1234/camera/0' },
        { cameraId: 1, url: 'ws://127.0.0.1:1234/camera/1' },
      ],
    });

    const status = await coordinator.finishCapture({ fingerprint: 'fp-1' });
    expect(runtime.stopRecording).toHaveBeenCalledTimes(1);
    expect(status).toMatchObject({ stage: 'ready', mode: 'da3-aruco', metricValid: true });
  });

  it('publishes with the fallback mode reported by calibrateWithFallback', async () => {
    const { coordinator } = makeCoordinator({
      calibrate: async () => ({ success: true, mode: 'da3', extrinsicsPath: 'C:\\capture\\extrinsics.json', meanReprojectionErrorPx: 4.2 }),
    });

    await coordinator.beginCapture(2);
    const status = await coordinator.finishCapture({ fingerprint: 'fp-1' });

    expect(status).toMatchObject({ stage: 'ready', mode: 'da3', metricValid: false });
  });

  it('reports failed when calibration fails outright (both da3-aruco and da3 fallback)', async () => {
    const { coordinator, store } = makeCoordinator({
      calibrate: async () => ({ success: false, mode: 'da3', errorMessage: 'No marker detected in any frame' }),
    });

    await coordinator.beginCapture(2);
    const status = await coordinator.finishCapture({ fingerprint: 'fp-1' });

    expect(status).toMatchObject({ stage: 'failed', errorMessage: 'No marker detected in any frame' });
    expect(store.publish).not.toHaveBeenCalled();
  });

  it('fails finishCapture cleanly when fewer than two cameras produced a video', async () => {
    const { coordinator } = makeCoordinator({ videos: [{ cameraId: 0, path: 'C:\\capture\\recording_cam0.mp4' }] });

    await coordinator.beginCapture(2);
    const status = await coordinator.finishCapture({ fingerprint: 'fp-1' });

    expect(status.stage).toBe('failed');
    expect(status.errorMessage).toMatch(/at least two/);
  });

  it('cancelCapture stops recording and returns to idle without calibrating', async () => {
    const calibrateSpy = vi.fn(async () => ({ success: true, mode: 'da3-aruco' as const, extrinsicsPath: 'C:\\capture\\extrinsics.json' }));
    const { coordinator, runtime } = makeCoordinator({ calibrate: calibrateSpy as any });

    await coordinator.beginCapture(2);
    await coordinator.cancelCapture();

    expect(runtime.stopRecording).toHaveBeenCalledTimes(1);
    expect(calibrateSpy).not.toHaveBeenCalled();
    expect(coordinator.getStatus().stage).toBe('idle');
  });

  it('resolveExtrinsicsFile only returns a path when the fingerprint matches the published rig', () => {
    const { coordinator } = makeCoordinator({
      store: fakeStore({ extrinsicsFile: 'C:\\rig\\active\\extrinsics.json', mode: 'da3-aruco', fingerprint: 'fp-1', metricValid: true }),
    });

    expect(coordinator.resolveExtrinsicsFile('fp-1')).toBe('C:\\rig\\active\\extrinsics.json');
    expect(coordinator.resolveExtrinsicsFile('fp-2')).toBeNull();
  });
});
