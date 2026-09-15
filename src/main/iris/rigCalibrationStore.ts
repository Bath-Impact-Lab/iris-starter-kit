import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { RIG_CALIBRATION_DIR } from './config.js';
import type { ArucoCalibrationMode } from './arucoCalibration.js';

export interface CameraFingerprintInput {
  cameras: Array<{ id: string | number; label?: string; resolution?: string; fps?: number; rotation?: number }>;
  rotation: number;
}

// Changing camera setup invalidates a published calibration. Comparing this
// against the fingerprint stored at publish time catches a stale one.
export function computeCameraFingerprint(input: CameraFingerprintInput): string {
  return createHash('sha256').update(JSON.stringify(input)).digest('hex');
}

export interface ActiveRigCalibration {
  extrinsicsFile: string;
  mode: ArucoCalibrationMode;
  fingerprint: string;
  capturedAt: string;
  meanReprojectionErrorPx?: number;
  // True only for da3-aruco (real metric scale). da3 fallback is relative
  // scale only, same as ordinary da3_startup_calibration.
  metricValid: boolean;
}

const ACTIVE_SUBDIR = 'active';
const META_FILE_NAME = 'meta.json';
const EXTRINSICS_FILE_NAME = 'extrinsics.json';
const INTRINSICS_FILE_PATTERN = /^intrinsics_cam\d+\.json$/i;

export class RigCalibrationStore {
  constructor(private readonly rootDir: string = RIG_CALIBRATION_DIR) {}

  private get activeDir(): string {
    return path.join(this.rootDir, ACTIVE_SUBDIR);
  }

  private get metaPath(): string {
    return path.join(this.activeDir, META_FILE_NAME);
  }

  readActive(): ActiveRigCalibration | null {
    try {
      return JSON.parse(fs.readFileSync(this.metaPath, 'utf8'));
    } catch {
      return null;
    }
  }

  // Null if the fingerprint no longer matches the current rig.
  readActiveFor(fingerprint: string): ActiveRigCalibration | null {
    const active = this.readActive();
    return active && active.fingerprint === fingerprint ? active : null;
  }

  publish(input: {
    extrinsicsSourcePath: string;
    mode: ArucoCalibrationMode;
    fingerprint: string;
    meanReprojectionErrorPx?: number;
  }): ActiveRigCalibration {
    fs.mkdirSync(this.activeDir, { recursive: true });
    const destPath = path.join(this.activeDir, EXTRINSICS_FILE_NAME);
    fs.copyFileSync(input.extrinsicsSourcePath, destPath);

    // Clear stale intrinsics files from a previous publish (e.g. a rig with
    // fewer cameras than last time).
    for (const file of fs.readdirSync(this.activeDir)) {
      if (INTRINSICS_FILE_PATTERN.test(file)) fs.rmSync(path.join(this.activeDir, file));
    }

    // Reconstruction also writes intrinsics_cam<N>.json next to
    // extrinsics.json. Triangulation needs both present together or it
    // silently loads zero cameras, so copy them all over too.
    const sourceDir = path.dirname(input.extrinsicsSourcePath);
    const intrinsicsFiles = fs.existsSync(sourceDir)
      ? fs.readdirSync(sourceDir).filter((file) => INTRINSICS_FILE_PATTERN.test(file))
      : [];
    for (const file of intrinsicsFiles) {
      fs.copyFileSync(path.join(sourceDir, file), path.join(this.activeDir, file));
    }

    const record: ActiveRigCalibration = {
      extrinsicsFile: destPath,
      mode: input.mode,
      fingerprint: input.fingerprint,
      capturedAt: new Date().toISOString(),
      meanReprojectionErrorPx: input.meanReprojectionErrorPx,
      metricValid: input.mode === 'da3-aruco',
    };
    fs.writeFileSync(this.metaPath, JSON.stringify(record, null, 2), 'utf8');
    return record;
  }

  clear(): void {
    fs.rmSync(this.activeDir, { recursive: true, force: true });
  }
}
