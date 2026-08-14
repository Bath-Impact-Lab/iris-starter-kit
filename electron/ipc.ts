import { ipcMain, BrowserWindow } from 'electron';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { ProcessManager } from './iris/processManager.js';

const execFileAsync = promisify(execFile);
const processManager = new ProcessManager();

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

function sendPoseFrame(event: Electron.IpcMainInvokeEvent, frame: unknown) {
  const targetWindow = BrowserWindow.fromWebContents(event.sender) ?? BrowserWindow.getFocusedWindow();
  if (targetWindow && !targetWindow.isDestroyed()) {
    targetWindow.webContents.send('iris:pose', frame);
  }
}

function emitStatusToAllWindows() {
  const status = processManager.getStatus();
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send('iris:status', status);
    }
  }
}

export function registerIpcHandlers(): void {
  processManager.subscribe((status) => {
    emitStatusToAllWindows();
    console.log('[iris-dispatcher] status ->', status);
  });

  ipcMain.handle('app:get-info', () => ({
    version: '0.1.0',
    platform: process.platform,
  }));

  ipcMain.handle('cameras:list', async () => await listWindowsCameras());

  ipcMain.handle('iris:get-status', () => processManager.getStatus());

  ipcMain.handle('iris:start-run', async (_event, input = {}) => {
    const result = await processManager.startRun(input);
    return {
      ok: result.ok,
      runId: result.runId,
      state: result.state,
      runCount: result.runCount,
      previewOpen: processManager.getStatus().previewOpen,
      failed: result.failed,
      error: result.error,
    };
  });

  ipcMain.handle('iris:open-preview-monitor', async (_event, input = {}) => {
    await processManager.openPreviewMonitor(input);
    return processManager.getStatus();
  });

  ipcMain.handle('iris:close-preview-monitor', async () => {
    await processManager.closePreviewMonitor();
    return processManager.getStatus();
  });

  ipcMain.handle('iris:stop-all', async () => {
    await processManager.stopAll();
    return processManager.getStatus();
  });

  ipcMain.handle('iris:shutdown', async () => {
    await processManager.shutdown();
    return processManager.getStatus();
  });

  ipcMain.handle('session:start', async (event, options = {}) => {
    const sessionId = randomUUID();
    const result = await processManager.startStandard({
      sessionId,
      options,
      onCliOutput: (payload) => {
        const targetWindow = BrowserWindow.fromWebContents(event.sender) ?? BrowserWindow.getFocusedWindow();
        if (targetWindow && !targetWindow.isDestroyed()) {
          targetWindow.webContents.send('iris:cli-output', payload);
        }
      },
    });

    return result;
  });

  ipcMain.handle('session:start-stream', async (event, options = {}) => {
    const sessionId = randomUUID();
    const result = await processManager.startStream({
      sessionId,
      options,
      onCliOutput: (payload) => {
        const targetWindow = BrowserWindow.fromWebContents(event.sender) ?? BrowserWindow.getFocusedWindow();
        if (targetWindow && !targetWindow.isDestroyed()) {
          targetWindow.webContents.send('iris:cli-output', payload);
        }
      },
      onFrame: (frame) => sendPoseFrame(event, frame),
    });

    return result;
  });

  ipcMain.handle('session:stop', (_event, sessionId?: string) => processManager.stop(sessionId ?? ''));

  ipcMain.handle('session:save-config', () => ({ ok: true }));
}
