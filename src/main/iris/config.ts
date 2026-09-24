import { poseModel } from '../../shared/poseModels';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { resolveIrisExecutable } from './resolveIrisExecutable.js';
import { captureSettings, type NativeCamera } from '../../shared/capture';

const execFileAsync = promisify(execFile);

const PIPELINE_TEMPLATE_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), 'pipeline-template.json');

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

// Unique per session: a fixed name collides with a second app instance or a
// server that hasn't released it yet, and a predictable one can be squatted.
export function uniquePipeName(prefix: string): string {
  return `\\\\.\\pipe\\${prefix}_${randomUUID()}`;
}

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

export type IrisCameraDevice = NativeCamera;

// IRIS's own view of what cameras it can actually open (`iris_cli
// show-cameras --json`), as opposed to the browser/OS device lists the
// renderer's camera setup picker uses. Those enumerate independently and
// can disagree -- most commonly when a virtual camera (OBS Virtual Camera,
// a capture-card driver's loopback device, etc.) shows up in the browser's
// navigator.mediaDevices list but isn't something IRIS's capture backend
// recognizes as an openable device. Returns null (rather than an empty
// array) when IRIS's own list couldn't be determined at all, so callers
// can tell "IRIS found zero cameras" apart from "we don't know" and avoid
// clamping to zero on a transient failure.
export async function listIrisCameras(cliPath: string): Promise<IrisCameraDevice[] | null> {
  try {
    const { stdout } = await execFileAsync(cliPath, ['show-cameras', '--json'], {
      windowsHide: true,
      timeout: 10000,
    });
    const parsed = JSON.parse(stdout);
    const cameras = Array.isArray(parsed?.cameras) ? parsed.cameras : [];
    return cameras.map((camera: any) => ({
      index: Number(camera.index),
      name: String(camera.name ?? ''),
      devicePath: camera.device_path ? String(camera.device_path) : undefined,
      modes: Array.isArray(camera.modes) ? camera.modes.map((mode: any) => ({
        width: Number(mode.width), height: Number(mode.height),
        fpsNumerator: Number(mode.fps_numerator), fpsDenominator: Number(mode.fps_denominator),
        format: String(mode.format ?? ''),
      })) : undefined,
    }));
  } catch (error) {
    console.warn('[iris:config] "iris_cli show-cameras" failed -- skipping camera reconciliation:', error);
    return null;
  }
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
export const IRIS_CALIBRATION_DIR = path.join(getAppDataPath(), 'ReCapture', 'auto_calibration');
// Where a published rig calibration lives (see rigCalibrationStore.ts).
// Separate from IRIS_CALIBRATION_DIR, the auto-calibration's own scratch output.
export const RIG_CALIBRATION_DIR = path.join(getAppDataPath(), 'ReCapture', 'rig_calibration');

// Static pipeline settings live in pipeline-template.json. Only the values
// that vary per run or per machine are filled in here. See
// IRIS_BUNDLING.md for how to customize the spec.
function loadPipelineTemplate(): Record<string, any> {
  return JSON.parse(fs.readFileSync(PIPELINE_TEMPLATE_PATH, 'utf8'));
}

// Same rule buildConfigFromOptions uses for rotation, shared so a rig
// calibration fingerprint can't drift from what actually reaches iris_cli.
export function resolveCaptureRotation(options: { rotation?: any; cameras?: Array<{ rotation?: number }> }): number {
  return Number.isFinite(options.rotation) ? Number(options.rotation) : Number(options.cameras?.[0]?.rotation ?? 0);
}

export function buildConfigFromOptions(options: Record<string, any> = {}) {
  const runId = options.run_id ?? `run-${Date.now()}`;
  const cameras = Array.isArray(options.cameras) ? options.cameras : [];
  const { width, height, fps } = captureSettings(cameras, options);
  const cameraIds = cameras.map((camera: any, index: number) => {
    const idValue = Number(camera?.id ?? index);
    return Number.isFinite(idValue) ? idValue : index;
  });
  const rotate = resolveCaptureRotation(options);
  const cameraCount = Math.max(1, cameraIds.length);
  const modelDir = IRIS_MODEL_DIR.replace(/\\/g, '/');
  const outputDir = IRIS_CALIBRATION_DIR.replace(/\\/g, '/');
  const trackingMode: 'single' | 'multi' | 'multi-geometric' =
    options.tracking_mode === 'single' || options.tracking_mode === 'multi-geometric'
      ? options.tracking_mode
      : 'multi';

  const config = loadPipelineTemplate();
  // Manual areas are reviewed after calibration; never replay old world coordinates.
  if (options.roi_mode !== undefined) {
    config.pipeline.global_reid_tracking.capture_volume.enabled = options.roi_mode === 'automatic';
    delete config.pipeline.global_reid_tracking.capture_volume.polygon_xy_override;
  }

  config.run_id = runId;
  config.runtime.buffers.camera_count = cameraCount;
  config.runtime.buffers.camera_width = width;
  config.runtime.buffers.camera_height = height;

  Object.assign(config.shared.camera_groups.capture_rig, {
    camera_ids: cameraIds,
    width,
    height,
    rotate,
    fps,
    batch_camera_ids: cameraIds,
  });

  config.shared.models.detection.yolox_people.yolox_engine_path = `${modelDir}/yolox_s_bs16.trt`;
  // ByteTrack-style association needs low-confidence boxes for its recovery
  // pass. The old 0.7 detector cut-off made that pass impossible.
  config.shared.models.detection.yolox_people.yolox_conf_threshold = 0.1;
  config.pipeline.global_reid_tracking.single_person_mode = trackingMode === 'single';

  // Experimental: IRIS-Core's geometric association, where 3D person tracks
  // own the IDs and the tracker only hands over per-camera tracklets. Needs a
  // Core build from feat/mp_research; older builds ignore the key and keep
  // tracker IDs.
  if (trackingMode === 'multi-geometric') {
    config.pipeline.triangulation.association = { mode: 'geometric' };
  }

  // One subject: a rider's feet are off the floor and a seated person's box
  // bottom is not at their feet, so floor points disagree between cameras
  // more than for someone walking. Wider gates keep them on one ID.
  if (trackingMode === 'single') {
    Object.assign(config.pipeline.global_reid_tracking.kalman, { base_gate: 1.5, max_gate: 3.0 });
  }

  // Reusing a detection for 20 frames produces visibly stale crops and poor
  // motion estimates. Multi-person/crossing scenes always detect every frame;
  // single-person mode uses a conservative 2-frame cadence to cut YOLO work
  // without introducing a long acquisition delay.
  const detectionInterval = trackingMode === 'single' ? 2 : 1;
  config.shared.defaults.detection.detection_skip_enabled = detectionInterval > 1;
  config.shared.defaults.detection.detection_skip_frames = detectionInterval;

  // A new identity should normally be corroborated by two views when the rig
  // has them. Single-camera setups cannot satisfy that requirement.
  config.pipeline.global_reid_tracking.spawn.require_multi_camera_spawn = cameraCount > 1;
  config.pipeline.global_reid_tracking.spawn.min_supporting_cameras = Math.min(2, cameraCount);
  config.shared.models.reid.osnet_x05.engine_path = `${modelDir}/osnet_x05_fp16.trt`;
  const model = poseModel(options.pose_model);
  Object.assign(config.shared.models.pose.rtmpose_people, {
    engine: `${modelDir}/${model.engine}`,
    input_w: model.width,
    input_h: model.height,
    num_keypoints: model.keypoints,
  });

  // A published calibration replaces live auto-calibration: triangulation
  // reads a fixed extrinsics file instead of estimating poses each run.
  const extrinsicsFile: string | undefined = options.extrinsics_file;
  if (extrinsicsFile) {
    delete config.pipeline.triangulation.da3_startup_calibration;
    config.pipeline.triangulation.calibration_dir = path.dirname(extrinsicsFile).replace(/\\/g, '/');
    config.pipeline.triangulation.extrinsics_file = extrinsicsFile.replace(/\\/g, '/');
  } else {
    Object.assign(config.pipeline.triangulation.da3_startup_calibration, {
      engine: `${modelDir}/da3_base.trt`,
      output_dir: outputDir,
    });
  }

  return config;
}
