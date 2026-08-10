import type { CameraDevice, Resolution } from '../types';
import { RESOLUTIONS, FPS_OPTIONS } from '../data/mock';

function parseResolution(res: string) {
  const [w, h] = res.split('x').map((v) => parseInt(v, 10));
  return { w, h };
}

export function selectCommonConfig(devices: CameraDevice[]) {
  const validResolutions = RESOLUTIONS.filter((resolution) => {
    const target = parseResolution(resolution);
    return devices.every((device) => {
      if (!device.maxResolution) return false;
      const max = parseResolution(device.maxResolution);
      return target.w <= max.w && target.h <= max.h;
    });
  });

  const resolution = validResolutions.length ? validResolutions[validResolutions.length - 1] : undefined;
  const minMaxFps = devices.reduce((current, device) => {
    if (device.maxFps == null) return current;
    return Math.min(current, device.maxFps);
  }, Infinity);
  const fps = FPS_OPTIONS.filter((value) => value <= minMaxFps).pop() ?? 30;

  return { resolution, fps };
}

function pickClosestResolution(width: number, height: number): Resolution {
  let best: Resolution = RESOLUTIONS[0];
  let bestDiff = Infinity;
  for (const r of RESOLUTIONS) {
    const { w, h } = parseResolution(r);
    const diff = Math.abs(w - width) + Math.abs(h - height);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = r as Resolution;
    }
  }
  return best;
}

export async function ensurePermission(): Promise<void> {
  try {
    const s = await navigator.mediaDevices.getUserMedia({ video: true });
    s.getTracks().forEach((t) => t.stop());
  } catch (err) {
    // ignore — caller should handle missing labels/permissions
  }
}

export async function listVideoInputs(): Promise<Array<{ deviceId: string; label: string }>> {
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices
    .filter((d) => d.kind === 'videoinput')
    .map((d) => ({ deviceId: d.deviceId, label: d.label || `Camera ${d.deviceId}` }));
}

export async function probeCamera(deviceId: string): Promise<CameraDevice> {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { deviceId: { exact: deviceId } } });
    const track = stream.getVideoTracks()[0];
    const capabilities = track.getCapabilities ? track.getCapabilities() : ({} as any);
    const settings = track.getSettings ? track.getSettings() : ({} as any);

    const fpsRange = capabilities.frameRate ? { min: capabilities.frameRate.min, max: capabilities.frameRate.max } : null;

    let suggestedFps: number | undefined;
    if (fpsRange) suggestedFps = Math.min(fpsRange.max, 30);
    else if (settings.frameRate) suggestedFps = Math.round(settings.frameRate as number);

    let suggestedResolution: Resolution | undefined;
    let maxResolution: Resolution | undefined;
    let defaultRotation = 0;
    let widthRange: { min: number; max: number } | undefined;
    let heightRange: { min: number; max: number } | undefined;

    if (capabilities.width && capabilities.height) {
      const maxW = typeof capabilities.width === 'object' ? capabilities.width.max : (capabilities.width as number);
      const minW = typeof capabilities.width === 'object' ? capabilities.width.min : (capabilities.width as number);
      const maxH = typeof capabilities.height === 'object' ? capabilities.height.max : (capabilities.height as number);
      const minH = typeof capabilities.height === 'object' ? capabilities.height.min : (capabilities.height as number);
      widthRange = { min: minW ?? 0, max: maxW ?? 0 };
      heightRange = { min: minH ?? 0, max: maxH ?? 0 };
      suggestedResolution = pickClosestResolution(maxW || (settings.width as number) || 1280, maxH || (settings.height as number) || 720);
      maxResolution = suggestedResolution;
    } else if (settings.width && settings.height) {
      const width = settings.width as number;
      const height = settings.height as number;
      widthRange = { min: width, max: width };
      heightRange = { min: height, max: height };
      suggestedResolution = pickClosestResolution(width, height);
      maxResolution = suggestedResolution;
    }

    if (typeof settings.rotation === 'number') {
      defaultRotation = settings.rotation;
    } else if (widthRange && heightRange && heightRange.max > widthRange.max) {
      defaultRotation = 90;
    }

    const maxFps = fpsRange ? Math.round(Math.min(fpsRange.max, 60)) : (settings.frameRate ? Math.round(settings.frameRate as number) : undefined);
    const availableResolutions = RESOLUTIONS.filter((resolution) => {
      if (!maxResolution || !widthRange || !heightRange) return false;
      const { w, h } = parseResolution(resolution);
      return w <= widthRange.max && h <= heightRange.max;
    });
    const availableFps = fpsRange ? FPS_OPTIONS.filter((value) => value >= fpsRange.min && value <= fpsRange.max) : (settings.frameRate ? [Math.round(settings.frameRate as number)] : []);

    // log raw capabilities and settings for inspect/devtools
    try {
      console.log('[probeCamera] deviceId=', deviceId, {
        capabilities,
        settings,
        widthRange,
        heightRange,
        fpsRange,
        availableResolutions,
        availableFps,
        suggestedResolution,
        suggestedFps,
        maxResolution,
        maxFps,
        defaultRotation,
      });
    } catch {}

    track.stop();

    return {
      id: deviceId,
      label: settings.label || `Camera ${deviceId}`,
      suggestedResolution,
      suggestedFps,
      defaultRotation,
      maxResolution,
      maxFps,
    };
  } catch (err) {
    // fallback: return minimal info
    return {
      id: deviceId,
      label: `Camera ${deviceId}`,
      defaultRotation: 0,
    };
  }
}

type CameraLogEntry = {
  ts: number;
  settings: Record<string, any>;
  estimatedFps?: number;
};

export function startCameraLogger(videoEl: HTMLVideoElement, deviceId: string) {
  let rafId: number | null = null;
  let frameCount = 0;
  let lastTs = performance.now();
  let lastSampleTs = performance.now();
  const logs: CameraLogEntry[] = [];

  function onFrame() {
    frameCount++;
    const now = performance.now();
    if (now - lastSampleTs >= 1000) {
      const estFps = Math.round((frameCount * 1000) / (now - lastSampleTs));
      // attempt to read settings from the underlying track
      const stream = videoEl.srcObject as MediaStream | null;
      const track = stream ? stream.getVideoTracks()[0] : null;
      const settings = track && (track.getSettings ? track.getSettings() : {}) || {};
      const entry: CameraLogEntry = { ts: Date.now(), settings, estimatedFps: estFps };
      logs.push(entry);
      try {
        const prev = localStorage.getItem(`camera-log:${deviceId}`);
        const arr = prev ? JSON.parse(prev) : [];
        arr.push(entry);
        localStorage.setItem(`camera-log:${deviceId}`, JSON.stringify(arr.slice(-500)));
      } catch {
        // ignore storage errors
      }
      console.log('[camera-log]', deviceId, entry);
      frameCount = 0;
      lastSampleTs = now;
    }
    rafId = requestAnimationFrame(onFrame);
  }

  rafId = requestAnimationFrame(onFrame);

  return {
    stop() {
      if (rafId) cancelAnimationFrame(rafId);
    },
    getLogs() {
      return logs.slice();
    },
  };
}
