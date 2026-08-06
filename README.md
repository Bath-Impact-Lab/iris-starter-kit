# IRIS Starter Kit

Open-source Electron starter for [IRIS](https://github.com/Bath-Impact-Lab/IRIS) markerless motion capture apps.

## What's included

- Camera setup (resolution, FPS, rotation per camera)
- DA3 calibration step (mock for now)
- Live view — camera feeds and mocap side by side
- IPC stubs ready for IRIS backend wiring

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
