import { contextBridge } from 'electron';

// IPC surface — expand when IRIS backend is wired.
contextBridge.exposeInMainWorld('irisStarter', {
  version: '0.1.0',
  platform: process.platform,
});
