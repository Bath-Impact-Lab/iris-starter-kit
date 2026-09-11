import type { AppPhase } from '../types';

export type TourPosition = 'top' | 'bottom' | 'left' | 'right';

export interface TourStep {
  id: string;
  // The app phase this step belongs to -- the tour jumps here when the app enters it.
  phase: AppPhase;
  // CSS selector of the element to spotlight; omit for a centered info card.
  target?: string;
  title: string;
  text: string;
  // Bubble position relative to `target`. Ignored when there's no target.
  position?: TourPosition;
  // True when this step maps to a real action (a button click, calibration finishing)
  // that itself drives the app's phase forward -- hides the Next button so the tour can
  // only advance by that real event actually happening, via useTour's syncToPhase.
  autoAdvance?: boolean;
}
