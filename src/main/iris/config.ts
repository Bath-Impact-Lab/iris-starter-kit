import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveIrisExecutable } from './resolveIrisExecutable.js';

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

// Static pipeline settings live in pipeline-template.json. Only the values
// that vary per run or per machine are filled in here. See
// IRIS_BUNDLING.md for how to customize the spec.
function loadPipelineTemplate(): Record<string, any> {
  return JSON.parse(fs.readFileSync(PIPELINE_TEMPLATE_PATH, 'utf8'));
}

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

  const config = loadPipelineTemplate();

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
  config.shared.models.reid.osnet_x05.engine_path = `${modelDir}/osnet_x05_fp16.trt`;
  config.shared.models.pose.rtmpose_people.engine = `${modelDir}/rtmpose_bs16_fp16.trt`;

  Object.assign(config.pipeline.triangulation.da3_startup_calibration, {
    engine: `${modelDir}/da3_base.trt`,
    output_dir: outputDir,
  });

  return config;
}
