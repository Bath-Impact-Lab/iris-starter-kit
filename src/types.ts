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

// One tracked person's pose for a single frame.
export interface PosePerson {
  person_id?: number;
  // Per-joint 2D pixel coordinates, one pair per camera.
  points_2d?: Array<Array<[number, number]>>;
  // Per-joint 3D position in metres. Zeroed where the joint wasn't detected.
  joint_centers?: Array<[number, number, number]>;
  // Per-joint rotation as a [w, x, y, z] quaternion. Only a subset of
  // joints get a real value; the rest default to the identity rotation.
  joint_angles?: Array<[number, number, number, number]>;
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
