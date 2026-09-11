<script setup lang="ts">
import { computed, type CSSProperties, type Component } from "vue";
import { Sparkles, Sun, SunDim } from "@lucide/vue";
import type { ColorPreference } from "./mediaCapabilities";

const props = defineProps<{
  value: ColorPreference;
  hdrSupported: boolean;
}>();

const emit = defineEmits<{
  select: [value: ColorPreference];
}>();

const options: Array<{
  value: ColorPreference;
  label: string;
  icon: Component;
}> = [
  { value: "sdr", label: "HDR Off", icon: SunDim },
  { value: "auto", label: "HDR Auto", icon: Sparkles },
  { value: "hdr", label: "HDR On", icon: Sun },
];
const switchStyle = computed<CSSProperties>(() => ({
  "--switch-position": String(
    Math.max(
      0,
      options.findIndex((option) => option.value === props.value),
    ),
  ),
}));
</script>

<template>
  <div class="color-mode">
    <span class="color-mode-label">HDR</span>
    <div
      class="color-mode-switch"
      role="group"
      aria-label="HDR"
      :style="switchStyle"
    >
      <span class="color-mode-knob" aria-hidden="true" />
      <button
        v-for="option in options"
        :key="option.value"
        :class="{ selected: value === option.value }"
        :disabled="option.value === 'hdr' && !hdrSupported"
        :aria-label="option.label"
        :title="option.label"
        :aria-pressed="value === option.value"
        @click="emit('select', option.value)"
      >
        <component :is="option.icon" aria-hidden="true" />
      </button>
    </div>
  </div>
</template>

<style scoped>
.color-mode {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
}

.color-mode-label {
  font-size: 0.8rem;
  font-weight: 700;
  letter-spacing: 0.06em;
}

.color-mode-switch {
  position: relative;
  display: grid;
  grid-template-columns: repeat(3, 2.5rem);
  padding: 0.2rem;
  border: 1px solid #40474b;
  border-radius: 999px;
  background: #090c0e80;
}

.color-mode-knob {
  position: absolute;
  z-index: 0;
  top: 0.2rem;
  bottom: 0.2rem;
  left: 0.2rem;
  width: 2.5rem;
  border-radius: 999px;
  background: var(--accent, #ff6b5f);
  box-shadow: 0 2px 9px #0008;
  transform: translateX(calc(var(--switch-position) * 2.5rem));
  transition: transform 180ms ease;
}

.color-mode-switch button {
  position: relative;
  z-index: 1;
  display: grid;
  place-items: center;
  width: 2.5rem;
  height: 2rem;
  padding: 0;
  border: 0;
  border-radius: 999px;
  color: inherit;
  background: transparent;
  cursor: pointer;
}

.color-mode-switch button.selected {
  color: white;
}

.color-mode-switch button svg {
  width: 1rem;
  height: 1rem;
  stroke-width: 2.2;
}

.color-mode-switch button:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

@media (prefers-reduced-motion: reduce) {
  .color-mode-knob {
    transition: none;
  }
}
</style>
