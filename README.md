# IRIS Starter Kit

Open-source, lightweight Electron starter for [IRIS](https://github.com/Bath-Impact-Lab/IRIS) markerless motion capture apps.

This project is intentionally minimal and not a commercial product. It exists as a small, readable base for exploring the core IRIS flow — camera configuration, DA3 calibration, and live motion capture — against a real `iris_cli` process, not a mock. The goal is to stay easy to understand, easy to run, and easy to extend without pulling in a full production architecture.

## Stack

- Electron + Vue 3 (Composition API) + Vite + TypeScript
- Node.js `child_process` + Windows named pipes to drive and read from `iris_cli`
- `ws` for a small local WebSocket relay (main process → renderer)
- WebCodecs (`VideoDecoder`) in the renderer to decode IRIS's live H.264 video output onto `<canvas>` — no video/streaming framework

## Flow

1. **Camera setup** — pick cameras, set resolution/FPS/rotation, see a live browser preview.
2. **Calibration** — starts a real `iris_cli run` process and runs IRIS's DA3 startup calibration.
3. **Live view** — once calibrated: live per-camera video feeds decoded straight from IRIS's own video pipes, plus a live 2D pose skeleton driven by IRIS's real pose output.

## What's included

- Camera setup (resolution, FPS, rotation per camera), persisted per device
- Real DA3 calibration against a running `iris_cli` process
- Live view — real decoded camera feeds and a real live mocap skeleton, side by side
- A narrow, typed `window.irisStarter` IPC bridge connecting the two
- Small, readable project layout suitable for experimentation

## Requirements

- Node.js 20+
- npm 10+
- Windows
- A real `iris_cli.exe` to see anything past camera setup. Easiest path:
  install **IRIS Core** from the official installer at
  <https://iris.cs.bath.ac.uk/> (Spec Builder isn't needed by this app),
  then just `npm run dev` — no extra setup. See [IRIS_BUNDLING.md](IRIS_BUNDLING.md)
  for env var overrides, bundling for distribution, or a gotcha around
  personal `IRIS_HOME` overrides shadowing the installer.

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
| `npm run test:iris` | Run the IRIS integration unit tests |
