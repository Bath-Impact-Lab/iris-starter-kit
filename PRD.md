# IRIS Starter Kit PRD

## Summary

A minimal, open-source Electron + Vue desktop app that demonstrates the core
IRIS markerless motion-capture flow end to end: configure cameras, run DA3
auto-calibration, then watch live camera feeds and a live 3D mocap skeleton
driven by a real `iris_cli` process. It is a reference/starter implementation,
not a commercial product.

## Problem

IRIS (Bath Impact Lab's markerless mocap engine) has no small, readable
example of how to drive it from a desktop app. Teams evaluating or building
on IRIS need a minimal, working reference for the CLI process lifecycle,
named-pipe protocols, and UI flow, without wading through a full production
codebase (e.g. Recapture V3).

## Goals

- Show the complete IRIS flow in one thin app: camera setup → DA3 calibration
  → live camera feeds + live pose skeleton.
- Keep the codebase small enough to read end to end in one sitting.
- Be a correct, working reference for wiring `iris_cli` from Electron/Node:
  process lifecycle, named pipes, pipeline spec JSON, video/pose streaming.

## Non-goals

- Not a commercial product (no participant/session management, no branding).
- No avatar retargeting, FBX export, or full iris-studio feature set.
- No broad platform abstraction. Windows only, one bundled/resolved
  `iris_cli.exe`.
- No cloud sync, accounts, or multi-user features.

## Target users

Engineers evaluating or integrating IRIS who want a working example rather
than documentation alone.

## Core features (current state)

1. **Camera setup**: enumerate video input devices, live browser preview,
   configure resolution/FPS/rotation per camera, persisted to `localStorage`.
2. **DA3 calibration**: starts a real `iris_cli run` process (opens cameras,
   warms up detection/pose/triangulation, runs DA3 startup calibration
   inline) and a `monitor` process to detect when a person is tracked.
3. **Live view**
   - **Camera feeds**: each pane decodes IRIS's own per-camera video-pipe
     output (H.264 Annex-B over a named pipe → local WebSocket relay →
     WebCodecs `VideoDecoder` → canvas), not a second `getUserMedia` capture,
     which is impossible once IRIS holds the camera natively.
   - **Live mocap**: a 2D skeleton overlay driven by real per-camera 2D
     keypoints (`points_2d`) from IRIS's pose pipe, falling back to a static
     placeholder pose when no person is currently tracked.
4. **IPC bridge**: a narrow `window.irisStarter` API (contextBridge) is the
   only surface the renderer touches; the main process owns all IRIS process,
   pipe, and persistence concerns.

## Out of scope for this app

- Recorded-session playback/export.
- Multi-participant tracking UI (IRIS supports it; this UI assumes one).
- Any 3D scene/point-cloud viewer (DA3 reconstruction reader exists in IRIS
  but isn't wired into this UI).

## Requirements / constraints

- Windows only, Node.js 20+, npm 10+.
- Needs a real `iris_cli.exe` (via `IRIS_HOME`, bundled `resources/iris/bin/`,
  or a system install) and compatible GPU/model files to do anything beyond
  camera setup, see `IRIS_BUNDLING.md`.
- Electron security baseline: `contextIsolation: true`, `nodeIntegration:
  false`, `sandbox: true`, restrictive CSP.

## Success criteria

- A developer can `npm install && npm run dev`, configure cameras, calibrate,
  and see live decoded video + a live pose skeleton from a real `iris_cli`
  run, with no manual protocol knowledge required.
- The IRIS integration code (process lifecycle, pipe protocols, spec JSON)
  is small and correct enough to copy into a larger app.
