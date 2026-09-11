import type { TourStep } from './types';

// The happy-path tour: camera setup -> calibration -> live view. Linear, no
// branches -- each step names the phase it belongs to so the tour can follow
// the app there automatically (see useTour's syncToPhase).
export const HAPPY_PATH_TOUR: TourStep[] = [
  {
    id: 'welcome',
    phase: 'camera-setup',
    title: 'Welcome to IRIS Starter Kit',
    text: "Quick tour: pick your cameras, run calibration, then watch live mocap. Takes about a minute.",
  },
  {
    id: 'camera-list',
    phase: 'camera-setup',
    target: '[data-tour="camera-list"]',
    position: 'bottom',
    title: 'Your cameras',
    text: 'IRIS detected these cameras. Uncheck any stale or unwanted entries before continuing.',
  },
  {
    id: 'camera-config',
    phase: 'camera-setup',
    target: '[data-tour="camera-config"]',
    position: 'bottom',
    title: 'Per-camera settings',
    text: 'Set resolution, frame rate, and rotation for each camera here.',
  },
  {
    id: 'continue-setup',
    phase: 'camera-setup',
    target: '[data-tour="continue-setup"]',
    position: 'top',
    title: "You're set",
    text: 'Click Continue below to start calibration with the selected cameras.',
    autoAdvance: true,
  },
  {
    id: 'calibration',
    phase: 'calibration',
    target: '[data-tour="calibrate-button"]',
    position: 'top',
    title: 'Calibrate',
    text: 'Click Calibrate to auto-calibrate the stage from your camera views. Keep the capture area clear.',
    autoAdvance: true,
  },
  {
    id: 'live-mocap',
    phase: 'live',
    target: '[data-tour="live-mocap"]',
    position: 'right',
    title: 'Live mocap',
    text: "That's your live 3D skeleton, streamed straight from IRIS.",
  },
  {
    id: 'live-settings',
    phase: 'live',
    target: '[data-tour="live-settings"]',
    position: 'left',
    title: 'Live settings',
    text: 'Watch FPS/joint tracking here, and adjust skeleton scale and bone thickness to taste.',
  },
  {
    id: 'done',
    phase: 'live',
    title: "That's it",
    text: 'Reopen this tour anytime from the settings gear.',
  },
];
