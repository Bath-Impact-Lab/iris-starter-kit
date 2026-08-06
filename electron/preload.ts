import { contextBridge, ipcRenderer } from 'electron';

interface SessionConfig {
  cameras: Array<{
    deviceId: string;
    label: string;
    resolution: string;
    fps: number;
    rotation: number;
  }>;
}

contextBridge.exposeInMainWorld('irisStarter', {
  version: '0.1.0',
  platform: process.platform,
  getAppInfo: () => ipcRenderer.invoke('app:get-info'),
  listCameras: () => ipcRenderer.invoke('cameras:list'),
  saveSessionConfig: (config: SessionConfig) => ipcRenderer.invoke('session:save-config', config),
});
