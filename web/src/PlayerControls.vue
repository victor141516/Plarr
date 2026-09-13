<script setup lang="ts">
import {
  computed,
  shallowRef,
  watch,
  type CSSProperties,
  type Component,
  useTemplateRef,
} from "vue";
import {
  AudioLines,
  Cast,
  Captions,
  Crop,
  Ellipsis,
  Gauge,
  Info,
  Maximize,
  Pause,
  PictureInPicture2,
  Play,
  Settings2,
  RotateCcw,
  RotateCw,
  SkipBack,
  SkipForward,
  Volume1,
  Volume2,
  VolumeX,
} from "@lucide/vue";
import { formatMediaTime } from "./playerPresentation";
import type { PlayerTrack, QualityLevel } from "./playerTypes";
import type { ColorPreference } from "./mediaCapabilities";
import PlaybackSpeedControl from "./PlaybackSpeedControl.vue";
import CastButton from "./CastButton.vue";
import PlayerOverflowMenu, { type OverflowAction } from "./PlayerOverflowMenu.vue";
import PlayerTrackOptions from "./PlayerTrackOptions.vue";
import QualityMenuContent from "./QualityMenuContent.vue";
import SeekButton from "./SeekButton.vue";
import VideoFramingMenu from "./VideoFramingMenu.vue";
import { playbackRateLabel } from "./playbackRate";
import { useEventListener } from "./useEventListener";
import {
  useResponsiveControls,
  type ResponsiveControlDefinition,
} from "./useResponsiveControls";
import type { VideoFrameCrop, VideoFrameSide } from "./useVideoFraming";

const props = defineProps<{
  visible: boolean;
  current: number;
  duration: number;
  bufferedSeconds: number;
  bufferedRangeStyles: CSSProperties[];
  playedPercent: number;
  playing: boolean;
  muted: boolean;
  volume: number;
  audioTracks: PlayerTrack[];
  audio?: number;
  subtitleTracks: PlayerTrack[];
  subtitle?: number;
  quality: string;
  manualLevel: number;
  originalDescription: string;
  originalAvailable: boolean;
  originalUnavailableReason: string;
  availableLevels: QualityLevel[];
  diagnosticsOpen: boolean;
  sourceHDR: boolean;
  deliveryColor: "hdr" | "sdr";
  colorPreference: ColorPreference;
  hdrSupported: boolean;
  playbackRate: number;
  timelinePreviewURL: string;
  videoFrameCrop: Readonly<VideoFrameCrop>;
  hasPrevious: boolean;
  hasNext: boolean;
  castAvailable: boolean;
  castConnected: boolean;
  castDeviceName: string;
}>();

const emit = defineEmits<{
  previewSeek: [event: Event];
  commitSeek: [event: Event];
  previous: [];
  togglePlayback: [];
  next: [];
  seekBy: [seconds: number];
  toggleMute: [];
  volumeInput: [event: Event];
  selectAudio: [index: number];
  selectSubtitle: [index: number | undefined];
  selectQuality: [quality: string];
  selectColorMode: [mode: ColorPreference];
  toggleDiagnostics: [];
  pictureInPicture: [];
  fullscreen: [];
  selectPlaybackRate: [rate: number];
  timelinePreview: [time: number];
  clearTimelinePreview: [];
  adjustVideoFrame: [side: VideoFrameSide, delta: number];
  resetVideoFrame: [];
  cast: [];
}>();

const menu = defineModel<string>("menu", { required: true });
const controlsRoot = useTemplateRef<HTMLElement>("controlsRoot");
const timelinePreviewLeft = shallowRef("0%");
const timelinePreviewTime = shallowRef(0);
const timelinePreviewVisible = shallowRef(false);
const volumeIcon = computed<Component>(() =>
  props.muted || props.volume === 0
    ? VolumeX
    : props.volume < 0.5
      ? Volume1
      : Volume2,
);
const qualityButtonResolution = computed(() => {
  if (!props.sourceHDR) return props.quality;
  return props.quality.includes("Original")
    ? "Original"
    : props.quality.match(/\d+p/i)?.[0] || props.quality;
});
const qualityButtonColor = computed(() =>
  props.sourceHDR ? props.deliveryColor.toUpperCase() : "",
);
const qualityButtonAccessibleLabel = computed(() =>
  qualityButtonColor.value
    ? `${qualityButtonResolution.value} ${qualityButtonColor.value}`
    : qualityButtonResolution.value,
);
const videoFrameAdjusted = computed(() =>
  Object.values(props.videoFrameCrop).some((value) => value !== 0),
);

