import { app, BrowserWindow, Menu } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { registerIpcHandlers } from './ipc.js';
import { ProcessManager } from './iris/processManager.js';
import { IrisRunStore } from './iris/runStore.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const isDev = process.env.NODE_ENV === 'development';
const devServerUrl = process.env.ELECTRON_RENDERER_URL;

let mainWindow: BrowserWindow | null = null;
let processManager: ProcessManager | null = null;
let irisStopped = false;

// ProcessManager.stop escalates to SIGKILL after 5.5s; never block quit longer than this.
const QUIT_STOP_TIMEOUT_MS = 7000;

function createWindow(): void {
  mainWindow = new BrowserWindow({
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

  // 'ready-to-show' fires on the window's first real compositor frame -- normally
  // near-instant, but it can occasionally never fire at all (seen in practice: a stale
  // GPU process from a prior un-closed run left contending for the GPU). Windows without
  // this fallback stay invisible forever with no error anywhere. Force a show after a
  // few seconds as a backstop; the flag just avoids a harmless double-call to show().
  let shown = false;
  const showOnce = (): void => {
    if (shown || !mainWindow) return;
    shown = true;
    mainWindow.show();
  };
  mainWindow.once('ready-to-show', showOnce);
  setTimeout(showOnce, 4000);

  if (isDev && devServerUrl) {
    void mainWindow.loadURL(devServerUrl);
  } else {
    void mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
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
