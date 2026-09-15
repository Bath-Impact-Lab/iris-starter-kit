export type TourPosition = 'top' | 'bottom' | 'left' | 'right';

export interface TourStep {
  id: string;
  // The state this step belongs to (AppPhase for the main tour, or a
  // modal's own step values for a scoped tour like RIG_CALIBRATION_TOUR).
  phase: string;
  // CSS selector of the element to spotlight; omit for a centered info card.
  target?: string;
  title: string;
  text: string;
  // Bubble position relative to `target`. Ignored when there's no target.
  position?: TourPosition;
  // True when a real action drives the step forward; hides the Next
  // button so it only advances via useTour's syncToPhase.
  autoAdvance?: boolean;
}

// A named, independently-completable sequence of steps. `id` keys each
// one's own "has the user seen this" localStorage flag.
export interface TourDefinition {
  id: string;
  steps: TourStep[];
}
