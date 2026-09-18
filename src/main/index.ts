import './loadDevEnv.js';
import { app, BrowserWindow, Menu } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { registerIpcHandlers } from './ipc.js';
import { ProcessManager } from './iris/processManager.js';
import { IrisRunStore } from './iris/runStore.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const isDev = process.env.NODE_ENV === 'development';
const devServerUrl = process.env.ELECTRON_RENDERER_URL ?? (isDev ? 'http://127.0.0.1:5173' : undefined);

let mainWindow: BrowserWindow | null = null;
let processManager: ProcessManager | null = null;
let irisStopped = false;

// ProcessManager.stop escalates to SIGKILL after 5.5s; never block quit longer than this.
const QUIT_STOP_TIMEOUT_MS = 7000;
const WINDOW_REVEAL_TIMEOUT_MS = 10000;
const DEV_RENDERER_RETRY_DELAYS_MS = [0, 200, 400, 800, 1200, 2000, 2000, 2000];

function wait(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

async function loadRenderer(window: BrowserWindow): Promise<void> {
  if (!isDev || !devServerUrl) {
    await window.loadFile(path.join(__dirname, '../renderer/index.html'));
    return;
  }

  let lastError: unknown;
  for (const [attempt, delayMs] of DEV_RENDERER_RETRY_DELAYS_MS.entries()) {
    if (delayMs > 0) await wait(delayMs);
    if (window.isDestroyed()) return;

    try {
      await window.loadURL(devServerUrl);
      if (attempt > 0) {
        console.info(`[startup] Renderer connected after ${attempt + 1} attempts.`);
      }
      return;
    } catch (error) {
      lastError = error;
      console.warn(
        `[startup] Renderer load attempt ${attempt + 1}/${DEV_RENDERER_RETRY_DELAYS_MS.length} failed; retrying.`,
        error,
      );
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

function createWindow(): void {
  const window = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    backgroundColor: '#0f1115',
    show: false,
    title: 'IRIS Starter Kit',
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#141820',
      symbolColor: '#9aa4b8',
      height: 40,
    },
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow = window;

  // `ready-to-show` is not guaranteed when the initial dev-server request
  // fails. Never leave a live Electron process permanently invisible.
  const revealTimeout = setTimeout(() => {
    if (!window.isDestroyed() && !window.isVisible()) {
      console.warn('[startup] Window was still hidden after 10 seconds; showing it for diagnostics.');
      window.show();
    }
  }, WINDOW_REVEAL_TIMEOUT_MS);

  void loadRenderer(window)
    .then(() => {
      clearTimeout(revealTimeout);
      if (!window.isDestroyed()) window.show();
    })
    .catch((error) => {
      clearTimeout(revealTimeout);
      console.error('[startup] Renderer failed to load after retries:', error);
      if (!window.isDestroyed()) window.show();
    });

  window.on('closed', () => {
    clearTimeout(revealTimeout);
    if (mainWindow === window) mainWindow = null;
  });
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);

  processManager = new ProcessManager({ runStore: new IrisRunStore(app.getPath('userData')) });
  registerIpcHandlers(processManager);
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', (event) => {
  if (irisStopped || !processManager) return;
  event.preventDefault();
  irisStopped = true;
  const timeout = new Promise<void>((resolve) => setTimeout(resolve, QUIT_STOP_TIMEOUT_MS));
  Promise.race([processManager.stopAll(), timeout])
    .catch((error) => console.error('[iris] shutdown failed', error))
    .finally(() => app.quit());
});