const controlDefinitions = computed<ResponsiveControlDefinition[]>(() => [
  { id: "time", zone: "left", priority: 0, overflow: false },
  { id: "diagnostics", zone: "right", priority: 1, overflow: true },
  { id: "volume", zone: "left", priority: 2, overflow: true },
  { id: "pip", zone: "right", priority: 3, overflow: true },
  { id: "framing", zone: "right", priority: 4, overflow: true },
  { id: "speed", zone: "right", priority: 4, overflow: true },
  { id: "audio", zone: "right", priority: 5, overflow: true },
  { id: "subtitles", zone: "right", priority: 5, overflow: true },
  { id: "quality", zone: "right", priority: 6, overflow: true },
  { id: "fullscreen", zone: "right", priority: 6, overflow: true },
  ...(props.castAvailable
    ? [{ id: "cast", zone: "right", priority: 7, overflow: true } as const]
    : []),
  ...(props.hasPrevious
    ? [{ id: "previous", zone: "left", priority: 7, overflow: true } as const]
    : []),
  ...(props.hasNext
    ? [{ id: "next", zone: "left", priority: 7, overflow: true } as const]
    : []),
  { id: "seek-back", zone: "left", priority: 8, overflow: true },
  { id: "seek-forward", zone: "left", priority: 8, overflow: true },
  { id: "play", zone: "left", priority: 9, overflow: true },
]);
const {
  row: controlRow,
  hidden,
  hiddenOverflowIds,
  overflowing,
  isVisible,
} = useResponsiveControls(controlDefinitions);

const quickActions = computed<OverflowAction[]>(() => [
  ...(props.hasPrevious
    ? [{ id: "previous", label: "Previous episode", icon: SkipBack }]
    : []),
  { id: "seek-back", label: "Back 5 seconds", icon: RotateCcw },
  {
    id: "play",
    label: props.playing ? "Pause" : "Play",
    icon: props.playing ? Pause : Play,
    selected: props.playing,
  },
  { id: "seek-forward", label: "Forward 5 seconds", icon: RotateCw },
  ...(props.hasNext
    ? [{ id: "next", label: "Next episode", icon: SkipForward }]
    : []),
  { id: "pip", label: "Picture in picture", icon: PictureInPicture2 },
  { id: "fullscreen", label: "Fullscreen", icon: Maximize },
  ...(props.castAvailable
    ? [
        {
          id: "cast",
          label: props.castConnected
            ? `Casting to ${props.castDeviceName}`
            : "Cast",
          icon: Cast,
          selected: props.castConnected,
        },
      ]
    : []),
]);
const settingActions = computed<OverflowAction[]>(() => [
  { id: "audio", label: "Audio tracks", icon: AudioLines, submenu: true },
  { id: "subtitles", label: "Subtitles", icon: Captions, submenu: true },
  { id: "quality", label: "Quality", icon: Settings2, submenu: true },
  { id: "framing", label: "Video framing", icon: Crop, submenu: true },
  { id: "speed", label: "Playback speed", icon: Gauge, submenu: true },
  {
    id: "diagnostics",
    label: "Advanced playback information",
    icon: Info,
    selected: props.diagnosticsOpen,
  },
]);

function toggleMenu(name: string) {
  menu.value = menu.value === name ? "" : name;
}

function adjustVideoFrame(side: VideoFrameSide, delta: number): void {
  emit("adjustVideoFrame", side, delta);
}

function selectAudio(index: number | undefined): void {
  if (index !== undefined) emit("selectAudio", index);
}

