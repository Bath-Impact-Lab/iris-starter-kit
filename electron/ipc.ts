import { ipcMain } from 'electron';

interface CameraDevice {
  id: string;
  label: string;
}

const MOCK_CAMERAS: CameraDevice[] = [
  { id: 'cam-0', label: 'Camera 1' },
  { id: 'cam-1', label: 'Camera 2' },
];

export function registerIpcHandlers(): void {
  ipcMain.handle('app:get-info', () => ({
    version: '0.1.0',
    platform: process.platform,
  }));

  ipcMain.handle('cameras:list', () => MOCK_CAMERAS);

  ipcMain.handle('session:save-config', () => ({ ok: true }));
}
