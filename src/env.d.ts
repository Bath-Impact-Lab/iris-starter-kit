/// <reference types="vite/client" />

import type { CameraDevice, RunConfig } from './types';

interface IrisStarterApi {
  version: string;
  platform: string;
  listCameras: () => Promise<CameraDevice[]>;
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
}

declare global {
  interface Window {
    irisStarter: IrisStarterApi;
  }
}

export {};