function activateOverflow(id: string): void {
  if (id === "previous") emit("previous");
  if (id === "seek-back") emit("seekBy", -5);
  if (id === "play") emit("togglePlayback");
  if (id === "seek-forward") emit("seekBy", 5);
  if (id === "next") emit("next");
  if (id === "diagnostics") emit("toggleDiagnostics");
  if (id === "pip") emit("pictureInPicture");
  if (id === "fullscreen") emit("fullscreen");
  if (id === "cast") emit("cast");
  menu.value = "";
}

function previewTimeline(event: PointerEvent): void {
  if (!props.duration) return;
  const bounds = (event.currentTarget as HTMLElement).getBoundingClientRect();
  const ratio = Math.max(
    0,
    Math.min(1, (event.clientX - bounds.left) / Math.max(1, bounds.width)),
  );
  timelinePreviewLeft.value = `${ratio * 100}%`;
  timelinePreviewTime.value = ratio * props.duration;
  timelinePreviewVisible.value = true;
  emit("timelinePreview", timelinePreviewTime.value);
}

function clearTimelinePreview(): void {
  timelinePreviewVisible.value = false;
  emit("clearTimelinePreview");
}

watch(hidden, (next, previous) => {
  if (menu.value && menu.value !== "overflow" && next.has(menu.value)) {
    menu.value = "";
  }
  if (
    next.has("diagnostics") &&
    !previous.has("diagnostics") &&
    props.diagnosticsOpen
  ) {
    emit("toggleDiagnostics");
  }
});
watch(hiddenOverflowIds, (ids) => {
  if (menu.value === "overflow" && !ids.length) menu.value = "";
});

useEventListener<PointerEvent>(document, "pointerdown", (event) => {
  if (!menu.value) return;
  const openPopover = controlsRoot.value?.querySelector(
    `[data-player-menu="${menu.value}"]`,
  );
  if (openPopover?.contains(event.target as Node)) return;
  menu.value = "";
});
</script>

