import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface CalibrationVideo {
  cameraId: number;
  path: string;
}

// One temp dir per capture attempt. `iris_cli monitor --output-dir` writes
// recording_cam<N>.mp4 into it directly; this just manages the directory.
export function createCaptureDirectory(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'iris-calib-'));
}

const RECORDING_FILE_PATTERN = /^recording_cam(\d+)\.mp4$/i;

export function listCapturedVideos(directory: string): CalibrationVideo[] {
  return fs
    .readdirSync(directory)
    .map((file) => {
      const match = RECORDING_FILE_PATTERN.exec(file);
      return match ? { cameraId: Number(match[1]), path: path.join(directory, file) } : null;
    })
    .filter((video): video is CalibrationVideo => video !== null)
    .sort((a, b) => a.cameraId - b.cameraId);
}

export function removeCaptureDirectory(directory: string): void {
  fs.rmSync(directory, { recursive: true, force: true });
}
