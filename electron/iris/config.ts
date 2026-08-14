import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

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

export const PIPE_NAME = '\\\.\\pipe\\iris_ipc';

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
  // Priority 1: explicit environment override
  const cliOverride = process.env.IRIS_CLI_PATH || process.env.IRIS_CLI;
  if (cliOverride) {
    const resolved = path.resolve(cliOverride);
    console.log('[iris-config] Using IRIS CLI from override:', resolved);
    return resolved;
  }

  // Priority 2: bundled with app (resources/iris/bin/iris_cli.exe)
  const appPath = getElectronAppPath();
  if (appPath) {
    const bundledCliPath = path.join(appPath, 'resources', 'iris', 'bin', 'iris_cli.exe');
    console.log('[iris-config] Checking bundled IRIS path:', bundledCliPath);
    if (fs.existsSync(bundledCliPath)) {
      console.log('[iris-config] Found bundled IRIS CLI');
      return bundledCliPath;
    }
  }

  // Priority 3: system install or IRIS_HOME env var
  const irisHome = getIrisHome();
  const cliPath = path.join(irisHome, 'bin', 'iris_cli.exe');
  console.log('[iris-config] Falling back to system/IRIS_HOME path:', cliPath);
  return cliPath;
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

export const IRIS_CLI_PATH = getIrisCliPath();
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

  return {
    execution: {
      device_id: 0,
      run_id: runId,
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
    defaults: {
      output: {
        shm_name: 'iris_shm_ipc',
        capacity: 120,
      },
    },
    pipeline: {
      calibration: {
        type: 'da3_startup',
        camera_group: 'capture_rig',
        mode: 'startup',
        output_dir: IRIS_CALIBRATION_DIR.replace(/\\/g, '/'),
      },
    },
  };
}
