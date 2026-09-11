import { computed, ref, watch, type Ref } from 'vue';
import type { AppPhase } from '../types';
import { HAPPY_PATH_TOUR } from './steps';

const STORAGE_KEY = 'starter-kit-tour-completed';

function loadCompleted(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function saveCompleted(): void {
  try {
    localStorage.setItem(STORAGE_KEY, '1');
  } catch {
    // ignore storage failures
  }
}

// Module-level (singleton) state -- there's only ever one tour running in this
// single-window app, matching the rest of the app's plain-ref state (no store lib).
const active = ref(false);
const stepIndex = ref(0);
const completed = ref(loadCompleted());

const currentStep = computed(() => (active.value ? HAPPY_PATH_TOUR[stepIndex.value] ?? null : null));
const isLastStep = computed(() => stepIndex.value >= HAPPY_PATH_TOUR.length - 1);
const stepLabel = computed(() => `${stepIndex.value + 1} / ${HAPPY_PATH_TOUR.length}`);

function start(): void {
  stepIndex.value = 0;
  active.value = true;
}

function end(): void {
  active.value = false;
  completed.value = true;
  saveCompleted();
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

// Jump to the first step belonging to a phase whenever the app enters it, so the
// tour tracks the app's own phase transitions instead of the user having to
// click through phases blind (e.g. calibration finishing on its own).
function syncToPhase(phase: Ref<AppPhase>): void {
  watch(phase, (newPhase) => {
    if (!active.value) return;
    const firstIndexForPhase = HAPPY_PATH_TOUR.findIndex((step) => step.phase === newPhase);
    if (firstIndexForPhase >= 0) stepIndex.value = firstIndexForPhase;
  });
}

export function useTour() {
  return { active, currentStep, stepIndex, stepLabel, isLastStep, completed, start, next, back, skip, syncToPhase };
}
