<script setup lang="ts">
import { RotateCcw, RotateCw } from "@lucide/vue";

const props = defineProps<{
  direction: "backward" | "forward";
}>();

const emit = defineEmits<{
  activate: [];
}>();
</script>

<template>
  <button
    class="icon-button seek-button"
    :aria-label="direction === 'backward' ? 'Back 5 seconds' : 'Forward 5 seconds'"
    :title="direction === 'backward' ? 'Back 5 seconds' : 'Forward 5 seconds'"
    @click="emit('activate')"
  >
    <RotateCcw v-if="props.direction === 'backward'" aria-hidden="true" />
    <RotateCw v-else aria-hidden="true" />
    <span aria-hidden="true">5</span>
  </button>
</template>

<style scoped>
.seek-button {
  position: relative;
}

.seek-button svg {
  width: 23px;
  height: 23px;
}

.seek-button span {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  padding-top: 1px;
  font-size: 0.58rem;
  font-variant-numeric: tabular-nums;
  font-weight: 800;
}
</style>
