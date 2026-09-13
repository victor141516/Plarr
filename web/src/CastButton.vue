<script setup lang="ts">
import { Cast } from "@lucide/vue";

defineProps<{
  connected: boolean;
  deviceName: string;
}>();

const emit = defineEmits<{
  activate: [];
}>();
</script>

<template>
  <button
    class="icon-button"
    :class="{ selected: connected }"
    :aria-label="connected ? `Casting to ${deviceName}` : 'Cast'"
    :title="connected ? `Casting to ${deviceName}` : 'Cast'"
    :aria-pressed="connected"
    @click="emit('activate')"
  >
    <Cast />
  </button>
</template>
