export type AppPhase = 'camera-setup' | 'calibration' | 'live';

export type Resolution = '1280x720' | '1920x1080' | '2560x1440';

export interface CameraDevice {
  id: string;
  label: string;
}

export interface CameraConfig {
  deviceId: string;
  label: string;
  resolution: Resolution;
  fps: number;
  rotation: number;
}

export interface SessionConfig {
  cameras: CameraConfig[];
}