<template>
  <section ref="controlsRoot" :class="['controls', { hidden: !visible }]">
    <div
      class="timeline-shell"
      :title="`Buffered locally: ${formatMediaTime(bufferedSeconds)} ahead`"
      @pointermove="previewTimeline"
      @pointerleave="clearTimelinePreview"
    >
      <div
        v-if="timelinePreviewVisible"
        class="timeline-preview"
        :style="{ '--preview-left': timelinePreviewLeft }"
      >
        <div class="timeline-preview-media" aria-hidden="true">
          <img
            v-if="timelinePreviewURL"
            :src="timelinePreviewURL"
            alt=""
            width="142"
            height="80"
          />
        </div>
        <span>{{ formatMediaTime(timelinePreviewTime) }}</span>
      </div>
      <div class="timeline-rail" aria-hidden="true">
        <span
          v-for="(range, index) in bufferedRangeStyles"
          :key="index"
          class="timeline-buffered"
          :style="range"
        />
        <span class="timeline-played" :style="{ width: `${playedPercent}%` }" />
      </div>
      <input
        class="timeline"
        type="range"
        min="0"
        :max="duration || 0"
        step=".1"
        :value="current"
        aria-label="Playback position"
        :aria-valuetext="`${formatMediaTime(current)} of ${formatMediaTime(duration)}; ${formatMediaTime(bufferedSeconds)} buffered ahead`"
        @input="emit('previewSeek', $event)"
        @change="emit('commitSeek', $event)"
      />
    </div>

    <div ref="controlRow" :class="['control-row', { 'force-overflow': overflowing }]">
      <div class="control-zone control-zone-left">
        <button
          v-if="hasPrevious && isVisible('previous')"
          class="icon-button episode-navigation"
          data-control-id="previous"
          aria-label="Previous episode"
          title="Previous episode"
          @click="emit('previous')"
        >
          <SkipBack />
        </button>
        <SeekButton v-if="isVisible('seek-back')" data-control-id="seek-back" direction="backward" @activate="emit('seekBy', -5)" />
        <button
          v-if="isVisible('play')"
          class="icon-button"
          data-control-id="play"
          :aria-label="playing ? 'Pause' : 'Play'"
          :title="playing ? 'Pause' : 'Play'"
          @click="emit('togglePlayback')"
        >
          <Pause v-if="playing" /><Play v-else />
        </button>
        <SeekButton v-if="isVisible('seek-forward')" data-control-id="seek-forward" direction="forward" @activate="emit('seekBy', 5)" />
        <button
          v-if="hasNext && isVisible('next')"
          class="icon-button episode-navigation"
          data-control-id="next"
          aria-label="Next episode"
          title="Next episode"
          @click="emit('next')"
        >
          <SkipForward />
        </button>
        <span v-if="isVisible('time')" class="time" data-control-id="time">
          {{ formatMediaTime(current) }} / {{ formatMediaTime(duration) }}
        </span>
        <div v-if="isVisible('volume')" class="volume-control" data-control-id="volume">
          <button
            class="icon-button"
            :aria-label="muted || volume === 0 ? 'Unmute' : 'Mute'"
            :title="muted || volume === 0 ? 'Unmute' : 'Mute'"
            @click="emit('toggleMute')"
          >
            <component :is="volumeIcon" />
          </button>
          <input
            class="volume-slider"
            type="range"
            min="0"
            max="1"
            step=".01"
            :value="volume"
            aria-label="Volume"
            @input="emit('volumeInput', $event)"
          />
        </div>
      </div>

      <div class="control-zone control-zone-right">
        <CastButton
          v-if="castAvailable && isVisible('cast')"
          data-control-id="cast"
          :connected="castConnected"
          :device-name="castDeviceName"
          @activate="emit('cast')"
        />
        <div v-if="isVisible('audio')" class="popover-wrap" data-control-id="audio" data-player-menu="audio">
          <button class="icon-button" aria-label="Audio tracks" title="Audio tracks" @click="toggleMenu('audio')"><AudioLines /></button>
          <div v-if="menu === 'audio'" class="popover">
            <PlayerTrackOptions kind="audio" :tracks="audioTracks" :selected="audio" @select="selectAudio" />
          </div>
        </div>

        <div v-if="isVisible('subtitles')" class="popover-wrap" data-control-id="subtitles" data-player-menu="subtitles">
          <button class="icon-button" aria-label="Subtitles" title="Subtitles" @click="toggleMenu('subtitles')"><Captions /></button>
          <div v-if="menu === 'subtitles'" class="popover">
            <PlayerTrackOptions kind="subtitles" :tracks="subtitleTracks" :selected="subtitle" @select="emit('selectSubtitle', $event)" />
          </div>
        </div>

        <div v-if="isVisible('quality')" class="popover-wrap" data-control-id="quality" data-player-menu="quality">
          <button class="quality-button" :aria-label="qualityButtonAccessibleLabel" @click="toggleMenu('quality')">
            <span>{{ qualityButtonResolution }}</span><sup v-if="qualityButtonColor">{{ qualityButtonColor }}</sup>
          </button>
          <div v-if="menu === 'quality'" :class="['popover', 'quality-popover', { 'has-hdr': sourceHDR }]">
            <QualityMenuContent
              :manual-level="manualLevel"
              :original-description="originalDescription"
              :original-available="originalAvailable"
              :original-unavailable-reason="originalUnavailableReason"
              :available-levels="availableLevels"
              :source-h-d-r="sourceHDR"
              :color-preference="colorPreference"
              :hdr-supported="hdrSupported"
              @select-quality="emit('selectQuality', $event)"
              @select-color-mode="emit('selectColorMode', $event)"
            />
          </div>
        </div>

        <div v-if="isVisible('framing')" class="popover-wrap" data-control-id="framing" data-player-menu="framing">
          <button
            class="icon-button framing-button"
            :aria-label="videoFrameAdjusted ? 'Video framing adjusted' : 'Video framing'"
            :title="videoFrameAdjusted ? 'Video framing adjusted' : 'Video framing'"
            @click="toggleMenu('framing')"
          >
            <Crop /><span v-if="videoFrameAdjusted" class="framing-indicator" aria-hidden="true" />
          </button>
          <div v-if="menu === 'framing'" class="popover framing-popover">
            <VideoFramingMenu :crop="videoFrameCrop" @adjust="adjustVideoFrame" @reset="emit('resetVideoFrame')" />
          </div>
        </div>

        <div v-if="isVisible('speed')" class="popover-wrap" data-control-id="speed" data-player-menu="speed">
          <button class="icon-button" :aria-label="`Playback speed, ${playbackRateLabel(playbackRate)}`" :title="`Playback speed, ${playbackRateLabel(playbackRate)}`" @click="toggleMenu('speed')"><Gauge /></button>
          <div v-if="menu === 'speed'" class="popover speed-popover">
            <PlaybackSpeedControl :value="playbackRate" @select="emit('selectPlaybackRate', $event)" />
          </div>
        </div>

        <button
          v-if="isVisible('diagnostics')"
          class="icon-button"
          data-control-id="diagnostics"
          data-diagnostics-toggle
          :class="{ selected: diagnosticsOpen }"
          aria-label="Advanced playback information"
          title="Advanced playback information"
          :aria-expanded="diagnosticsOpen"
          @click="emit('toggleDiagnostics')"
        ><Info /></button>
        <button v-if="isVisible('pip')" class="icon-button" data-control-id="pip" aria-label="Picture in picture" title="Picture in picture" @click="emit('pictureInPicture')"><PictureInPicture2 /></button>
        <button v-if="isVisible('fullscreen')" class="icon-button" data-control-id="fullscreen" aria-label="Fullscreen" title="Fullscreen" @click="emit('fullscreen')"><Maximize /></button>

        <div class="popover-wrap more-control" data-control-more data-player-menu="overflow">
          <button
            :class="['icon-button', { 'more-button-placeholder': !hiddenOverflowIds.length }]"
            aria-label="More options"
            title="More options"
            :aria-expanded="menu === 'overflow'"
            :aria-hidden="!hiddenOverflowIds.length"
            :tabindex="hiddenOverflowIds.length ? 0 : -1"
            @click="toggleMenu('overflow')"
          ><Ellipsis /></button>
          <PlayerOverflowMenu
            :open="menu === 'overflow'"
            :hidden-ids="hiddenOverflowIds"
            :quick-actions="quickActions"
            :setting-actions="settingActions"
            @activate="activateOverflow"
          >
            <template #volume>
              <div class="overflow-volume">
                <button class="icon-button" :aria-label="muted || volume === 0 ? 'Unmute' : 'Mute'" :title="muted || volume === 0 ? 'Unmute' : 'Mute'" @click="emit('toggleMute')"><component :is="volumeIcon" /></button>
                <input class="volume-slider" type="range" min="0" max="1" step=".01" :value="volume" aria-label="Volume" @input="emit('volumeInput', $event)" />
              </div>
            </template>
            <template #audio><PlayerTrackOptions kind="audio" :tracks="audioTracks" :selected="audio" @select="selectAudio" /></template>
            <template #subtitles><PlayerTrackOptions kind="subtitles" :tracks="subtitleTracks" :selected="subtitle" @select="emit('selectSubtitle', $event)" /></template>
            <template #quality>
              <QualityMenuContent
                :manual-level="manualLevel"
                :original-description="originalDescription"
                :original-available="originalAvailable"
                :original-unavailable-reason="originalUnavailableReason"
                :available-levels="availableLevels"
                :source-h-d-r="sourceHDR"
                :color-preference="colorPreference"
                :hdr-supported="hdrSupported"
                @select-quality="emit('selectQuality', $event)"
                @select-color-mode="emit('selectColorMode', $event)"
              />
            </template>
            <template #framing><VideoFramingMenu :crop="videoFrameCrop" @adjust="adjustVideoFrame" @reset="emit('resetVideoFrame')" /></template>
            <template #speed><PlaybackSpeedControl :value="playbackRate" @select="emit('selectPlaybackRate', $event)" /></template>
          </PlayerOverflowMenu>
        </div>
      </div>
    </div>
  </section>
</template>
