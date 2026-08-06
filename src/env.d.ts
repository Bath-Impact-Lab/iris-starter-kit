/// <reference types="vite/client" />

interface IrisStarterApi {
  version: string;
  platform: string;
}

declare global {
  interface Window {
    irisStarter: IrisStarterApi;
  }
}

export {};
