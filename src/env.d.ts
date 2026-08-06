/// <reference types="vite/client" />

import type { CameraDevice, SessionConfig } from './types';

interface IrisStarterApi {
  version: string;
  platform: string;
  getAppInfo: () => Promise<{ version: string; platform: string }>;
  listCameras: () => Promise<CameraDevice[]>;
  saveSessionConfig: (config: SessionConfig) => Promise<{ ok: boolean }>;
}

declare global {
  interface Window {
    irisStarter: IrisStarterApi;
  }
}

export {};
