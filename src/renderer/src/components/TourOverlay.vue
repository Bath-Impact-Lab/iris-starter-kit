<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { useTour } from '../tutorial/useTour';

const { active, currentStep, stepLabel, stepIndex, isLastStep, next, back, skip } = useTour();

const targetRect = ref<DOMRect | null>(null);
let targetEl: HTMLElement | null = null;
let resizeObserver: ResizeObserver | null = null;
let attachTries = 0;
let attachTimer: ReturnType<typeof setTimeout> | null = null;

function measure(): void {
  targetRect.value = targetEl ? targetEl.getBoundingClientRect() : null;
}

function detach(): void {
  if (attachTimer) {
    clearTimeout(attachTimer);
    attachTimer = null;
  }
  resizeObserver?.disconnect();
  resizeObserver = null;
  targetEl = null;
  targetRect.value = null;
  window.removeEventListener('resize', measure);
  window.removeEventListener('scroll', measure, true);
}

// The step's target may not be mounted yet right after a phase transition
// (e.g. LiveView mounting just after calibration completes) -- retry briefly.
function attach(selector: string | undefined): void {
  detach();
  if (!selector) return;

  attachTries = 0;
  const tryFind = () => {
    const el = document.querySelector(selector) as HTMLElement | null;
    if (el) {
      targetEl = el;
      measure();
      resizeObserver = new ResizeObserver(measure);
      resizeObserver.observe(el);
      window.addEventListener('resize', measure);
      window.addEventListener('scroll', measure, true);
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      return;
    }
    if (attachTries++ < 20) attachTimer = setTimeout(tryFind, 100);
  };
  tryFind();
}

watch(
  () => currentStep.value?.id,
  async () => {
    detach();
    if (!currentStep.value) return;
    await nextTick();
    attach(currentStep.value.target);
  },
  { immediate: true },
);

onBeforeUnmount(detach);

const SPOTLIGHT_PAD = 6;

const spotlightStyle = computed(() => {
  const r = targetRect.value;
  if (!r) return {};
  return {
    top: `${r.top - SPOTLIGHT_PAD}px`,
    left: `${r.left - SPOTLIGHT_PAD}px`,
    width: `${r.width + SPOTLIGHT_PAD * 2}px`,
    height: `${r.height + SPOTLIGHT_PAD * 2}px`,
  };
});

const BUBBLE_GAP = 16;
const BUBBLE_WIDTH = 300;

const bubbleStyle = computed(() => {
  const r = targetRect.value;
  if (!r) {
    return { top: '50%', left: '50%', transform: 'translate(-50%, -50%)' };
  }

  const position = currentStep.value?.position ?? 'bottom';
  const clampLeft = (left: number) => Math.min(Math.max(left, 8), window.innerWidth - BUBBLE_WIDTH - 8);

  switch (position) {
    case 'top':
      return { left: `${clampLeft(r.left)}px`, top: `${r.top - BUBBLE_GAP}px`, transform: 'translateY(-100%)' };
    case 'left':
      return { left: `${r.left - BUBBLE_GAP}px`, top: `${r.top}px`, transform: 'translateX(-100%)' };
    case 'right':
      return { left: `${clampLeft(r.right + BUBBLE_GAP)}px`, top: `${r.top}px` };
    case 'bottom':
    default:
      return { left: `${clampLeft(r.left)}px`, top: `${r.bottom + BUBBLE_GAP}px` };
  }
});
</script>

<template>
  <Teleport to="body">
    <div v-if="active && currentStep" class="tour-root">
      <div v-if="targetRect" class="tour-spotlight" :style="spotlightStyle" />
      <div v-else class="tour-backdrop" />

      <div class="tour-bubble" :style="bubbleStyle">
        <div class="tour-step-label">{{ stepLabel }}</div>
        <h4 class="tour-title">{{ currentStep.title }}</h4>
        <p class="tour-text">{{ currentStep.text }}</p>
        <p v-if="currentStep.autoAdvance" class="tour-hint">Waiting for you to do that…</p>
        <div class="tour-nav">
          <button type="button" class="btn ghost" @click="skip">Skip</button>
          <div class="tour-nav-right">
            <button v-if="stepIndex > 0" type="button" class="btn ghost" @click="back">Back</button>
            <button v-if="!currentStep.autoAdvance" type="button" class="btn primary" @click="next">
              {{ isLastStep ? 'Done' : 'Next' }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.tour-root {
  position: fixed;
  inset: 0;
  z-index: 500;
  pointer-events: none;
}

.tour-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(6, 8, 12, 0.65);
}

.tour-spotlight {
  position: fixed;
  border-radius: 10px;
  box-shadow:
    0 0 0 3px #3b6fd9,
    0 0 0 9999px rgba(6, 8, 12, 0.65);
  transition: top 0.15s ease, left 0.15s ease, width 0.15s ease, height 0.15s ease;
}

.tour-bubble {
  position: fixed;
  width: 300px;
  background: #161b24;
  border: 1px solid #2a3140;
  border-radius: 12px;
  padding: 16px;
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.45);
  pointer-events: auto;
}

.tour-hint {
  margin: -6px 0 14px;
  font-size: 12px;
  font-style: italic;
  color: #8b93a7;
}

.tour-step-label {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: #8b93a7;
  margin-bottom: 6px;
}

.tour-title {
  margin: 0 0 6px;
  font-size: 15px;
  color: #f3f7ff;
}

.tour-text {
  margin: 0 0 14px;
  font-size: 13px;
  line-height: 1.4;
  color: #c7d2e3;
}

.tour-nav {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.tour-nav-right {
  display: flex;
  gap: 8px;
}

.btn {
  border-radius: 8px;
  border: 1px solid #2a3140;
  background: #1e2430;
  color: #e8eaed;
  padding: 8px 14px;
  font-size: 13px;
  cursor: pointer;
}

.btn.ghost {
  background: transparent;
  border-color: #384164;
}

.btn.primary {
  background: #3b6fd9;
  border-color: #3b6fd9;
}

.btn.primary:hover,
.btn.ghost:hover {
  background: #314a7c;
}
</style>
