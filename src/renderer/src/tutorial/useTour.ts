import { computed, ref, watch, type Ref } from 'vue';
import { HAPPY_PATH_TOUR } from './steps';
import type { TourDefinition } from './types';

function storageKey(tourId: string): string {
  return tourId === HAPPY_PATH_TOUR.id ? 'starter-kit-tour-completed' : `starter-kit-tour-completed:${tourId}`;
}

function loadCompleted(tourId: string): boolean {
  try {
    return localStorage.getItem(storageKey(tourId)) === '1';
  } catch {
    return false;
  }
}

function saveCompleted(tourId: string): void {
  try {
    localStorage.setItem(storageKey(tourId), '1');
  } catch {
    // ignore storage failures
  }
}

// Module-level singleton: only one tour runs at a time. Starting one
// switches `activeTour`.
const activeTour = ref<TourDefinition>(HAPPY_PATH_TOUR);
const active = ref(false);
const stepIndex = ref(0);
const completed = ref(loadCompleted(HAPPY_PATH_TOUR.id));

const currentStep = computed(() => (active.value ? activeTour.value.steps[stepIndex.value] ?? null : null));
const isLastStep = computed(() => stepIndex.value >= activeTour.value.steps.length - 1);
const stepLabel = computed(() => `${stepIndex.value + 1} / ${activeTour.value.steps.length}`);

function start(tour: TourDefinition = HAPPY_PATH_TOUR): void {
  activeTour.value = tour;
  stepIndex.value = 0;
  active.value = true;
  completed.value = loadCompleted(tour.id);
}

function end(): void {
  active.value = false;
  completed.value = true;
  saveCompleted(activeTour.value.id);
}

function next(): void {
  if (isLastStep.value) {
    end();
    return;
  }
  stepIndex.value += 1;
}

function back(): void {
  if (stepIndex.value > 0) stepIndex.value -= 1;
}

function skip(): void {
  end();
}

function hasCompletedTour(tourId: string): boolean {
  return loadCompleted(tourId);
}

// Jumps to the first step matching a phase/state whenever it's entered.
// Generic so it works for AppPhase or a modal's own step union.
function syncToPhase<T extends string>(phase: Ref<T>): void {
  watch(phase, (newPhase) => {
    if (!active.value) return;
    const firstIndexForPhase = activeTour.value.steps.findIndex((step) => step.phase === newPhase);
    if (firstIndexForPhase >= 0) stepIndex.value = firstIndexForPhase;
  });
}

export function useTour() {
  return {
    active,
    currentStep,
    stepIndex,
    stepLabel,
    isLastStep,
    completed,
    start,
    next,
    back,
    skip,
    syncToPhase,
    hasCompletedTour,
  };
}
