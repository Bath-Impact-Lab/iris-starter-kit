import { createApp, h } from 'vue';
import CameraSetupModal from '../../src/renderer/src/components/CameraSetupModal.vue';

const mode = (width: number, height: number, fps: number, denominator = 1) =>
  ({ width, height, fpsNumerator: fps, fpsDenominator: denominator, format: 'MJPEG' });
const native = [
  { index: 4, name: 'OBSBOT', devicePath: 'path-a', modes: [mode(1920, 1080, 30), mode(1280, 720, 60000, 1001), mode(1280, 720, 120)] },
  { index: 7, name: 'OBSBOT', devicePath: 'path-b', modes: [mode(1920, 1080, 30), mode(1280, 720, 60000, 1001), mode(1280, 720, 120)] },
  { index: 9, name: 'Slow', devicePath: 'path-slow', modes: [mode(1920, 1080, 25)] },
];
Object.defineProperty(navigator, 'mediaDevices', { value: {
  getUserMedia: async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 320; canvas.height = 180;
    canvas.getContext('2d')!.fillRect(0, 0, 320, 180);
    return canvas.captureStream(10);
  },
  enumerateDevices: async () => native.map(camera => ({
    kind: 'videoinput', deviceId: `browser-${camera.index}`, label: camera.name,
  })),
} });
localStorage.clear();
localStorage.setItem('camera-config:path-slow', JSON.stringify({ selected: false }));
(window as any).irisStarter = { listCaptureCameras: async () => native };
createApp({ render: () => h(CameraSetupModal, { open: true,
  onContinue: cameras => { (window as any).testCameraConfig = cameras; },
}) }).mount('#app');
