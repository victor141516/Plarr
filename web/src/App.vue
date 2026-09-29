<script setup lang="ts">
import { onBeforeUnmount, shallowRef } from "vue";
import { ArrowLeft, Check, Link2, Play } from "@lucide/vue";
import PlaybackDiagnosticsPanel from "./PlaybackDiagnosticsPanel.vue";
import PlayerControls from "./PlayerControls.vue";
import MobileSeekHint from "./MobileSeekHint.vue";
import VideoGammaFilter from "./VideoGammaFilter.vue";
import { usePlarrPlayer } from "./usePlarrPlayer";
import { watchPartyShareURL } from "./watchPartyShareURL";

const shareCopied = shallowRef(false);
let copyResetTimer: number | undefined;
async function copyWatchPartyLink() {
  const link = watchPartyShareURL(location.href);
  try {
    await navigator.clipboard.writeText(link);
    shareCopied.value = true;
    if (copyResetTimer !== undefined) window.clearTimeout(copyResetTimer);
    copyResetTimer = window.setTimeout(() => { shareCopied.value = false; }, 2500);
  } catch {
    window.prompt("Watch party link", link);
  }
}
onBeforeUnmount(() => {
  if (copyResetTimer !== undefined) window.clearTimeout(copyResetTimer);
});

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
  videoAdjustments,
  videoAppearanceAdjusted,
  gammaExponent,
  videoGammaFilterId,
  setVideoAdjustment,
  resetVideoAdjustments,
  timelinePreviewURL,
  previewTimeline,
  clearTimelinePreview,
  hasPrevious,
  hasNext,
  castAvailable,
  castConnected,
  castDeviceName,
  requestCast,
  watchParty,
  watchPartyActive,
  roomNeedsGesture,
} = usePlarrPlayer();
</script>

<template>
  <main class="player" @mousemove="reveal" @touchstart="reveal">
    <VideoGammaFilter
      :filter-id="videoGammaFilterId"
      :exponent="gammaExponent"
    />
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
          :autoplay="!watchPartyActive"
          playsinline
        />
      </div>
    </div>
    <MobileSeekHint
      :direction="mobileSeekDirection"
      :seconds="mobileSeekSeconds"
    />
    <div v-if="loading && !roomNeedsGesture" class="loading">
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
      <span v-if="watchPartyActive" class="watch-party-status" role="status">
        {{ watchParty.error.value || `Watch party · ${watchParty.participants.value}` }}
        <template v-if="watchParty.buffering.value"> · Buffering {{ watchParty.buffering.value }}</template>
      </span>
      <button
        v-if="watchPartyActive"
        class="icon-button"
        :aria-label="shareCopied ? 'Link copied' : 'Copy watch party link'"
        :title="shareCopied ? 'Link copied' : 'Copy watch party link'"
        @click="copyWatchPartyLink"
      >
        <Check v-if="shareCopied" />
        <Link2 v-else />
      </button>
    </header>

    <button
      v-if="!playing && !fatal && (!loading || roomNeedsGesture)"
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
      :video-adjustments="videoAdjustments"
      :video-appearance-adjusted="videoAppearanceAdjusted"
      :has-previous="hasPrevious"
      :has-next="hasNext"
      :cast-available="castAvailable && !watchPartyActive"
      :cast-connected="castConnected"
      :cast-device-name="castDeviceName"
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
      @set-video-adjustment="setVideoAdjustment"
      @reset-video-adjustments="resetVideoAdjustments"
      @timeline-preview="previewTimeline"
      @clear-timeline-preview="clearTimelinePreview"
      @cast="requestCast"
    />
  </main>
</template>
