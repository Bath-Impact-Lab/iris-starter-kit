export interface CameraMode {
  width: number;
  height: number;
  fpsNumerator: number;
  fpsDenominator: number;
  format: string;
}

export interface NativeCamera {
  index: number;
  name: string;
  devicePath?: string;
  /** Absent on older binaries; empty when modes could not be queried. */
  modes?: CameraMode[];
}

export interface NegotiatedCapture {
  cameraId: number;
  width: number;
  height: number;
  fpsNumerator: number;
  fpsDenominator: number;
  format: string;
}

export function modeFps(mode: Pick<CameraMode, 'fpsNumerator' | 'fpsDenominator'>): number {
  return mode.fpsNumerator / mode.fpsDenominator;
}

// Capture currently requests MJPEG for every camera in the group.
export function usableModes(modes: CameraMode[]): CameraMode[] {
  return modes.filter(m => m.format.toUpperCase() === 'MJPEG' &&
    Number.isInteger(m.width) && m.width > 0 && Number.isInteger(m.height) && m.height > 0 &&
    Number.isInteger(m.fpsNumerator) && m.fpsNumerator > 0 &&
    Number.isInteger(m.fpsDenominator) && m.fpsDenominator > 0 && modeFps(m) <= 480);
}

export function sameFps(a: number, b: number): boolean {
  return Math.abs(a - b) < 0.0001;
}

export function captureSettings(cameras: Array<{ resolution?: string; fps?: number }>, overrides: {
  camera_width?: number; camera_height?: number; video_fps?: number;
} = {}) {
  const [w, h] = (cameras[0]?.resolution ?? '1920x1080').split('x').map(Number);
  const width = overrides.camera_width ?? w, height = overrides.camera_height ?? h;
  const fps = overrides.video_fps ?? cameras[0]?.fps ?? 30;
  if (!Number.isInteger(width) || width < 1 || !Number.isInteger(height) || height < 1 ||
      !Number.isFinite(fps) || fps < 1 || fps > 480) throw new Error('Invalid capture resolution or frame rate');
  for (const camera of cameras) {
    if (camera.resolution !== undefined && camera.resolution !== `${width}x${height}` ||
        camera.fps !== undefined && !sameFps(camera.fps, fps))
      throw new Error('All selected cameras must use the same capture resolution and frame rate');
  }
  return { width, height, fps };
}
