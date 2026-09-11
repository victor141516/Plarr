<script setup lang="ts">
import { ArrowLeft, Play } from "@lucide/vue";
import PlaybackDiagnosticsPanel from "./PlaybackDiagnosticsPanel.vue";
import PlayerControls from "./PlayerControls.vue";
import MobileSeekHint from "./MobileSeekHint.vue";
import { usePlarrPlayer } from "./usePlarrPlayer";

const {
  video,
  loading,
  fatal,
  controls,
  close,
  displayTitle,
  playing,
  toggle,
  diagnosticsOpen,
  diagnosticSections,
  diagnosticsCopied,
  closeDiagnostics,
  copyDiagnostics,
  menu,
  current,
  duration,
  bufferedSeconds,
  bufferedRangeStyles,
  playedPercent,
  muted,
  volume,
  audioTracks,
  audio,
  subtitleTracks,
  subtitle,
  quality,
  manualLevel,
  originalDescription,
  originalAvailable,
  originalUnavailableReason,
  availableLevels,
  sourceHDR,
  deliveryColor,
  colorPreference,
  hdrDeliverySupported,
  previewSeekEvent,
  commitSeekEvent,
  emit,
  toggleMute,
  changeVolume,
  selectAudio,
  selectSubtitle,
  selectQuality,
  selectColorMode,
  toggleDiagnostics,
  pip,
  fullscreen,
  reveal,
  beginSurfacePress,
  cancelSurfacePress,
  endSurfacePress,
  surfaceClick,
  playbackRate,
  mobileSeekDirection,
  mobileSeekSeconds,
  setPlaybackRate,
  seekRelative,
  videoFrameCrop,
  videoFrameStyle,
  videoContentStyle,
  adjustVideoFrame,
  resetVideoFrame,
  timelinePreviewURL,
  previewTimeline,
  clearTimelinePreview,
} = usePlarrPlayer();
</script>

<template>
  <main class="player" @mousemove="reveal" @touchstart="reveal">
    <div
      class="video-surface"
      @pointerdown="beginSurfacePress"
      @pointerup="endSurfacePress"
      @pointercancel="cancelSurfacePress"
      @click="surfaceClick"
    >
      <div class="video-frame" :style="videoFrameStyle">
        <video
          ref="video"
          :style="videoContentStyle"
          autoplay
          playsinline
        />
      </div>
    </div>
    <MobileSeekHint
      :direction="mobileSeekDirection"
      :seconds="mobileSeekSeconds"
    />
    <div v-if="loading" class="loading">
      <span />
      <p>Preparing your film…</p>
    </div>
    <div v-if="fatal" class="fatal">
      <div class="logo">P</div>
      <h1>Playback unavailable</h1>
      <p>{{ fatal }}</p>
    </div>

    <header :class="{ hidden: !controls }">
      <button class="icon-button" aria-label="Back" title="Back" @click="close">
        <ArrowLeft />
      </button>
      <b>{{ displayTitle }}</b>
    </header>

    <button
      v-if="!playing && !fatal && !loading"
      class="big-play"
      aria-label="Play"
      title="Play"
      @click="toggle"
    >
      <Play />
    </button>

    <PlaybackDiagnosticsPanel
      v-if="diagnosticsOpen"
      :sections="diagnosticSections"
      :copied="diagnosticsCopied"
      @close="closeDiagnostics"
      @copy="copyDiagnostics"
    />

    <PlayerControls
      v-model:menu="menu"
      :visible="controls"
      :current="current"
      :duration="duration"
      :buffered-seconds="bufferedSeconds"
      :buffered-range-styles="bufferedRangeStyles"
      :played-percent="playedPercent"
      :playing="playing"
      :muted="muted"
      :volume="volume"
      :audio-tracks="audioTracks"
      :audio="audio"
      :subtitle-tracks="subtitleTracks"
      :subtitle="subtitle"
      :quality="quality"
      :manual-level="manualLevel"
      :original-description="originalDescription"
      :original-available="originalAvailable"
      :original-unavailable-reason="originalUnavailableReason"
      :available-levels="availableLevels"
      :diagnostics-open="diagnosticsOpen"
      :source-h-d-r="sourceHDR"
      :delivery-color="deliveryColor"
      :color-preference="colorPreference"
      :hdr-supported="hdrDeliverySupported"
      :playback-rate="playbackRate"
      :timeline-preview-u-r-l="timelinePreviewURL"
      :video-frame-crop="videoFrameCrop"
      @preview-seek="previewSeekEvent"
      @commit-seek="commitSeekEvent"
      @previous="emit('previous-requested')"
      @toggle-playback="toggle"
      @next="emit('next-requested')"
      @seek-by="seekRelative"
      @toggle-mute="toggleMute"
      @volume-input="changeVolume"
      @select-audio="selectAudio"
      @select-subtitle="selectSubtitle"
      @select-quality="selectQuality"
      @select-color-mode="selectColorMode"
      @toggle-diagnostics="toggleDiagnostics"
      @picture-in-picture="pip"
      @fullscreen="fullscreen"
      @select-playback-rate="setPlaybackRate"
      @adjust-video-frame="adjustVideoFrame"
      @reset-video-frame="resetVideoFrame"
      @timeline-preview="previewTimeline"
      @clear-timeline-preview="clearTimelinePreview"
    />
  </main>
</template>
