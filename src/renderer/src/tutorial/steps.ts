import type { TourDefinition, TourStep } from './types';

// The happy-path tour: camera setup -> calibration -> live view. Linear, no
// branches -- each step names the phase it belongs to so the tour can follow
// the app there automatically (see useTour's syncToPhase).
const HAPPY_PATH_STEPS: TourStep[] = [
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
    text: 'Watch FPS/joint tracking here, and adjust skeleton and DA3 display scale and bone thickness to taste.',
  },
  {
    id: 'done',
    phase: 'live',
    title: "That's it",
    text: 'Reopen this tour anytime from the settings gear.',
  },
];

export const HAPPY_PATH_TOUR: TourDefinition = { id: 'happy-path', steps: HAPPY_PATH_STEPS };

// Scoped to RigCalibrationModal's own step values, not AppPhase, since the
// modal opens as an overlay without the app changing phase. No 'failed'
// step; the modal's own error text covers it (see useTour.skip() there).
const RIG_CALIBRATION_STEPS: TourStep[] = [
  {
    id: 'rig-intro',
    phase: 'setup',
    title: 'ArUco rig calibration',
    text: "This calibrates your cameras to real-world units using a printed marker, instead of the automatic (but relative-scale-only) calibration. If it can't get a clean reading, it safely falls back to standard auto-calibration so calibration still completes.",
  },
  {
    id: 'rig-howto',
    phase: 'setup',
    target: '[data-tour="rig-howto"]',
    position: 'bottom',
    title: 'Print the marker',
    text: 'Print a DICT_6X6_250 ArUco marker at a precisely known size, then follow these steps for how to hold it during recording.',
  },
  {
    id: 'rig-marker-fields',
    phase: 'setup',
    target: '[data-tour="rig-marker-fields"]',
    position: 'bottom',
    title: 'Marker size & ID',
    text: "Enter the marker's actual printed size (measure it, this defines your real-world scale) and its ID.",
  },
  {
    id: 'rig-start',
    phase: 'setup',
    target: '[data-tour="rig-start"]',
    position: 'top',
    title: 'Start recording',
    text: 'Click Start recording once your marker is printed and ready.',
    autoAdvance: true,
  },
  {
    id: 'rig-feeds',
    phase: 'recording',
    target: '[data-tour="rig-camera-grid"]',
    position: 'top',
    title: 'Watch both feeds',
    text: 'Hold the marker completely still for 3+ seconds at a time, somewhere visible in every feed here, at a few different positions.',
  },
  {
    id: 'rig-stop',
    phase: 'recording',
    target: '[data-tour="rig-stop"]',
    position: 'top',
    title: 'Stop & calibrate',
    text: "Click this once you've held the marker still at a few good positions.",
    autoAdvance: true,
  },
  {
    id: 'rig-calibrating',
    phase: 'calibrating',
    title: 'Calibrating…',
    text: 'Running ArUco detection, then falling back to standard auto-calibration if needed. Only takes a few seconds.',
  },
  {
    id: 'rig-done',
    phase: 'ready',
    target: '[data-tour="rig-stats"]',
    position: 'top',
    title: 'Result',
    text: "This calibration is now published, and used automatically the next time you start a run with this exact camera setup.",
  },
];

export const RIG_CALIBRATION_TOUR: TourDefinition = { id: 'rig-calibration', steps: RIG_CALIBRATION_STEPS };
