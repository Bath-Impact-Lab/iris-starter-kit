import './loadDevEnv.js';
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

// Dev-only: the window stays hidden until ready-to-show, so a stalled startup
// is otherwise silent. Records each load stage and dumps them if the window
// is still hidden after STARTUP_WATCHDOG_MS.
const STARTUP_WATCHDOG_MS = 10_000;

function traceStartup(win: BrowserWindow): void {
  const t0 = Date.now();
  const stages: string[] = [];
  const mark = (stage: string) => stages.push(`+${Date.now() - t0}ms ${stage}`);
  const wc = win.webContents;
  wc.on('did-start-loading', () => mark('did-start-loading'));
  wc.on('did-navigate', (_e, url) => mark(`did-navigate ${url}`));
  wc.on('dom-ready', () => mark('dom-ready'));
  wc.on('did-finish-load', () => mark('did-finish-load'));
  wc.on('did-fail-load', (_e, code, desc, url) => mark(`did-fail-load ${code} ${desc} ${url}`));
  wc.on('render-process-gone', (_e, details) => mark(`render-process-gone ${details.reason}`));
  wc.on('unresponsive', () => mark('unresponsive'));
  app.on('child-process-gone', (_e, details) => mark(`child-process-gone ${details.type} ${details.reason}`));
  win.once('ready-to-show', () => mark('ready-to-show'));

  setTimeout(() => {
    if (win.isDestroyed() || win.isVisible()) return;
    console.warn(`[startup] window still hidden after ${STARTUP_WATCHDOG_MS}ms:\n  ${stages.join('\n  ') || '(no load events)'}`);
  }, STARTUP_WATCHDOG_MS);
}

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

  if (isDev) traceStartup(mainWindow);

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

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
