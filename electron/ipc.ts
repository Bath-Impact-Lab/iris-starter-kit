import { ipcMain } from 'electron';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

interface CameraDevice {
  id: string;
  label: string;
}

const MOCK_CAMERAS: CameraDevice[] = [
  { id: 'cam-0', label: 'Camera 1' },
  { id: 'cam-1', label: 'Camera 2' },
];

async function listWindowsCameras(): Promise<CameraDevice[]> {
  const script = `Get-PnpDevice -Class Camera | Where-Object Status -eq 'OK' | Select-Object -Property InstanceId, FriendlyName | ConvertTo-Json -Compress`;

  try {
    const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-Command', script], { windowsHide: true, timeout: 5000 });
    if (!stdout) {
      return MOCK_CAMERAS;
    }

    const data = JSON.parse(stdout);
    if (Array.isArray(data)) {
      console.log('[iris-ipc] native camera enumeration result:', data);
      return data.map((item) => ({ id: String(item.InstanceId), label: String(item.FriendlyName) }));
    }

    if (data && typeof data === 'object' && data.InstanceId && data.FriendlyName) {
      console.log('[iris-ipc] native camera enumeration result:', data);
      return [{ id: String(data.InstanceId), label: String(data.FriendlyName) }];
    }

    return MOCK_CAMERAS;
  } catch (error) {
    console.warn('[iris-ipc] native camera enumeration failed:', error);
    return MOCK_CAMERAS;
  }
}

export function registerIpcHandlers(): void {
  ipcMain.handle('app:get-info', () => ({
    version: '0.1.0',
    platform: process.platform,
  }));

  ipcMain.handle('cameras:list', async () => await listWindowsCameras());

  ipcMain.handle('session:save-config', () => ({ ok: true }));
}
