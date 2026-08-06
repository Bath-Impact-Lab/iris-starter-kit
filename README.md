# IRIS Starter Kit

A **simple, pluggable, open-source desktop app** starter for building on top of [IRIS](https://github.com/Bath-Impact-Lab/IRIS) markerless motion capture.

This is an **Electron desktop application** (not a web deployment). Monolith-first: one app, one Vue UI, minimal moving parts. IRIS process integration hooks in later.

## Planned flow

1. **Camera setup** — auto-detect cameras, set resolution/FPS, show rotation per camera  
2. **Calibration** — start IRIS with DA3 auto-calibration  
3. **Live view** — camera feed and mocap skeleton side by side  

## Stack

- **Electron** — desktop shell, filesystem, native process (later)  
- **Vue 3** — UI  
- **Vite** — dev server and build  
- **TypeScript** — renderer + main process  

## Requirements

- Node.js 20+  
- npm 10+  
- Windows (primary target for IRIS; other OS later)  

## Quick start

```powershell
cd iris-starter-kit
npm install
npm run dev
```

This opens the Electron window loading the Vite dev server.

## Scripts

| Command | Description |
|---|---|
| `npm run dev` | Dev: Vite + Electron |
| `npm run build` | Production build (renderer + main) |
| `npm run preview` | Run production build locally |
| `npm run typecheck` | TypeScript check only |

## Project layout

```
iris-starter-kit/
├── electron/          # Main process + preload (IPC later)
├── src/               # Vue renderer
├── index.html
├── vite.config.ts
└── package.json
```

## Roadmap

- [x] Electron + Vue + Vite + TypeScript bootstrap  
- [ ] UI flow (camera setup → calibration → live view)  
- [ ] IRIS backend integration  

## License

MIT
