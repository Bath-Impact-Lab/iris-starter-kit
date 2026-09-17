/// <reference types="vite/client" />

import type { CameraDevice, RigCalibrationStatus, RunConfig } from './types';
import type { RoiApi } from '../../shared/roi';
import type { NativeCamera } from '../../shared/capture';

interface IrisStarterApi extends RoiApi {
  version: string;
  platform: string;
  listCameras: () => Promise<CameraDevice[]>;
  listCaptureCameras: () => Promise<NativeCamera[] | null>;
  saveRunConfig: (config: RunConfig) => Promise<{ ok: boolean }>;
  startPoseStream: (options?: Record<string, any>) => Promise<{ ok: boolean; sessionId?: string; error?: string }>;
  stopRun: (runId?: string) => Promise<{ ok: boolean; sessionId?: string; error?: string }>;
  startRun: (input?: Record<string, any>) => Promise<any>;
  openPreviewMonitor: (input?: Record<string, any>) => Promise<any>;
  closePreviewMonitor: () => Promise<any>;
  getStatus: () => Promise<any>;
  subscribe: (listener: (status: any) => void) => () => void;
  stopAll: () => Promise<any>;
  onPoseData: (callback: (frame: unknown) => void) => () => void;
  onCliOutput: (callback: (payload: { channel: string; line: string }) => void) => () => void;
  getRigCalibrationStatus: () => Promise<RigCalibrationStatus>;
  beginRigCalibrationCapture: (input: { cameraCount: number; targetFps?: number }) => Promise<RigCalibrationStatus>;
  finishRigCalibrationCapture: (input: {
    cameras: Array<{ id: string; label?: string; resolution?: string; fps?: number; rotation?: number }>;
    rotation?: number;
    markerSizeMm?: number;
    markerId?: number;
  }) => Promise<RigCalibrationStatus>;
  cancelRigCalibrationCapture: () => Promise<RigCalibrationStatus>;
}

declare global {
  interface Window {
    irisStarter: IrisStarterApi;
  }
}

export {};
