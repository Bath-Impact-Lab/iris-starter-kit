import type { PoseModelId, PoseModelAvailability } from '../shared/poseModels';
import { contextBridge, ipcRenderer } from 'electron';
import type { RoiEdit, RoiReply, SceneKey, Da3SceneReply } from '../shared/roi';
import type { NativeCamera } from '../shared/capture';

type Resolution = `${number}x${number}`;

interface CameraDevice {
  id: string;
  label: string;
  suggestedResolution?: Resolution;
  suggestedFps?: number;
  defaultRotation?: number;
}

interface RunConfig {
  cameras: Array<{
    deviceId: string;
    label: string;
    resolution: Resolution;
    fps: number;
    rotation: number;
  }>;
}

const irisApi = {
  listPoseModels: () => ipcRenderer.invoke('pose-models:list') as Promise<PoseModelAvailability[]>,
  validatePoseModel: (id: PoseModelId) => ipcRenderer.invoke('pose-models:validate', id) as Promise<void>,
  roiScene: (key: SceneKey) => ipcRenderer.invoke('roi:scene', key) as Promise<Da3SceneReply>,
  roiGet: () => ipcRenderer.invoke('roi:get') as Promise<RoiReply>,
  roiPreview: (edit: RoiEdit) => ipcRenderer.invoke('roi:preview', edit) as Promise<RoiReply>,
  roiApply: (edit: RoiEdit) => ipcRenderer.invoke('roi:apply', edit) as Promise<RoiReply>,
  version: '0.1.0',
  platform: process.platform,
  listCameras: () => ipcRenderer.invoke('cameras:list') as Promise<CameraDevice[]>,
  listCaptureCameras: () => ipcRenderer.invoke('cameras:capture') as Promise<NativeCamera[] | null>,
  saveRunConfig: (config: RunConfig) => ipcRenderer.invoke('run:save-config', config),
  startPoseStream: (options?: Record<string, any>) => ipcRenderer.invoke('run:start-stream', options),
  stopRun: (runId?: string) => ipcRenderer.invoke('run:stop', runId),
  startRun: (input?: Record<string, any>) => ipcRenderer.invoke('iris:start-run', input),
  openPreviewMonitor: (input?: Record<string, any>) => ipcRenderer.invoke('iris:open-preview-monitor', input),
  closePreviewMonitor: () => ipcRenderer.invoke('iris:close-preview-monitor'),
  getStatus: () => ipcRenderer.invoke('iris:get-status'),
  subscribe: (listener: (status: unknown) => void) => {
    const handler = (_event: unknown, status: unknown) => listener(status);
    ipcRenderer.on('iris:status', handler);
    return () => ipcRenderer.removeListener('iris:status', handler);
  },
  stopAll: () => ipcRenderer.invoke('iris:stop-all'),
  onPoseData: (callback: (frame: unknown) => void) => {
    const handler = (_event: unknown, frame: unknown) => callback(frame);
    ipcRenderer.on('iris:pose', handler);
    return () => ipcRenderer.removeListener('iris:pose', handler);
  },
  onCliOutput: (callback: (payload: { channel: string; line: string }) => void) => {
    const handler = (_event: unknown, payload: { channel: string; line: string }) => callback(payload);
    ipcRenderer.on('iris:cli-output', handler);
    return () => ipcRenderer.removeListener('iris:cli-output', handler);
  },
  getRigCalibrationStatus: () => ipcRenderer.invoke('calibration:get-status'),
  beginRigCalibrationCapture: (input: { cameraCount: number; targetFps?: number }) =>
    ipcRenderer.invoke('calibration:begin-capture', input),
  // `cameras` here is the same { id, ... } shape startRun's payload uses
  // (App.vue maps CameraConfig.deviceId -> id before calling either) --
  // the fingerprint that decides whether a published calibration still
  // matches the rig has to be computed from identical input both times.
  finishRigCalibrationCapture: (input: {
    cameras: Array<{ id: string; label?: string; resolution?: string; fps?: number; rotation?: number }>;
    rotation?: number;
    markerSizeMm?: number;
    markerId?: number;
  }) => ipcRenderer.invoke('calibration:finish-capture', input),
  cancelRigCalibrationCapture: () => ipcRenderer.invoke('calibration:cancel-capture'),
};

contextBridge.exposeInMainWorld('irisStarter', irisApi);
