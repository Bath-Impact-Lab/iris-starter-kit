import { contextBridge, ipcRenderer } from 'electron';

type Resolution = '1280x720' | '1920x1080' | '2560x1440';

interface CameraDevice {
  id: string;
  label: string;
  suggestedResolution?: Resolution;
  suggestedFps?: number;
  defaultRotation?: number;
}

interface SessionConfig {
  cameras: Array<{
    deviceId: string;
    label: string;
    resolution: Resolution;
    fps: number;
    rotation: number;
  }>;
}

contextBridge.exposeInMainWorld('irisStarter', {
  version: '0.1.0',
  platform: process.platform,
  getAppInfo: () => ipcRenderer.invoke('app:get-info'),
  listCameras: () => ipcRenderer.invoke('cameras:list') as Promise<CameraDevice[]>,
  saveSessionConfig: (config: SessionConfig) => ipcRenderer.invoke('session:save-config', config),
});
