import assert from 'node:assert/strict';
import test from 'node:test';

import { buildConfigFromOptions } from './config.js';
import { ProcessManager } from './processManager.js';

test('buildConfigFromOptions includes the DA3 startup pipeline and pipe config', () => {
  const config = buildConfigFromOptions({
    run_id: 'test-run',
    camera_width: 1920,
    camera_height: 1080,
    video_fps: 30,
    cameras: [
      { id: '0', label: 'Camera 1', resolution: '1920x1080', fps: 30, rotation: 0 },
      { id: '1', label: 'Camera 2', resolution: '1920x1080', fps: 30, rotation: 0 },
    ],
  });

  assert.equal(config.defaults.output.shm_name, 'iris_shm_ipc');
  assert.equal(config.camera_groups.capture_rig.camera_ids.length, 2);
  assert.equal(config.camera_groups.capture_rig.fps, 30);
  assert.equal(config.pipeline?.calibration?.type, 'da3_startup');
});

test('ProcessManager exposes a minimal dispatcher lifecycle status', () => {
  const manager = new ProcessManager();
  const status = manager.getStatus();

  assert.equal(status.state, 'idle');
  assert.equal(status.previewOpen, false);
  assert.equal(status.runId, null);
});
