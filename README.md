# IRIS Starter Kit

Open-source, lightweight Electron starter for [IRIS](https://github.com/Bath-Impact-Lab/IRIS) markerless motion capture apps.

This project is intentionally minimal and not a commercial product. It exists as a small, readable base for exploring the core IRIS flow: camera configuration, calibration, and live motion capture. The goal is to stay easy to understand, easy to run, and easy to extend without pulling in a full production architecture.

## Scope

This starter intentionally keeps the app thin:

- camera setup for resolution, FPS, and rotation
- a calibration step for the DA3 startup flow
- a live view showing camera feeds and pose output
- very small IPC and process hooks to connect to IRIS
- no heavy product features, no commercial polish, no broad platform abstraction

## Minimal IRIS integration

The app is structured to keep IRIS logic isolated and small. The expected integration points are:

- [electron/ipc.ts](electron/ipc.ts) — Electron IPC handlers for camera listing, session start/stop, and stream events
- [electron/preload.ts](electron/preload.ts) — safe bridge exposing a tiny `window.irisStarter` API
- [electron/iris/config.ts](electron/iris/config.ts) — IRIS config generator for run/camera/calibration settings
- [electron/iris/processManager.ts](electron/iris/processManager.ts) — spawns and manages the IRIS CLI process
- [electron/iris/pipeServer.ts](electron/iris/pipeServer.ts) — reads pose frames from the named pipe
- [electron/iris/utils.ts](electron/iris/utils.ts) — temp config file creation for IRIS runs
- [src/types.ts](src/types.ts) — shared camera and pose models
- [src/App.vue](src/App.vue) — flow between camera setup, calibration, and live capture
- [src/components/LiveView.vue](src/components/LiveView.vue) — renders the live camera/mocap view

This is intentionally a minimal subset of the IRIS work used in Recapture V3. The starter should not copy the full IRIS architecture or broad research platform layers unless a specific feature requires it.

## What's included

- Camera setup (resolution, FPS, rotation per camera)
- DA3 calibration step (mock for now)
- Live view — camera feeds and mocap side by side
- IPC stubs ready for IRIS backend wiring
- Small, readable project layout suitable for experimentation

## Requirements

- Node.js 20+
- npm 10+
- Windows

## Run

```powershell
npm install
npm run dev
```

## Scripts

| Command | Description |
|---|---|
| `npm run dev` | Development |
| `npm run build` | Production build |
| `npm run preview` | Run production build |
| `npm run typecheck` | TypeScript check |
