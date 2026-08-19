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

const irisApi = {
  version: '0.1.0',
  platform: process.platform,
  getAppInfo: () => ipcRenderer.invoke('app:get-info'),
  listCameras: () => ipcRenderer.invoke('cameras:list') as Promise<CameraDevice[]>,
  saveSessionConfig: (config: SessionConfig) => ipcRenderer.invoke('session:save-config', config),
  startSession: (options?: Record<string, any>) => ipcRenderer.invoke('session:start', options),
  startPoseStream: (options?: Record<string, any>) => ipcRenderer.invoke('session:start-stream', options),
  stopSession: (sessionId?: string) => ipcRenderer.invoke('session:stop', sessionId),
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
  shutdown: () => ipcRenderer.invoke('iris:shutdown'),
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
};

contextBridge.exposeInMainWorld('irisStarter', irisApi);
contextBridge.exposeInMainWorld('starterKit', irisApi);
