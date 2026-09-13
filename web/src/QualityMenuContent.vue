<script setup lang="ts">
import ColorModeSelector from "./ColorModeSelector.vue";
import type { ColorPreference } from "./mediaCapabilities";
import type { QualityLevel } from "./playerTypes";

defineProps<{
  manualLevel: number;
  originalDescription: string;
  originalAvailable: boolean;
  originalUnavailableReason: string;
  availableLevels: QualityLevel[];
  sourceHDR: boolean;
  colorPreference: ColorPreference;
  hdrSupported: boolean;
}>();

const emit = defineEmits<{
  selectQuality: [quality: string];
  selectColorMode: [mode: ColorPreference];
}>();
</script>

<template>
  <div :class="['quality-menu-content', { 'has-hdr': sourceHDR }]">
    <div v-if="sourceHDR" class="quality-popover-header">
      <ColorModeSelector
        :value="colorPreference"
        :hdr-supported="hdrSupported"
        @select="emit('selectColorMode', $event)"
      />
    </div>
    <div class="quality-options">
      <button
        :class="{ selected: manualLevel === -1 }"
        aria-label="Automatic quality"
        @click="emit('selectQuality', 'Auto')"
      >
        Auto
      </button>
      <button
        :class="{ selected: manualLevel === -2 }"
        aria-label="Original quality"
        :disabled="!originalAvailable"
        :title="originalAvailable ? originalDescription : originalUnavailableReason"
        @click="emit('selectQuality', 'Original')"
      >
        Original
      </button>
      <button
        v-for="(level, index) in availableLevels"
        :key="index"
        :class="{ selected: manualLevel === index }"
        :aria-label="`${level.height}p quality`"
        @click="emit('selectQuality', String(index))"
      >
        {{ level.height }}p
      </button>
    </div>
  </div>
</template>
