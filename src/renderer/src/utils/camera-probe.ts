import type { CameraDevice, Resolution } from '../types';
import { RESOLUTIONS } from '../data/mock';
import { usableModes, modeFps, sameFps, type NativeCamera } from '../../../shared/capture';

export function parseResolution(res: string): { w: number; h: number } {
  const [w, h] = res.split('x').map((v) => parseInt(v, 10));
  return { w: Number.isFinite(w) ? w : 0, h: Number.isFinite(h) ? h : 0 };
}

export function previewVideoConstraints(
  deviceId: string,
  resolution: Resolution,
  fps: number,
  exactSize = true,
): MediaTrackConstraints {
  const { w, h } = parseResolution(resolution);
  const constraints: MediaTrackConstraints = {
    deviceId: { exact: deviceId },
    width: exactSize ? { exact: w } : { ideal: w },
    height: exactSize ? { exact: h } : { ideal: h },
    frameRate: { ideal: fps },
    aspectRatio: { ideal: w / h },
  };
  // Chromium supports this standard constraint, but TypeScript's bundled DOM
  // declarations do not include it yet. It asks the browser not to crop and
  // scale a different sensor mode to satisfy the requested dimensions.
  (constraints as MediaTrackConstraints & { resizeMode: { ideal: string } }).resizeMode = { ideal: 'none' };
  return constraints;
}

export interface PreviewMode {
  width?: number;
  height?: number;
  fps?: number;
  approximate: boolean;
}

export function describePreviewMode(
  settings: Pick<MediaTrackSettings, 'width' | 'height' | 'frameRate'>,
  resolution: Resolution,
  fps: number,
): PreviewMode {
  const target = parseResolution(resolution);
  const width = Number.isFinite(settings.width) ? settings.width : undefined;
  const height = Number.isFinite(settings.height) ? settings.height : undefined;
  const actualFps = Number.isFinite(settings.frameRate) ? settings.frameRate : undefined;
  return {
    width,
    height,
    fps: actualFps,
    approximate: width !== target.w || height !== target.h || actualFps === undefined || Math.abs(actualFps - fps) > 0.5,
  };
}

export function getCommonResolutionOptions(devices: CameraDevice[]): Resolution[] {
  const native = devices.find(device => device.modes?.length);
  const options = native ? [...new Set(usableModes(native.modes!).map(mode => `${mode.width}x${mode.height}` as Resolution))] : [...RESOLUTIONS];
  if (devices.length === 0) return options;

  return options
    .filter((resolution) => {
      const target = parseResolution(resolution);
      return devices.every((device) => {
        if (device.modes?.length) return usableModes(device.modes).some(mode => mode.width === target.w && mode.height === target.h);
        if (!device.maxResolution) return true;
        const max = parseResolution(device.maxResolution);
        return target.w <= max.w && target.h <= max.h;
      });
    })
    .filter(resolution => getCommonFpsOptions(devices, resolution).length > 0)
    .sort((a, b) => {
      const aSize = parseResolution(a).w * parseResolution(a).h;
      const bSize = parseResolution(b).w * parseResolution(b).h;
      return bSize - aSize;
    });
}

export function getCommonFpsOptions(devices: CameraDevice[], resolution: Resolution = '1920x1080'): number[] {
  const { w, h } = parseResolution(resolution);
  const native = devices.find(device => device.modes?.length);
  const options = native ? usableModes(native.modes!).filter(mode => mode.width === w && mode.height === h).map(modeFps) :
    [15, 24, 25, 30, 50, 60, 90, 120, ...devices.flatMap(device => device.suggestedFps ? [device.suggestedFps] : [])];

  return options
    .filter((value, index, all) => all.findIndex(other => sameFps(value, other)) === index)
    .filter((value) => devices.every((device) => device.modes?.length ? usableModes(device.modes).some(mode =>
      mode.width === w && mode.height === h && sameFps(modeFps(mode), value)) :
      (device.maxFps == null || value <= device.maxFps) && (device.minFps == null || value >= device.minFps)))
    .sort((a, b) => b - a);
}

export function selectCommonConfig(devices: CameraDevice[]) {
  const resolutionOptions = getCommonResolutionOptions(devices);
  const resolution = resolutionOptions.includes('1920x1080') ? '1920x1080' : resolutionOptions[0];
  const fpsOptions = getCommonFpsOptions(devices, resolution);

  return {
    resolution: resolution ?? ('1280x720' as Resolution),
    fps: [...fpsOptions].sort((a, b) => Math.abs(a - 30) - Math.abs(b - 30) || a - b)[0] ?? 30,
  };
}

export function nativeCameraProfiles(native: NativeCamera[], browser: Array<{ deviceId: string; label: string }>): CameraDevice[] {
  const labelKey = (label: string) => label.replace(/\s*\([0-9a-f]{4}:[0-9a-f]{4}\)\s*$/i, '').trim().toLowerCase();
  return native.map(camera => {
    const matches = browser.filter(device => labelKey(device.label) === labelKey(camera.name));
    const peers = native.filter(other => labelKey(other.name) === labelKey(camera.name));
    const ordinal = peers.indexOf(camera);
    // Same-model cameras are paired in enumeration order, as in the original setup.
    // Browser IDs and native paths are different namespaces; this is not a physical-ID match.
    return { id: camera.devicePath ?? String(camera.index), label: peers.length > 1 ? `${camera.name} ${ordinal + 1}` : camera.name, nativeIndex: camera.index,
      modes: camera.modes, browserDeviceId: matches[ordinal]?.deviceId };
  });
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
    // ignore, caller should handle missing labels/permissions
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
    else if (settings.frameRate) suggestedFps = settings.frameRate;

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

    const maxFps = fpsRange?.max ?? settings.frameRate;

    track.stop();

    return {
      id: deviceId,
      label: track.label || `Camera ${deviceId}`,
      suggestedResolution,
      suggestedFps,
      defaultRotation,
      maxResolution,
      maxFps,
      minFps: fpsRange?.min,
      browserDeviceId: deviceId,
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
