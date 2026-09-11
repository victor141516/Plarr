<script setup lang="ts">
import { Check, Copy, X } from "@lucide/vue";
import type { DiagnosticSection } from "./playbackDiagnostics";

defineProps<{
  sections: DiagnosticSection[];
  copied: boolean;
}>();

defineEmits<{
  close: [];
  copy: [];
}>();
</script>

<template>
  <aside
    class="diagnostics-panel"
    role="dialog"
    aria-labelledby="diagnostics-title"
    @mousemove.stop
    @touchstart.stop
    @click.stop
  >
    <div class="diagnostics-heading">
      <div>
        <small>PLAYBACK</small>
        <h2 id="diagnostics-title">Advanced information</h2>
      </div>
      <button
        class="icon-button"
        aria-label="Close advanced information"
        title="Close"
        @click="$emit('close')"
      >
        <X />
      </button>
    </div>
    <div class="diagnostics-content">
      <section
        v-for="section in sections"
        :key="section.title"
        class="diagnostics-section"
      >
        <h3>{{ section.title }}</h3>
        <dl>
          <div v-for="row in section.rows" :key="row.label">
            <dt>{{ row.label }}</dt>
            <dd>{{ row.value }}</dd>
          </div>
        </dl>
      </section>
    </div>
    <button class="copy-diagnostics" @click="$emit('copy')">
      <Check v-if="copied" /><Copy v-else />
      {{ copied ? "Copied" : "Copy information" }}
    </button>
    <span class="sr-only" aria-live="polite">
      {{ copied ? "Playback information copied" : "" }}
    </span>
  </aside>
</template>
