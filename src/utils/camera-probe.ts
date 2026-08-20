import type { CameraDevice, Resolution } from '../types';
import { RESOLUTIONS, FPS_OPTIONS } from '../data/mock';

function parseResolution(res: string): { w: number; h: number } {
  const [w, h] = res.split('x').map((v) => parseInt(v, 10));
  return { w: Number.isFinite(w) ? w : 0, h: Number.isFinite(h) ? h : 0 };
}

export function getCommonResolutionOptions(devices: CameraDevice[]): Resolution[] {
  const options = [...RESOLUTIONS] as Resolution[];
  if (devices.length === 0) return options;

  return options
    .filter((resolution) => {
      const target = parseResolution(resolution);
      return devices.every((device) => {
        if (!device.maxResolution) return false;
        const max = parseResolution(device.maxResolution);
        return target.w <= max.w && target.h <= max.h;
      });
    })
    .sort((a, b) => {
      const aSize = parseResolution(a).w * parseResolution(a).h;
      const bSize = parseResolution(b).w * parseResolution(b).h;
      return bSize - aSize;
    });
}

export function getCommonFpsOptions(devices: CameraDevice[]): number[] {
  const options = [...FPS_OPTIONS] as number[];
  if (devices.length === 0) return options;

  return options
    .filter((value) => devices.every((device) => device.maxFps == null || value <= device.maxFps))
    .sort((a, b) => b - a);
}

export function selectCommonConfig(devices: CameraDevice[]) {
  const resolutionOptions = getCommonResolutionOptions(devices);
  const fpsOptions = getCommonFpsOptions(devices);

  return {
    resolution: resolutionOptions[0] ?? ('1280x720' as Resolution),
    fps: fpsOptions[0] ?? 30,
  };
}

function pickClosestResolution(width: number, height: number): Resolution {
  const resolutions = [...RESOLUTIONS] as Resolution[];
  let best: Resolution = resolutions[0] ?? ('1280x720' as Resolution);
  let bestDiff = Infinity;

  for (const r of resolutions) {
    const { w, h } = parseResolution(r);
    const diff = Math.abs(w - width) + Math.abs(h - height);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = r;
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
