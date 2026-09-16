import { calibrateWithFallback, type ArucoCalibrationMode } from './arucoCalibration.js';
import { createCaptureDirectory, listCapturedVideos, removeCaptureDirectory } from './calibrationCapture.js';
import { RigCalibrationStore } from './rigCalibrationStore.js';

export type RigCalibrationStage = 'idle' | 'recording' | 'calibrating' | 'publishing' | 'ready' | 'failed';

export interface RigCalibrationVideoStream {
  cameraId: number;
  url: string;
}

export interface RigCalibrationStatus {
  stage: RigCalibrationStage;
  mode?: ArucoCalibrationMode;
  errorMessage?: string;
  meanReprojectionErrorPx?: number;
  metricValid?: boolean;
  // Only set during 'recording', for the capture UI's live camera feeds.
  videoStreams?: RigCalibrationVideoStream[];
}

// Recording is just a preview monitor session given an output directory
// (processManager.ts's openPreviewMonitor/closePreviewMonitor). This is a
// thin seam for testing.
export interface RigCalibrationRuntime {
  startRecording(directory: string, cameraCount: number, targetFps?: number): Promise<RigCalibrationVideoStream[]>;
  stopRecording(): Promise<void>;
}

export interface RigCalibrationCoordinatorDependencies {
  runtime: RigCalibrationRuntime;
  store?: RigCalibrationStore;
  calibrate?: typeof calibrateWithFallback;
  createCaptureDirectory?: typeof createCaptureDirectory;
  listCapturedVideos?: typeof listCapturedVideos;
  removeCaptureDirectory?: typeof removeCaptureDirectory;
}

export class RigCalibrationCoordinator {
  private readonly runtime: RigCalibrationRuntime;
  private readonly store: RigCalibrationStore;
  private readonly calibrate: typeof calibrateWithFallback;
  private readonly createDir: typeof createCaptureDirectory;
  private readonly listVideos: typeof listCapturedVideos;
  private readonly removeDir: typeof removeCaptureDirectory;

  private status: RigCalibrationStatus = { stage: 'idle' };
  private captureDir: string | null = null;

  constructor(deps: RigCalibrationCoordinatorDependencies) {
    this.runtime = deps.runtime;
    this.store = deps.store ?? new RigCalibrationStore();
    this.calibrate = deps.calibrate ?? calibrateWithFallback;
    this.createDir = deps.createCaptureDirectory ?? createCaptureDirectory;
    this.listVideos = deps.listCapturedVideos ?? listCapturedVideos;
    this.removeDir = deps.removeCaptureDirectory ?? removeCaptureDirectory;
  }

  getStatus(): RigCalibrationStatus {
    return { ...this.status };
  }

  // Used when starting a run to pick extrinsics_file vs da3_startup_calibration.
  // Null means nothing published yet, or it's for a different camera setup.
  resolveExtrinsicsFile(fingerprint: string): string | null {
    return this.store.readActiveFor(fingerprint)?.extrinsicsFile ?? null;
  }

  async beginCapture(cameraCount: number, targetFps?: number): Promise<void> {
    if (this.captureDir) {
      throw new Error('A rig calibration capture is already active');
    }
    if (cameraCount < 2) {
      throw new Error('Rig calibration needs at least two cameras');
    }

    const directory = this.createDir();
    this.status = { stage: 'recording' };
    try {
      const videoStreams = await this.runtime.startRecording(directory, cameraCount, targetFps);
      this.captureDir = directory;
      this.status = { stage: 'recording', videoStreams };
    } catch (error) {
      this.removeDir(directory);
      this.status = { stage: 'failed', errorMessage: error instanceof Error ? error.message : 'Failed to start recording' };
      throw error;
    }
  }

  async cancelCapture(): Promise<void> {
    const directory = this.captureDir;
    if (!directory) return;
    this.captureDir = null;
    await this.runtime.stopRecording().catch(() => undefined);
    this.removeDir(directory);
    this.status = { stage: 'idle' };
  }

  async finishCapture(input: { fingerprint: string; markerSizeMm?: number; markerId?: number }): Promise<RigCalibrationStatus> {
    const directory = this.captureDir;
    if (!directory) {
      throw new Error('No rig calibration capture is active');
    }
    this.captureDir = null;

    try {
      await this.runtime.stopRecording();

      const videos = this.listVideos(directory);
      if (videos.length < 2) {
        throw new Error('Rig calibration did not produce a recorded video for at least two cameras');
      }

      this.status = { stage: 'calibrating' };
      const result = await this.calibrate({
        videos,
        outputDir: directory,
        markerSizeMm: input.markerSizeMm,
        markerId: input.markerId,
      });

      if (!result.success || !result.extrinsicsPath) {
        this.status = { stage: 'failed', mode: result.mode, errorMessage: result.errorMessage ?? 'Rig calibration failed' };
        return this.getStatus();
      }

      this.status = { stage: 'publishing', mode: result.mode };
      const active = this.store.publish({
        extrinsicsSourcePath: result.extrinsicsPath,
        mode: result.mode,
        fingerprint: input.fingerprint,
        meanReprojectionErrorPx: result.meanReprojectionErrorPx,
      });

      this.status = {
        stage: 'ready',
        mode: active.mode,
        meanReprojectionErrorPx: active.meanReprojectionErrorPx,
        metricValid: active.metricValid,
      };
      return this.getStatus();
    } catch (error) {
      this.status = { stage: 'failed', errorMessage: error instanceof Error ? error.message : 'Rig calibration failed' };
      return this.getStatus();
    } finally {
      this.removeDir(directory);
    }
  }
}
