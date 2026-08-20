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

export interface RunConfig {
  cameras: CameraConfig[];
}

// Matches the JSON written by IRIS's pose pipe
// (core/knect/utils/pose_stream_writer.cpp): per person, `points_2d` holds
// one entry per shared-memory joint slot, each an array of [u, v] raw pixel
// pairs -- one pair per camera. COCO-17 body joints are indices 0..16.
export interface PosePerson {
  person_id?: number;
  points_2d?: Array<Array<[number, number]>>;
  joint_centers?: unknown;
  joint_angles?: unknown;
}

export interface PoseFrame {
  frame_seq?: number;
  timestamp?: number;
  slot_timestamp?: number;
  people?: PosePerson[];
}

export interface VideoStreamDescriptor {
  cameraId: number;
  url: string;
}
