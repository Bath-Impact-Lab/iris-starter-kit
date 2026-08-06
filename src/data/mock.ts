import type { CameraDevice } from '../types';

export const RESOLUTIONS = ['1280x720', '1920x1080', '2560x1440'] as const;
export const FPS_OPTIONS = [30, 60] as const;
export const ROTATION_OPTIONS = [0, 90, 180, 270] as const;

export const MOCK_CAMERAS: CameraDevice[] = [
  { id: 'cam-0', label: 'Camera 1' },
  { id: 'cam-1', label: 'Camera 2' },
];
