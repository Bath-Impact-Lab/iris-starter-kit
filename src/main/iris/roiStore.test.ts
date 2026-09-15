import { afterEach, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { RoiStore } from './roiStore';
import type { RoiState } from '../../shared/roi';
const folders: string[] = [];
afterEach(() => folders.splice(0).forEach(folder => fs.rmSync(folder, { recursive: true, force: true })));
function setup() {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'iris-roi-test-')); folders.push(folder);
  const file = path.join(folder, 'capture-area.json'); return { file, store: new RoiStore(file) };
}
it('ignores corrupt, unsupported or invalid saved settings', () => {
  const { file, store } = setup();
  expect(store.load()).toBeNull();
  for (const value of ['invalid JSON', '{"schemaVersion":2,"mode":"automatic"}']) {
    fs.writeFileSync(file, value); expect(store.load()).toBeNull();
  }
});
it('round trips world geometry and calibration provenance without legacy metadata', () => {
  const { store } = setup();
  const state: RoiState = { runId: 'run-a', mode: 'manual', availability: 'active', calibrationVersion: 3, roiVersion: 1,
    floorHeight: 1.5, worldAxes: 'XZ', worldPolygon: [[-2, -4], [2, -4], [0, -1]], source: null, cameras: [] };
  store.save(state);
  expect(store.load()).toMatchObject({ worldPolygon: state.worldPolygon, runId: 'run-a', calibrationVersion: 3, floorHeight: 1.5 });
  expect(store.load()).not.toHaveProperty('source');
  expect(Object.keys(store.load()!).sort()).toEqual(['schemaVersion', 'mode', 'worldPolygon', 'calibrationVersion', 'runId', 'floorHeight'].sort());
});

it.each([
  undefined,
  [[0, 0]],
  [[0, 0], [1, 0], [0, '1']],
  [[0, 0], [1, 0], [0, 10001]],
  [[0, 0], [1, 0], [0, 1, 2]],
  Array.from({ length: 33 }, (_, i) => [i, 0]),
].map(worldPolygon => ({ worldPolygon })))('rejects invalid saved world polygon %#', ({ worldPolygon }) => {
  const { file, store } = setup();
  fs.writeFileSync(file, JSON.stringify({ schemaVersion: 1, mode: 'manual', worldPolygon }));
  expect(store.load()).toBeNull();
});
