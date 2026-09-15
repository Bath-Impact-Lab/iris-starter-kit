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

  it('buildConfigFromOptions swaps in calibration_dir/extrinsics_file when a published extrinsics file is passed', () => {
    const config = buildConfigFromOptions({
      run_id: 'test-run',
      cameras: [{ id: '0' }, { id: '1' }],
      extrinsics_file: 'C:\\Users\\test\\AppData\\Roaming\\ReCapture\\rig_calibration\\active\\extrinsics.json',
    });

    expect(config.pipeline.triangulation.extrinsics_file).toBe(
      'C:/Users/test/AppData/Roaming/ReCapture/rig_calibration/active/extrinsics.json',
    );
    expect(config.pipeline.triangulation.calibration_dir).toBe(
      'C:/Users/test/AppData/Roaming/ReCapture/rig_calibration/active',
    );
    expect('da3_startup_calibration' in config.pipeline.triangulation).toBe(false);
  });

  it('ProcessManager exposes a minimal dispatcher lifecycle status', () => {
    const manager = new ProcessManager();
    const status = manager.getStatus();

    expect(status.state).toBe('idle');
    expect(status.previewOpen).toBe(false);
    expect(status.runId).toBe(null);
  });

  it('uses the selected shared capture mode and retains fractional FPS', () => {
    const config = buildConfigFromOptions({ cameras: [
      { id: 4, resolution: '1280x720', fps: 60000 / 1001 },
      { id: 7, resolution: '1280x720', fps: 60000 / 1001 },
    ] });
    expect(config.runtime.buffers.camera_width).toBe(1280);
    expect(config.runtime.buffers.camera_height).toBe(720);
    expect(config.shared.camera_groups.capture_rig).toMatchObject({ camera_ids: [4, 7], width: 1280, height: 720, fps: 60000 / 1001 });
  });

  it('rejects mixed camera settings and conflicting top-level overrides', () => {
    expect(() => buildConfigFromOptions({ cameras: [{ fps: 25 }, { fps: 30 }] })).toThrow('same capture');
    expect(() => buildConfigFromOptions({ video_fps: 30, cameras: [{ fps: 60 }] })).toThrow('same capture');
    expect(() => buildConfigFromOptions({ cameras: [{ resolution: '1280x720' }, { resolution: '1920x1080' }] })).toThrow('same capture');
    expect(() => buildConfigFromOptions({ video_fps: NaN })).toThrow('Invalid capture');
  });
});
