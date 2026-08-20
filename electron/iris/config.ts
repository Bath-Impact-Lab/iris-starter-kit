import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveIrisExecutable } from './resolveIrisExecutable.js';

let cachedAppPath: string | null = null;

function getElectronAppPath(): string {
  if (cachedAppPath !== null) {
    return cachedAppPath;
  }

  try {
    const { app } = require('electron');
    const path = app.getAppPath();
    cachedAppPath = path;
    return path;
  } catch {
    return '';
  }
}

function isElectronAppPackaged(): boolean {
  try {
    const { app } = require('electron');
    return Boolean(app.isPackaged);
  } catch {
    return false;
  }
}

export const PIPE_NAME = '\\\\.\\pipe\\iris_ipc';

function getAppDataPath(): string {
  const envAppData = process.env.APPDATA || process.env.LOCALAPPDATA;
  if (envAppData) {
    return envAppData;
  }

  try {
    const { app } = require('electron');
    return app.getPath('appData');
  } catch {
    return path.join(os.homedir(), 'AppData', 'Roaming');
  }
}

function findFirstExistingPath(candidates: string[]): string | null {
  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

export function getIrisHome(): string {
  const envOverride = process.env.IRIS_HOME;
  if (envOverride) {
    return path.resolve(envOverride);
  }

  if (process.platform !== 'win32') {
    return path.join(os.homedir(), 'Documents', 'Iris');
  }

  const windowsInstallRoot = findFirstExistingPath([
    'C:\\Program Files\\Bath Impact Lab\\IRIS',
    'C:\\Program Files (x86)\\Bath Impact Lab\\IRIS',
    path.join(os.homedir(), 'Documents', 'Iris', 'build'),
  ]);

  return windowsInstallRoot ?? path.join(os.homedir(), 'Documents', 'Iris');
}

export function getIrisCliPath(): string {
  const appPath = getElectronAppPath();
  return resolveIrisExecutable({
    appPath,
    resourcesPath: process.resourcesPath ?? path.join(appPath, 'resources'),
    isPackaged: isElectronAppPackaged(),
    override: process.env.IRIS_CLI_PATH || process.env.IRIS_CLI,
  });
}

export function getIrisModelDir(): string {
  const envOverride = process.env.IRIS_MODELS_DIR || process.env.IRIS_MODEL_DIR;
  if (envOverride) {
    return path.resolve(envOverride);
  }

  return path.join(getIrisHome(), 'models');
}

export function getIrisCliMissingMessage(): string {
  const cliPath = getIrisCliPath();
  const appPath = getElectronAppPath();
  const bundledPath = appPath ? path.join(appPath, 'resources', 'iris', 'bin', 'iris_cli.exe') : 'N/A';
  const envHints = [
    `iris_cli.exe should be bundled at: ${bundledPath}`,
    'or set IRIS_CLI_PATH environment variable',
    'or install IRIS to: C:\\Program Files\\Bath Impact Lab\\IRIS\\bin',
  ];

  return `IRIS CLI not found at ${cliPath}. ${envHints.join(' | ')}`;
}

export const IRIS_MODEL_DIR = getIrisModelDir();
export const IRIS_CALIBRATION_DIR = path.join(getAppDataPath(), 'ReCapture', 'triangulation_da3_startup');

export function buildConfigFromOptions(options: Record<string, any> = {}) {
  const runId = options.run_id ?? `run-${Date.now()}`;
  const width = Number(options.camera_width ?? 1920);
  const height = Number(options.camera_height ?? 1080);
  const cameras = Array.isArray(options.cameras) ? options.cameras : [];
  const cameraIds = cameras.map((camera: any, index: number) => {
    const idValue = Number(camera?.id ?? index);
    return Number.isFinite(idValue) ? idValue : index;
  });
  const fps = Number.isFinite(options.video_fps) ? Number(options.video_fps) : (cameras[0]?.fps ?? 30);
  const rotate = Number.isFinite(options.rotation) ? Number(options.rotation) : (cameras[0]?.rotation ?? 0);
  const cameraCount = Math.max(1, cameraIds.length);
  const modelDir = IRIS_MODEL_DIR.replace(/\\/g, '/');
  const outputDir = IRIS_CALIBRATION_DIR.replace(/\\/g, '/');

  // No standalone "calibration" stage -- see dont commit/IRIS-INTEGRATION-NOTES.md.
  return {
    run_id: runId,
    runtime: {
      devices: {
        gpu: 0,
        cuda_streams: 2,
        nvenc: false,
      },
      buffers: {
        frame_capacity: 256,
        pose_capacity: 256,
        export_shm: true,
        camera_count: cameraCount,
        camera_slots: 256,
        camera_width: width,
        camera_height: height,
      },
    },
    shared: {
      execution: {
        device_id: 0,
      },
      camera_groups: {
        capture_rig: {
          camera_ids: cameraIds,
          width,
          height,
          rotate,
          fps,
          batching: true,
          batch_camera_ids: cameraIds,
        },
      },
      models: {
        detection: {
          yolox_people: {
            type: 'yolox',
            yolox_engine_path: `${modelDir}/yolox_s_bs16.trt`,
            yolox_input_width: 640,
            yolox_input_height: 640,
            yolox_conf_threshold: 0.7,
            yolox_iou_threshold: 0.45,
          },
        },
        reid: {
          osnet_x05: {
            enabled: true,
            engine_path: `${modelDir}/osnet_x05_fp16.trt`,
            min_detection_confidence: 0.55,
          },
        },
        pose: {
          rtmpose_people: {
            engine: `${modelDir}/rtmpose_bs16_fp16.trt`,
            batch: 16,
            input_w: 192,
            input_h: 256,
            split_ratio: 2.0,
          },
        },
      },
      defaults: {
        detection: {
          batch_size: 16,
          detection_skip_enabled: true,
          detection_skip_frames: 20,
        },
        output: {
          shm_name: 'iris_shm_ipc',
          capacity: 120,
        },
      },
    },
    pipeline: {
      capture: {
        id: 'capture',
        camera_group: 'capture_rig',
        id_prefix: 'cap',
      },
      detection: {
        id: 'det0',
        model: 'yolox_people',
        reid_model: 'osnet_x05',
      },
      global_reid_tracking: {
        id: 'global_track',
        single_person_mode: true,
        max_age: 200,
        min_hits: 1,
        min_detection_confidence: 0.5,
        appearance_threshold: 0.45,
        cross_camera_unconfirmed_threshold: 0.55,
        capture_volume: {
          min_camera_coverage: 1,
          ground_z: 0.0,
          cell_size: 0.1,
          erosion_margin: 0.0,
          max_search_extent: 0.5,
          max_frames_outside: 30,
        },
        kalman: {
          q_accel: 3.0,
          r_meas: 0.1,
          initial_velocity_uncertainty: 2.0,
          base_gate: 0.75,
          uncertainty_gate_k: 3.0,
          prune_uncertainty: 5.0,
        },
        spawn: {
          require_multi_camera_spawn: false,
          spawn_consensus_gate: 0.5,
          spawn_consensus_max_age_frames: 5,
          min_supporting_cameras: 1,
        },
      },
      pose_estimation: {
        id: 'pose0',
        model: 'rtmpose_people',
      },
      triangulation: {
        id: 'tri0',
        pose_source: 'pose0',
        camera_group: 'capture_rig',
        da3_startup_calibration: {
          engine: `${modelDir}/da3_base.trt`,
          output_dir: outputDir,
          frame_source: 'frame_batch',
          model_type: 'base',
          viewer_align: true,
          save_ply: 'scene.ply',
        },
        compute_reprojection: true,
        store_reprojection_error: true,
        gate_by_reprojection_error: true,
        max_reprojection_error_px: 50.0,
        smoothing: {
          enabled: true,
          freq: 100.0,
          min_cutoff: 1.0,
          beta: 0.5,
          d_cutoff: 1.0,
          cleanup_interval: 300,
        },
      },
      output: {
        id: 'output',
        camera_group: 'capture_rig',
      },
    },
  };
}
