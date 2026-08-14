/// <reference types="vite/client" />

import type { CameraDevice, SessionConfig } from './types';

interface IrisStarterApi {
  version: string;
  platform: string;
  getAppInfo: () => Promise<{ version: string; platform: string }>;
  listCameras: () => Promise<CameraDevice[]>;
  saveSessionConfig: (config: SessionConfig) => Promise<{ ok: boolean }>;
  startSession: (options?: Record<string, any>) => Promise<{ ok: boolean; sessionId?: string; error?: string }>;
  startPoseStream: (options?: Record<string, any>) => Promise<{ ok: boolean; sessionId?: string; error?: string }>;
  stopSession: (sessionId?: string) => Promise<{ ok: boolean; sessionId?: string; error?: string }>;
  startRun: (input?: Record<string, any>) => Promise<any>;
  openPreviewMonitor: (input?: Record<string, any>) => Promise<any>;
  closePreviewMonitor: () => Promise<any>;
  getStatus: () => Promise<any>;
  subscribe: (listener: (status: any) => void) => () => void;
  stopAll: () => Promise<any>;
  shutdown: () => Promise<any>;
  onPoseData: (callback: (frame: unknown) => void) => () => void;
  onCliOutput: (callback: (payload: { channel: string; line: string }) => void) => () => void;
}

declare global {
  interface Window {
    irisStarter: IrisStarterApi;
    // starterKit: IrisStarterApi;
  }
}

export {};
