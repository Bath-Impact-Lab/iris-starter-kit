export type RoiMode = 'off' | 'automatic' | 'manual';
export type Point2 = [number, number];
export interface RoiSource {
  cameraId: number;
  width: number;
  height: number;
  vertices: Point2[];
}
export interface RoiCamera {
  cameraId: number;
  streamId: number;
  deviceKey?: string;
  label?: string;
  width: number;
  height: number;
  segments: [number, number, number, number][];
  /** Camera-to-world calibration, independent of skeleton display scale. */
  position?: [number, number, number];
  rotation?: number[];
  intrinsics?: number[];
}
export interface RoiState {
  runId?: string;
  mode: RoiMode;
  availability: 'inactive' | 'active' | 'waiting_for_calibration' | 'empty' | 'needs_review';
  calibrationVersion: number;
  roiVersion: number;
  floorHeight: number;
  worldAxes: 'XZ';
  worldPolygon: Point2[];
  worldSegments?: [number, number, number, number][];
  source: RoiSource | null;
  cameras: RoiCamera[];
}
export interface RoiEdit {
  runId?: string;
  mode: RoiMode;
  calibrationVersion: number;
  roiVersion: number;
  source?: RoiSource;
  worldPolygon?: Point2[];
}
export interface SavedRoi {
  schemaVersion: 1;
  mode: RoiMode;
  source: RoiSource | null;
  deviceKey?: string;
  captureRotation: number;
  calibrationVersion?: number;
  runId?: string;
  rigDeviceKeys?: string[];
  floorHeight?: number;
  worldPolygon: Point2[];
  savedAt: string;
}
export interface RoiReply {
  ok: boolean;
  runId?: string;
  state?: RoiState;
  error?: string;
  saveError?: string;
  saved?: SavedRoi | null;
}
export type RoiOperation = 'capabilities' | 'roi.get' | 'roi.preview' | 'roi.apply';
export interface RoiApi {
  roiGet: () => Promise<RoiReply>;
  roiPreview: (edit: RoiEdit) => Promise<RoiReply>;
  roiApply: (edit: RoiEdit) => Promise<RoiReply>;
}
