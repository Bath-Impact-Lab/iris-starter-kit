import { ipcMain, BrowserWindow } from 'electron';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { ProcessManager } from './iris/processManager.js';

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

function sendPoseFrame(event: Electron.IpcMainInvokeEvent, frame: unknown) {
  const targetWindow = BrowserWindow.fromWebContents(event.sender) ?? BrowserWindow.getFocusedWindow();
  if (targetWindow && !targetWindow.isDestroyed()) {
    targetWindow.webContents.send('iris:pose', frame);
  }
}

function emitStatusToAllWindows(processManager: ProcessManager) {
  const status = processManager.getStatus();
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send('iris:status', status);
    }
  }
}

export function registerIpcHandlers(processManager: ProcessManager): void {
  processManager.subscribe((status) => {
    emitStatusToAllWindows(processManager);
    console.log('[iris-dispatcher] status ->', status);
  });

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

  ipcMain.handle('iris:open-preview-monitor', async (event, input = {}) => {
    const { videoStreams } = await processManager.openPreviewMonitor(input, (frame) => sendPoseFrame(event, frame));
    return { ...processManager.getStatus(), videoStreams };
  });

  ipcMain.handle('iris:close-preview-monitor', async () => {
    await processManager.closePreviewMonitor();
    return processManager.getStatus();
  });

  ipcMain.handle('iris:stop-all', async () => {
    await processManager.stopAll();
    return processManager.getStatus();
  });

  ipcMain.handle('run:start-stream', async (event, options = {}) => {
    const runId = randomUUID();
    const result = await processManager.startStream({
      sessionId: runId,
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

  ipcMain.handle('run:stop', (_event, runId?: string) => processManager.stop(runId ?? ''));

  ipcMain.handle('run:save-config', () => ({ ok: true }));
}
