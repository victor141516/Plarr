<script setup lang="ts">
import { declaredLanguageLabel } from "./playerPresentation";
import type { PlayerTrack } from "./playerTypes";

defineProps<{
  kind: "audio" | "subtitles";
  tracks: PlayerTrack[];
  selected?: number;
}>();

const emit = defineEmits<{
  select: [index: number | undefined];
}>();
</script>

<template>
  <div class="track-options">
    <button
      v-if="kind === 'subtitles'"
      :class="{ selected: selected === undefined }"
      @click="emit('select', undefined)"
    >
      Off
    </button>
    <button
      v-for="track in tracks"
      :key="track.index"
      :class="{ selected: selected === track.index }"
      @click="emit('select', track.index)"
    >
      {{ track.name }}
      <small>
        Language: {{ declaredLanguageLabel(track.language) }}<template
          v-if="kind === 'audio'"
        >
          · Codec: {{ track.codec_name.toUpperCase() }}</template
        >
      </small>
    </button>
  </div>
</template>
