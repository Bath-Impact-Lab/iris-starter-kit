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
it('saves the acknowledged region with stable device identity and capture orientation', () => {
  const { store } = setup();
  const state: RoiState = { mode: 'manual', availability: 'active', calibrationVersion: 1, roiVersion: 2,
    floorHeight: 0, worldAxes: 'XZ', worldPolygon: [[0, 0], [1, 0], [0, 1]],
    source: { cameraId: 4, width: 800, height: 600, vertices: [[.1, .5], [.9, .5], [.5, .9]] },
    cameras: [{ cameraId: 4, streamId: 0, deviceKey: 'device-a', width: 800, height: 600, segments: [] }] };
  store.save(state, 90);
  expect(store.load()).toMatchObject({ mode: 'manual', deviceKey: 'device-a', captureRotation: 90, source: state.source });
});
it('ignores corrupt, unsupported or invalid saved settings', () => {
  const { file, store } = setup();
  expect(store.load()).toBeNull();
  for (const value of ['invalid JSON', '{"schemaVersion":2,"mode":"automatic"}', '{"schemaVersion":1,"mode":"manual","source":{"vertices":[[0,0]]}}']) {
    fs.writeFileSync(file, value); expect(store.load()).toBeNull();
  }
});
it('round trips world-authored areas without a camera source', () => {
  const { store } = setup();
  const state: RoiState = { runId: 'run-a', mode: 'manual', availability: 'active', calibrationVersion: 3, roiVersion: 1,
    floorHeight: 0, worldAxes: 'XZ', worldPolygon: [[-2, -4], [2, -4], [0, -1]], source: null, cameras: [] };
  store.save(state, 0);
  expect(store.load()).toMatchObject({ worldPolygon: state.worldPolygon, source: null, runId: 'run-a', calibrationVersion: 3 });
});
