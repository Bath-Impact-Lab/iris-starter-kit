import { describe, expect, it } from 'vitest';

import { buildConfigFromOptions, uniquePipeName } from './config.js';
import { ProcessManager } from './processManager.js';

describe('config', () => {
  it('uniquePipeName uses the Windows named pipe device format with a unique suffix', () => {
    const name = uniquePipeName('iris_pose');
    expect(name).toMatch(/^\\\\\.\\pipe\\iris_pose_[0-9a-f-]{36}$/);
    expect(uniquePipeName('iris_pose')).not.toBe(name);
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
    expect(config.pipeline.global_reid_tracking.single_person_mode).toBe(false);
    expect(config.shared.models.detection.yolox_people.yolox_conf_threshold).toBe(0.1);
    expect(config.shared.defaults.detection).toMatchObject({ detection_skip_enabled: false, detection_skip_frames: 1 });
    expect(config.pipeline.global_reid_tracking.spawn).toMatchObject({
      require_multi_camera_spawn: true,
      min_supporting_cameras: 2,
    });
    expect('calibration' in config.pipeline).toBe(false);
  });

  it('uses primary-person output and a conservative detector cadence in single mode', () => {
    const config = buildConfigFromOptions({ tracking_mode: 'single', cameras: [{ id: 0 }, { id: 1 }] });

    expect(config.pipeline.global_reid_tracking.single_person_mode).toBe(true);
    expect(config.shared.defaults.detection).toMatchObject({ detection_skip_enabled: true, detection_skip_frames: 2 });
  });

  it('widens the tracker gates for a single subject only', () => {
    const single = buildConfigFromOptions({ tracking_mode: 'single', cameras: [{ id: 0 }, { id: 1 }] });
    expect(single.pipeline.global_reid_tracking.kalman).toMatchObject({ base_gate: 1.5, max_gate: 3.0 });

    const multi = buildConfigFromOptions({ tracking_mode: 'multi', cameras: [{ id: 0 }, { id: 1 }] });
    expect(multi.pipeline.global_reid_tracking.kalman.base_gate).toBe(0.75);
    expect('max_gate' in multi.pipeline.global_reid_tracking.kalman).toBe(false);
  });

  it('asks for geometric association only in the experimental multi-person mode', () => {
    const geometric = buildConfigFromOptions({ tracking_mode: 'multi-geometric', cameras: [{ id: 0 }, { id: 1 }] });
    expect(geometric.pipeline.triangulation.association).toEqual({ mode: 'geometric' });
    expect(geometric.pipeline.global_reid_tracking.single_person_mode).toBe(false);
    expect(geometric.shared.defaults.detection).toMatchObject({ detection_skip_enabled: false, detection_skip_frames: 1 });

    for (const mode of ['single', 'multi', undefined, 'bogus']) {
      const config = buildConfigFromOptions({ tracking_mode: mode, cameras: [{ id: 0 }, { id: 1 }] });
      expect('association' in config.pipeline.triangulation).toBe(false);
    }
  });

  it('refines the extrinsics with a startup bundle adjustment on both calibration paths', () => {
    const da3 = buildConfigFromOptions({ cameras: [{ id: 0 }, { id: 1 }] });
    expect(da3.pipeline.triangulation.startup_extrinsics_ba).toMatchObject({
      enabled: true,
      warmup_frames: 500,
      fix_intrinsics: true,
      reject_if_not_improved: true,
    });

    const published = buildConfigFromOptions({
      cameras: [{ id: 0 }, { id: 1 }],
      extrinsics_file: 'C:\\rig\\active\\extrinsics.json',
    });
    expect('da3_startup_calibration' in published.pipeline.triangulation).toBe(false);
    expect(published.pipeline.triangulation.startup_extrinsics_ba.enabled).toBe(true);
  });

  it('does not require multi-camera spawn consensus with one camera', () => {
    const config = buildConfigFromOptions({ cameras: [{ id: 0 }] });

    expect(config.pipeline.global_reid_tracking.spawn).toMatchObject({
      require_multi_camera_spawn: false,
      min_supporting_cameras: 1,
    });
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
