<script setup lang="ts">
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Minus,
  Plus,
  RectangleHorizontal,
  RotateCcw,
} from "@lucide/vue";
import type { Component } from "vue";
import type { VideoFrameCrop, VideoFrameSide } from "./useVideoFraming";

const props = defineProps<{
  crop: Readonly<VideoFrameCrop>;
}>();

const emit = defineEmits<{
  adjust: [side: VideoFrameSide, delta: number];
  reset: [];
}>();

const sides: Array<{
  side: VideoFrameSide;
  label: string;
  icon: Component;
}> = [
  { side: "top", label: "Top", icon: ArrowUp },
  { side: "bottom", label: "Bottom", icon: ArrowDown },
  { side: "left", label: "Left", icon: ArrowLeft },
  { side: "right", label: "Right", icon: ArrowRight },
];
</script>

<template>
  <div class="framing-menu" role="group" aria-label="Video framing">
    <div v-for="item in sides" :key="item.side" class="framing-row">
      <div class="framing-side" :title="item.label" aria-hidden="true">
        <RectangleHorizontal class="framing-screen" />
        <component :is="item.icon" class="framing-arrow" />
      </div>
      <span class="sr-only">{{ item.label }}</span>
      <button
        class="framing-step"
        :aria-label="`Show more from the ${item.label.toLowerCase()}`"
        :disabled="props.crop[item.side] <= 0"
        @click="emit('adjust', item.side, -1)"
      >
        <Minus aria-hidden="true" />
      </button>
      <output :aria-label="`${item.label} crop`">{{ props.crop[item.side] }}%</output>
      <button
        class="framing-step"
        :aria-label="`Crop more from the ${item.label.toLowerCase()}`"
        :disabled="props.crop[item.side] >= 40"
        @click="emit('adjust', item.side, 1)"
      >
        <Plus aria-hidden="true" />
      </button>
    </div>
    <button class="framing-reset" @click="emit('reset')">
      <RotateCcw aria-hidden="true" />
      Reset
    </button>
  </div>
</template>

<style scoped>
.framing-menu {
  display: grid;
  min-width: 270px;
  padding: 0.45rem;
}

.framing-row {
  display: grid;
  grid-template-columns: 42px 38px 52px 38px;
  align-items: center;
  justify-content: space-between;
  min-height: 48px;
  border-bottom: 1px solid #30383e;
}

.framing-side {
  position: relative;
  display: grid;
  place-items: center;
  width: 36px;
  height: 32px;
}

.framing-screen {
  width: 30px;
  height: 22px;
  color: #aeb6ba;
}

.framing-arrow {
  position: absolute;
  width: 14px;
  height: 14px;
  padding: 1px;
  border-radius: 50%;
  background: #14181b;
  color: #ff7b70;
  stroke-width: 2.7;
}

.framing-step {
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  padding: 0;
  border: 0;
  border-radius: 7px;
  background: #252c30;
  cursor: pointer;
}

.framing-step:hover:not(:disabled) {
  background: #343d42;
}

.framing-step:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}

.framing-step svg {
  width: 17px;
  height: 17px;
}

.framing-row output {
  color: #d7dcde;
  font-size: 0.78rem;
  font-variant-numeric: tabular-nums;
  text-align: center;
}

.framing-reset {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.45rem;
  min-height: 38px;
  margin-top: 0.45rem;
  border: 0;
  border-radius: 7px;
  background: transparent;
  cursor: pointer;
}

.framing-reset:hover {
  background: #ffffff12;
}

.framing-reset svg {
  width: 16px;
  height: 16px;
}
</style>
