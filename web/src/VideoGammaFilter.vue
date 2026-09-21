<script setup lang="ts">
defineProps<{
  filterId: string;
  exponent: number;
}>();
</script>

<template>
  <svg
    class="video-gamma-filter"
    width="0"
    height="0"
    aria-hidden="true"
    focusable="false"
  >
    <defs>
      <filter
        :id="filterId"
        x="0"
        y="0"
        width="1"
        height="1"
        color-interpolation-filters="sRGB"
      >
        <feComponentTransfer>
          <feFuncR type="gamma" amplitude="1" :exponent="exponent" offset="0" />
          <feFuncG type="gamma" amplitude="1" :exponent="exponent" offset="0" />
          <feFuncB type="gamma" amplitude="1" :exponent="exponent" offset="0" />
        </feComponentTransfer>
      </filter>
    </defs>
  </svg>
</template>

<style scoped>
.video-gamma-filter {
  position: fixed;
  overflow: hidden;
  pointer-events: none;
}
</style>
