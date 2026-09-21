<script setup lang="ts">
import { RotateCcw } from "@lucide/vue";
import type {
  VideoAdjustmentName,
  VideoAdjustments,
} from "./useVideoAdjustments";

const props = defineProps<{
  values: Readonly<VideoAdjustments>;
}>();

const emit = defineEmits<{
  change: [name: VideoAdjustmentName, value: number];
  reset: [];
}>();

const controls: Array<{
  name: VideoAdjustmentName;
  label: string;
  minimum: number;
  maximum: number;
  step: number;
  percentage: boolean;
}> = [
  {
    name: "brightness",
    label: "Brightness",
    minimum: 0.5,
    maximum: 1.5,
    step: 0.05,
    percentage: true,
  },
  {
    name: "contrast",
    label: "Contrast",
    minimum: 0.5,
    maximum: 1.5,
    step: 0.05,
    percentage: true,
  },
  {
    name: "saturation",
    label: "Saturation",
    minimum: 0,
    maximum: 2,
    step: 0.05,
    percentage: true,
  },
  {
    name: "gamma",
    label: "Gamma",
    minimum: 0.5,
    maximum: 2,
    step: 0.05,
    percentage: false,
  },
];

function change(name: VideoAdjustmentName, event: Event): void {
  emit("change", name, Number((event.target as HTMLInputElement).value));
}

function formattedValue(
  name: VideoAdjustmentName,
  percentage: boolean,
): string {
  const value = props.values[name];
  return percentage ? `${Math.round(value * 100)}%` : value.toFixed(2);
}
</script>

<template>
  <div class="adjustments-menu" role="group" aria-label="Video appearance">
    <label v-for="control in controls" :key="control.name" class="adjustment-row">
      <span>{{ control.label }}</span>
      <output>{{ formattedValue(control.name, control.percentage) }}</output>
      <input
        type="range"
        :min="control.minimum"
        :max="control.maximum"
        :step="control.step"
        :value="props.values[control.name]"
        :aria-label="control.label"
        :aria-valuetext="formattedValue(control.name, control.percentage)"
        @input="change(control.name, $event)"
      />
    </label>
    <button class="adjustments-reset" @click="emit('reset')">
      <RotateCcw aria-hidden="true" />
      Reset
    </button>
  </div>
</template>

<style scoped>
.adjustments-menu {
  display: grid;
  gap: 0.75rem;
  min-width: 290px;
  padding: 0.85rem;
}

.adjustment-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 0.35rem 1rem;
  color: #e7eaeb;
  font-size: 0.82rem;
  font-weight: 700;
}

.adjustment-row output {
  min-width: 3.25rem;
  color: var(--accent, #ff6b5f);
  font-variant-numeric: tabular-nums;
  text-align: right;
}

.adjustment-row input {
  grid-column: 1 / -1;
  width: 100%;
  margin: 0;
  accent-color: var(--accent, #ff6b5f);
  cursor: pointer;
}

.adjustments-reset {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.45rem;
  min-height: 38px;
  margin-top: 0.1rem;
  border: 0;
  border-radius: 7px;
  background: transparent;
  cursor: pointer;
}

.adjustments-reset:hover {
  background: #ffffff12;
}

.adjustments-reset svg {
  width: 16px;
  height: 16px;
}
</style>
