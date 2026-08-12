export type AppPhase = 'camera-setup' | 'calibration' | 'live';

export type Resolution = `${number}x${number}`;

export interface CameraDevice {
  id: string;
  label: string;
  suggestedResolution?: Resolution;
  suggestedFps?: number;
  defaultRotation?: number;
  maxResolution?: Resolution;
  maxFps?: number;
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

export interface PoseKeypoint {
  x: number;
  y: number;
  confidence?: number;
  visible?: number;
}

export interface PoseFrame {
  keypoints?: PoseKeypoint[];
  joints?: PoseKeypoint[];
  pose?: PoseKeypoint[];
  people?: Array<{ keypoints?: PoseKeypoint[]; joints?: PoseKeypoint[]; pose?: PoseKeypoint[] }>;
}
