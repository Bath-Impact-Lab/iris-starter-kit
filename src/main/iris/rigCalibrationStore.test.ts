import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { computeCameraFingerprint, RigCalibrationStore } from './rigCalibrationStore.js';

describe('computeCameraFingerprint', () => {
  it('is stable for the same camera configuration', () => {
    const input = { cameras: [{ id: '0', label: 'Cam 1' }, { id: '1', label: 'Cam 2' }], rotation: 90 };
    expect(computeCameraFingerprint(input)).toBe(computeCameraFingerprint(input));
  });

  it('changes when a camera is added, removed, or reconfigured', () => {
    const base = computeCameraFingerprint({ cameras: [{ id: '0' }, { id: '1' }], rotation: 0 });
    const rotated = computeCameraFingerprint({ cameras: [{ id: '0' }, { id: '1' }], rotation: 90 });
    const fewerCameras = computeCameraFingerprint({ cameras: [{ id: '0' }], rotation: 0 });

    expect(rotated).not.toBe(base);
    expect(fewerCameras).not.toBe(base);
  });
});

describe('RigCalibrationStore', () => {
  let rootDir: string;
  let sourceExtrinsics: string;

  beforeEach(() => {
    rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rig-calib-store-'));
    sourceExtrinsics = path.join(rootDir, 'candidate-extrinsics.json');
    fs.writeFileSync(sourceExtrinsics, JSON.stringify({ cameras: [] }));
  });

  afterEach(() => {
    fs.rmSync(rootDir, { recursive: true, force: true });
  });

  it('returns null when nothing has been published yet', () => {
    const store = new RigCalibrationStore(rootDir);
    expect(store.readActive()).toBeNull();
    expect(store.readActiveFor('any-fingerprint')).toBeNull();
  });

  it('publishes and reads back the active calibration', () => {
    const store = new RigCalibrationStore(rootDir);
    const published = store.publish({
      extrinsicsSourcePath: sourceExtrinsics,
      mode: 'da3-aruco',
      fingerprint: 'fp-1',
      meanReprojectionErrorPx: 1.4,
    });

    expect(published.metricValid).toBe(true);
    expect(fs.existsSync(published.extrinsicsFile)).toBe(true);

    const active = store.readActiveFor('fp-1');
    expect(active).toMatchObject({ mode: 'da3-aruco', fingerprint: 'fp-1', metricValid: true });
  });

  it('marks the da3 fallback as not metric-valid', () => {
    const store = new RigCalibrationStore(rootDir);
    const published = store.publish({
      extrinsicsSourcePath: sourceExtrinsics,
      mode: 'da3',
      fingerprint: 'fp-1',
    });

    expect(published.metricValid).toBe(false);
  });

  it('returns null when the fingerprint no longer matches the published rig', () => {
    const store = new RigCalibrationStore(rootDir);
    store.publish({ extrinsicsSourcePath: sourceExtrinsics, mode: 'da3-aruco', fingerprint: 'fp-1' });

    expect(store.readActiveFor('fp-2')).toBeNull();
    expect(store.readActive()).not.toBeNull();
  });

  it('clear() removes the published calibration', () => {
    const store = new RigCalibrationStore(rootDir);
    store.publish({ extrinsicsSourcePath: sourceExtrinsics, mode: 'da3-aruco', fingerprint: 'fp-1' });
    store.clear();

    expect(store.readActive()).toBeNull();
  });

  it('copies sibling intrinsics_cam<N>.json files alongside extrinsics.json (reconstruction writes them into the same output dir)', () => {
    fs.writeFileSync(path.join(rootDir, 'intrinsics_cam0.json'), JSON.stringify({ K: [1] }));
    fs.writeFileSync(path.join(rootDir, 'intrinsics_cam1.json'), JSON.stringify({ K: [2] }));
    fs.writeFileSync(path.join(rootDir, 'report.json'), JSON.stringify({ note: 'not needed at runtime' }));

    const store = new RigCalibrationStore(rootDir);
    store.publish({ extrinsicsSourcePath: sourceExtrinsics, mode: 'da3-aruco', fingerprint: 'fp-1' });

    const activeDir = path.join(rootDir, 'active');
    expect(fs.existsSync(path.join(activeDir, 'intrinsics_cam0.json'))).toBe(true);
    expect(fs.existsSync(path.join(activeDir, 'intrinsics_cam1.json'))).toBe(true);
    expect(fs.existsSync(path.join(activeDir, 'report.json'))).toBe(false);
  });

  it('drops stale intrinsics files from a previous publish with more cameras', () => {
    const store = new RigCalibrationStore(rootDir);

    fs.writeFileSync(path.join(rootDir, 'intrinsics_cam0.json'), '{}');
    fs.writeFileSync(path.join(rootDir, 'intrinsics_cam1.json'), '{}');
    fs.writeFileSync(path.join(rootDir, 'intrinsics_cam2.json'), '{}');
    store.publish({ extrinsicsSourcePath: sourceExtrinsics, mode: 'da3-aruco', fingerprint: 'fp-1' });

    fs.rmSync(path.join(rootDir, 'intrinsics_cam2.json'));
    store.publish({ extrinsicsSourcePath: sourceExtrinsics, mode: 'da3-aruco', fingerprint: 'fp-2' });

    const activeDir = path.join(rootDir, 'active');
    expect(fs.existsSync(path.join(activeDir, 'intrinsics_cam0.json'))).toBe(true);
    expect(fs.existsSync(path.join(activeDir, 'intrinsics_cam1.json'))).toBe(true);
    expect(fs.existsSync(path.join(activeDir, 'intrinsics_cam2.json'))).toBe(false);
  });
});
