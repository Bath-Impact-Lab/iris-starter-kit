import { afterEach, expect, it } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Da3SceneSource, decodeDa3Ply, sceneMatchesCalibration } from './da3Scene';
import type { RoiState } from '../../shared/roi';

function ply(points: number[][]) {
  const header = Buffer.from(`ply\nformat binary_little_endian 1.0\nelement vertex ${points.length}\nproperty float x\nproperty float y\nproperty float z\nproperty uchar red\nproperty uchar green\nproperty uchar blue\nend_header\n`);
  const bytes = Buffer.alloc(points.length * 15);
  points.forEach((p, i) => { p.forEach((v, j) => bytes.writeFloatLE(v, i * 15 + j * 4)); bytes[i * 15 + 12] = 200; bytes[i * 15 + 13] = 100; bytes[i * 15 + 14] = 50; });
  return Buffer.concat([header, bytes]);
}
const state: RoiState = { runId: 'run', calibrationVersion: 1, roiVersion: 0, mode: 'off', availability: 'inactive', floorHeight: 0, worldAxes: 'XZ', worldPolygon: [], source: null,
  cameras: [{ cameraId: 7, streamId: 0, width: 1000, height: 600, segments: [], position: [1, 2, 3], rotation: [1, 0, 0, 0, 1, 0, 0, 0, 1] }] };
const extrinsics = { success: true, cameras: [{ cam_id: 7, extrinsics: { t: state.cameras[0].position, R: state.cameras[0].rotation } }] };
const folders: string[] = [];
afterEach(async () => { await Promise.all(folders.splice(0).map(dir => rm(dir, { recursive: true, force: true }))); });
async function setup() {
  const folder = await mkdtemp(path.join(os.tmpdir(), 'iris-scene-')); folders.push(folder);
  await writeFile(path.join(folder, 'extrinsics.json'), JSON.stringify(extrinsics));
  await writeFile(path.join(folder, 'scene.ply'), ply([[1, 0, 2], [2, 1, 3]]));
  return { folder, source: new Da3SceneSource('run', folder) };
}
it('decodes DA3 binary colours and coordinates and bounds point count', () => {
  const result = decodeDa3Ply(ply([[1, 2, 3], [4, 5, 6], [7, 8, 9], [10, 11, 12]]), 2);
  expect([...result.positions]).toEqual([1, 2, 3, 7, 8, 9]);
  expect([...result.colors]).toEqual([200, 100, 50, 200, 100, 50]);
  expect(result.originalPointCount).toBe(4);
});
it('rejects truncated or incompatible files and omits nonfinite vertices', () => {
  const valid = ply([[1, 2, 3]]);
  expect(() => decodeDa3Ply(valid.subarray(0, -1))).toThrow();
  expect(() => decodeDa3Ply(Buffer.from('ply\nformat ascii 1.0\nend_header\n'))).toThrow();
  expect([...decodeDa3Ply(ply([[NaN, 0, 0], [1, 2, 3]])).positions]).toEqual([1, 2, 3]);
});
it('requires camera identity, rotation and scaled translation to match', () => {
  expect(sceneMatchesCalibration(extrinsics, state)).toBe(true);
  expect(sceneMatchesCalibration(extrinsics, { ...state, cameras: [{ ...state.cameras[0], cameraId: 8 }] })).toBe(false);
  expect(sceneMatchesCalibration(extrinsics, { ...state, cameras: [{ ...state.cameras[0], position: [2, 4, 6] }] })).toBe(false);
});
it('caches within a run and refuses a different run or recalibration', async () => {
  const { source } = await setup();
  const scene = await source.load(state);
  expect(await source.load(state)).toBe(scene);
  await expect(source.load({ ...state, runId: 'other' })).rejects.toThrow();
  await expect(source.load({ ...state, calibrationVersion: 2 })).rejects.toThrow();
});
it('does not reuse a scene with mismatched extrinsics and can retry a missing output', async () => {
  const { folder, source } = await setup();
  await expect(source.load({ ...state, cameras: [{ ...state.cameras[0], position: [4, 5, 6] }] })).rejects.toThrow('does not match');
  await rm(path.join(folder, 'scene.ply'));
  await expect(source.load(state)).rejects.toThrow();
  await writeFile(path.join(folder, 'scene.ply'), ply([[1, 2, 3]]));
  expect((await source.load(state)).positions.length).toBe(3);
});
