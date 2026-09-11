<script setup lang="ts">
import { computed } from "vue";
import {
  closestPlaybackRateIndex,
  playbackRateLabel,
  playbackRateSteps,
} from "./playbackRate";

const props = defineProps<{ value: number }>();
const emit = defineEmits<{ select: [value: number] }>();

const sliderIndex = computed(() => closestPlaybackRateIndex(props.value));

function select(event: Event): void {
  const index = Number((event.target as HTMLInputElement).value);
  emit("select", playbackRateSteps[index] ?? 1);
}
</script>

<template>
  <div class="speed-control">
    <div class="speed-heading">
      <span>Speed</span>
      <output>{{ playbackRateLabel(value) }}</output>
    </div>
    <input
      class="speed-slider"
      type="range"
      min="0"
      :max="playbackRateSteps.length - 1"
      step="1"
      :value="sliderIndex"
      aria-label="Playback speed"
      :aria-valuetext="playbackRateLabel(value)"
      @input="select"
    />
  </div>
</template>

<style scoped>
.speed-control {
  display: grid;
  gap: 0.85rem;
  min-width: 270px;
  padding: 0.85rem;
}

.speed-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  font-size: 0.82rem;
  font-weight: 700;
}

.speed-heading output {
  color: var(--accent, #ff6b5f);
  font-variant-numeric: tabular-nums;
}

.speed-slider {
  width: 100%;
  accent-color: var(--accent, #ff6b5f);
  cursor: pointer;
}
</style>
