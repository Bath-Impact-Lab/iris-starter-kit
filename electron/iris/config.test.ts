import assert from 'node:assert/strict';
import test from 'node:test';

import { buildConfigFromOptions, PIPE_NAME } from './config.js';
import { ProcessManager } from './processManager.js';

test('PIPE_NAME uses the double-backslash Windows named pipe device format', () => {
  assert.equal(PIPE_NAME, '\\\\.\\pipe\\iris_ipc');
});

test('buildConfigFromOptions matches the IRIS spec top-level shape (run_id/runtime/shared/pipeline)', () => {
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

  assert.equal(config.run_id, 'test-run');
  assert.ok(config.runtime, 'spec requires a top-level "runtime" object');
  assert.equal(config.runtime.buffers.camera_width, 1920);
  assert.ok(config.shared, 'spec requires a top-level "shared" object');
  assert.equal(config.shared.defaults.output.shm_name, 'iris_shm_ipc');
  assert.equal(config.shared.camera_groups.capture_rig.camera_ids.length, 2);
  assert.equal(config.shared.camera_groups.capture_rig.fps, 30);
  assert.equal(
    config.pipeline.triangulation.da3_startup_calibration.model_type,
    'base',
  );
  assert.ok(!('calibration' in config.pipeline), 'IRIS has no standalone "calibration" pipeline stage');
});

test('ProcessManager exposes a minimal dispatcher lifecycle status', () => {
  const manager = new ProcessManager();
  const status = manager.getStatus();

  assert.equal(status.state, 'idle');
  assert.equal(status.previewOpen, false);
  assert.equal(status.runId, null);
});
