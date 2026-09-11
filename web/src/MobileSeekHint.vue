<script setup lang="ts">
import { ChevronsLeft, ChevronsRight } from "@lucide/vue";
import type { MobileSeekDirection } from "./useMobileSeekGestures";

defineProps<{
  direction?: MobileSeekDirection;
  seconds: number;
}>();
</script>

<template>
  <Transition name="mobile-seek-hint">
    <div
      v-if="direction && seconds > 0"
      :class="['mobile-seek-hint', direction]"
      role="status"
      aria-live="polite"
    >
      <ChevronsLeft v-if="direction === 'backward'" aria-hidden="true" />
      <span>{{ direction === "forward" ? "+" : "−" }}{{ seconds }}s</span>
      <ChevronsRight v-if="direction === 'forward'" aria-hidden="true" />
    </div>
  </Transition>
</template>

<style scoped>
.mobile-seek-hint {
  position: absolute;
  z-index: 4;
  top: 50%;
  display: none;
  align-items: center;
  gap: 0.3rem;
  min-width: 82px;
  padding: 0.65rem 0.8rem;
  border-radius: 999px;
  background: #000b;
  box-shadow: 0 5px 22px #0009;
  font-size: 1rem;
  font-variant-numeric: tabular-nums;
  font-weight: 750;
  pointer-events: none;
  transform: translateY(-50%);
  backdrop-filter: blur(8px);
}

.mobile-seek-hint.backward {
  left: 8%;
  justify-content: flex-start;
}

.mobile-seek-hint.forward {
  right: 8%;
  justify-content: flex-end;
}

.mobile-seek-hint svg {
  width: 24px;
  height: 24px;
}

.mobile-seek-hint-enter-active,
.mobile-seek-hint-leave-active {
  transition:
    opacity 0.15s ease,
    scale 0.15s ease;
}

.mobile-seek-hint-enter-from,
.mobile-seek-hint-leave-to {
  opacity: 0;
  scale: 0.88;
}

@media (hover: none) and (pointer: coarse) {
  .mobile-seek-hint {
    display: flex;
  }
}
</style>
