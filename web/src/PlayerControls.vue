<script setup lang="ts">
import {
  computed,
  shallowRef,
  type CSSProperties,
  useTemplateRef,
} from "vue";
import {
  AudioLines,
  Captions,
  Crop,
  Gauge,
  Info,
  Maximize,
  Pause,
  PictureInPicture2,
  Play,
  SkipBack,
  SkipForward,
  Volume1,
  Volume2,
  VolumeX,
} from "@lucide/vue";
import { declaredLanguageLabel, formatMediaTime } from "./playerPresentation";
import type { PlayerTrack, QualityLevel } from "./playerTypes";
import type { ColorPreference } from "./mediaCapabilities";
import ColorModeSelector from "./ColorModeSelector.vue";
import PlaybackSpeedControl from "./PlaybackSpeedControl.vue";
import SeekButton from "./SeekButton.vue";
import VideoFramingMenu from "./VideoFramingMenu.vue";
import { playbackRateLabel } from "./playbackRate";
import { useEventListener } from "./useEventListener";
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
}>();

const menu = defineModel<string>("menu", { required: true });
const controlsRoot = useTemplateRef<HTMLElement>("controlsRoot");
const timelinePreviewLeft = shallowRef("0%");
const timelinePreviewTime = shallowRef(0);
const timelinePreviewVisible = shallowRef(false);
const volumeIcon = computed(() =>
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

function toggleMenu(name: string) {
  menu.value = menu.value === name ? "" : name;
}

function adjustVideoFrame(side: VideoFrameSide, delta: number): void {
  emit("adjustVideoFrame", side, delta);
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
    <div class="control-row">
      <div class="transport-controls">
        <button
          class="icon-button episode-navigation"
          aria-label="Previous episode"
          title="Previous episode"
          @click="emit('previous')"
        >
          <SkipBack />
        </button>
        <SeekButton direction="backward" @activate="emit('seekBy', -5)" />
        <button
          class="icon-button"
          :aria-label="playing ? 'Pause' : 'Play'"
          :title="playing ? 'Pause' : 'Play'"
          @click="emit('togglePlayback')"
        >
          <Pause v-if="playing" /><Play v-else />
        </button>
        <SeekButton direction="forward" @activate="emit('seekBy', 5)" />
        <button
          class="icon-button episode-navigation"
          aria-label="Next episode"
          title="Next episode"
          @click="emit('next')"
        >
          <SkipForward />
        </button>
      </div>
      <span class="time"
        >{{ formatMediaTime(current) }} / {{ formatMediaTime(duration) }}</span
      >

      <div class="volume-control">
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
      <div class="spacer" />

      <div class="popover-wrap" data-player-menu="audio">
        <button
          class="icon-button"
          aria-label="Audio tracks"
          title="Audio tracks"
          @click="toggleMenu('audio')"
        >
          <AudioLines />
        </button>
        <div v-if="menu === 'audio'" class="popover">
          <button
            v-for="track in audioTracks"
            :key="track.index"
            :class="{ selected: audio === track.index }"
            @click="emit('selectAudio', track.index)"
          >
            {{ track.name }}
            <small
              >Language: {{ declaredLanguageLabel(track.language) }} · Codec:
              {{ track.codec_name.toUpperCase() }}</small
            >
          </button>
        </div>
      </div>

      <div class="popover-wrap" data-player-menu="subtitles">
        <button
          class="icon-button"
          aria-label="Subtitles"
          title="Subtitles"
          @click="toggleMenu('subtitles')"
        >
          <Captions />
        </button>
        <div v-if="menu === 'subtitles'" class="popover">
          <button
            :class="{ selected: subtitle === undefined }"
            @click="emit('selectSubtitle', undefined)"
          >
            Off
          </button>
          <button
            v-for="track in subtitleTracks"
            :key="track.index"
            :class="{ selected: subtitle === track.index }"
            @click="emit('selectSubtitle', track.index)"
          >
            {{ track.name }}
            <small>Language: {{ declaredLanguageLabel(track.language) }}</small>
          </button>
        </div>
      </div>

      <div class="popover-wrap" data-player-menu="quality">
        <button
          class="quality-button"
          :aria-label="qualityButtonAccessibleLabel"
          @click="toggleMenu('quality')"
        >
          <span>{{ qualityButtonResolution }}</span>
          <sup v-if="qualityButtonColor">{{ qualityButtonColor }}</sup>
        </button>
        <div
          v-if="menu === 'quality'"
          :class="['popover', 'quality-popover', { 'has-hdr': sourceHDR }]"
        >
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
      </div>

      <div class="popover-wrap" data-player-menu="framing">
        <button
          class="icon-button framing-button"
          :aria-label="videoFrameAdjusted ? 'Video framing adjusted' : 'Video framing'"
          :title="videoFrameAdjusted ? 'Video framing adjusted' : 'Video framing'"
          @click="toggleMenu('framing')"
        >
          <Crop />
          <span
            v-if="videoFrameAdjusted"
            class="framing-indicator"
            aria-hidden="true"
          />
        </button>
        <div v-if="menu === 'framing'" class="popover framing-popover">
          <VideoFramingMenu
            :crop="videoFrameCrop"
            @adjust="adjustVideoFrame"
            @reset="emit('resetVideoFrame')"
          />
        </div>
      </div>

      <div class="popover-wrap" data-player-menu="speed">
        <button
          class="icon-button"
          :aria-label="`Playback speed, ${playbackRateLabel(playbackRate)}`"
          :title="`Playback speed, ${playbackRateLabel(playbackRate)}`"
          @click="toggleMenu('speed')"
        >
          <Gauge />
        </button>
        <div v-if="menu === 'speed'" class="popover speed-popover">
          <PlaybackSpeedControl
            :value="playbackRate"
            @select="emit('selectPlaybackRate', $event)"
          />
        </div>
      </div>

      <button
        class="icon-button"
        data-diagnostics-toggle
        :class="{ selected: diagnosticsOpen }"
        aria-label="Advanced playback information"
        title="Advanced playback information"
        :aria-expanded="diagnosticsOpen"
        @click="emit('toggleDiagnostics')"
      >
        <Info />
      </button>
      <button
        class="icon-button"
        aria-label="Picture in picture"
        title="Picture in picture"
        @click="emit('pictureInPicture')"
      >
        <PictureInPicture2 />
      </button>
      <button
        class="icon-button"
        aria-label="Fullscreen"
        title="Fullscreen"
        @click="emit('fullscreen')"
      >
        <Maximize />
      </button>
    </div>
  </section>
</template>
