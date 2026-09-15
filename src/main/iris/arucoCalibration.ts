import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { getIrisCliPath, IRIS_MODEL_DIR } from './config.js';

const execFileAsync = promisify(execFile);

// da3-aruco with a plain da3 fallback on the same videos. Pure aruco-ba
// (needs a separate intrinsics step) isn't implemented here.
export type ArucoCalibrationMode = 'da3-aruco' | 'da3';

export interface ArucoCalibrationVideo {
  cameraId: number;
  path: string;
}

export interface ArucoCalibrationOptions {
  videos: ArucoCalibrationVideo[];
  outputDir: string;
  markerSizeMm?: number;
  markerId?: number;
  da3EnginePath?: string;
  sampleFps?: number;
  timeoutMs?: number;
}

export interface ArucoCalibrationResult {
  success: boolean;
  mode: ArucoCalibrationMode;
  extrinsicsPath?: string;
  reportPath?: string;
  plyPath?: string;
  meanReprojectionErrorPx?: number;
  metricScale?: number;
  markerObservations?: number;
  errorMessage?: string;
}

export interface ArucoCalibrationDependencies {
  execFile?: typeof execFileAsync;
  getCliPath?: () => string;
}

function defaultDa3EnginePath(): string {
  return `${IRIS_MODEL_DIR.replace(/\\/g, '/')}/da3_base.trt`;
}

function buildArgs(mode: ArucoCalibrationMode, options: ArucoCalibrationOptions): string[] {
  if (options.videos.length < 2) {
    throw new Error('ArUco calibration requires at least two camera videos');
  }

  const args = ['calibrate-extrinsics', '--mode', mode, '--out', options.outputDir, '--json'];

  const seen = new Set<number>();
  for (const video of options.videos) {
    if (!Number.isInteger(video.cameraId) || video.cameraId < 0 || seen.has(video.cameraId)) {
      throw new Error('ArUco calibration videos require unique non-negative camera ids');
    }
    seen.add(video.cameraId);
    args.push('--video', `${video.cameraId}:${video.path}`);
  }

  // Both modes need the same reconstruction engine.
  args.push('--engine', options.da3EnginePath ?? defaultDa3EnginePath());

  if (mode === 'da3-aruco') {
    args.push('--marker-size', String(options.markerSizeMm ?? 270), '--marker-id', String(options.markerId ?? 42));
    // Denser sampling than the CLI default (5fps) gives more chances to
    // catch both cameras seeing the marker at the same instant.
    args.push('--sample-fps', String(options.sampleFps ?? 15));
  }

  return args;
}

function parseResult(mode: ArucoCalibrationMode, stdout: string): ArucoCalibrationResult {
  const parsed = JSON.parse(stdout);
  return {
    success: Boolean(parsed.success),
    mode,
    extrinsicsPath: parsed.extrinsics_path || undefined,
    reportPath: parsed.report_path || undefined,
    plyPath: parsed.ply_path || undefined,
    meanReprojectionErrorPx: typeof parsed.mean_reprojection_error_px === 'number' ? parsed.mean_reprojection_error_px : undefined,
    metricScale: typeof parsed.metric_scale === 'number' ? parsed.metric_scale : undefined,
    markerObservations: typeof parsed.marker_observations === 'number' ? parsed.marker_observations : undefined,
    errorMessage: parsed.error_message || undefined,
  };
}

async function runCalibration(
  mode: ArucoCalibrationMode,
  options: ArucoCalibrationOptions,
  deps: Required<ArucoCalibrationDependencies>,
): Promise<ArucoCalibrationResult> {
  try {
    const args = buildArgs(mode, options);
    const cliPath = deps.getCliPath();
    console.log(`[iris:calibration] running "iris_cli ${args.join(' ')}"`);

    const { stdout } = await deps.execFile(cliPath, args, {
      windowsHide: true,
      timeout: options.timeoutMs ?? 120_000,
      maxBuffer: 10 * 1024 * 1024,
    });
    return parseResult(mode, stdout);
  } catch (error: any) {
    // A failed-but-completed calibration exits 1 but still writes JSON
    // to stdout explaining why. Prefer that over the bare exit code.
    if (typeof error?.stdout === 'string' && error.stdout.trim()) {
      try {
        return parseResult(mode, error.stdout);
      } catch {
        // fall through to the generic failure below
      }
    }
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[iris:calibration] "${mode}" failed to run`, error);
    return { success: false, mode, errorMessage: message };
  }
}

// Tries da3-aruco first; on failure, reruns the same videos with plain da3
// so calibration still produces a working (if non-metric) result.
export async function calibrateWithFallback(
  options: ArucoCalibrationOptions,
  dependencies: ArucoCalibrationDependencies = {},
): Promise<ArucoCalibrationResult> {
  const deps: Required<ArucoCalibrationDependencies> = {
    execFile: dependencies.execFile ?? execFileAsync,
    getCliPath: dependencies.getCliPath ?? getIrisCliPath,
  };

  const primary = await runCalibration('da3-aruco', options, deps);
  if (primary.success) return primary;

  console.warn(
    `[iris:calibration] da3-aruco failed (${primary.errorMessage ?? 'unknown error'}), falling back to plain da3`,
  );
  return runCalibration('da3', options, deps);
}
