import { describe, expect, it } from 'vitest';

import { buildConfigFromOptions, PIPE_NAME } from './config.js';
import { ProcessManager } from './processManager.js';

describe('config', () => {
  it('PIPE_NAME uses the double-backslash Windows named pipe device format', () => {
    expect(PIPE_NAME).toBe('\\\\.\\pipe\\iris_ipc');
  });

  it('buildConfigFromOptions matches the IRIS spec top-level shape (run_id/runtime/shared/pipeline)', () => {
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

    expect(config.run_id).toBe('test-run');
    expect(config.runtime).toBeTruthy();
    expect(config.runtime.buffers.camera_width).toBe(1920);
    expect(config.shared).toBeTruthy();
    expect(config.shared.defaults.output.shm_name).toBe('iris_shm_ipc');
    expect(config.shared.camera_groups.capture_rig.camera_ids.length).toBe(2);
    expect(config.shared.camera_groups.capture_rig.fps).toBe(30);
    expect(config.pipeline.triangulation.da3_startup_calibration.model_type).toBe('base');
    expect('calibration' in config.pipeline).toBe(false);
  });

  it('ProcessManager exposes a minimal dispatcher lifecycle status', () => {
    const manager = new ProcessManager();
    const status = manager.getStatus();

    expect(status.state).toBe('idle');
    expect(status.previewOpen).toBe(false);
    expect(status.runId).toBe(null);
  });
});
