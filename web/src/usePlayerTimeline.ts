import { computed, reactive, ref, type Ref } from "vue";
import {
  absoluteTimeForMedia,
  bufferedRangesForTimeline,
  mediaTimeForAbsolute,
  type MediaRange,
} from "./mediaTimeline";
import type { PlaybackMode } from "./playerTypes";

interface PlayerTimelineOptions {
  video: Ref<HTMLVideoElement | null>;
  loading: Ref<boolean>;
  getMode: () => PlaybackMode;
  getAutomatic: () => boolean;
  loadAdaptiveAt: (target: number, resume: boolean) => void;
  loadNativeHLSAt: (target: number, resume: boolean) => void;
  loadOriginalAt: (target: number, resume: boolean, automatic: boolean) => void;
}

export function usePlayerTimeline(options: PlayerTimelineOptions) {
  const current = ref(0);
  const duration = ref(0);
  const bufferedSeconds = ref(0);
  const bufferedRanges = ref<MediaRange[]>([]);
  const timeline = reactive<{
    offset: number;
    mediaOrigin: number | undefined;
    pendingAbsolute: number | undefined;
    resumeAfterLoad: boolean;
    scrubbing: boolean;
  }>({
    offset: 0,
    mediaOrigin: 0,
    pendingAbsolute: undefined,
    resumeAfterLoad: false,
    scrubbing: false,
  });

  const playedPercent = computed(() =>
    duration.value > 0
      ? Math.max(0, Math.min(100, (current.value / duration.value) * 100))
      : 0,
  );
  const bufferedRangeStyles = computed(() =>
    bufferedRanges.value.map((range) => ({
      left: `${(range.start / duration.value) * 100}%`,
      width: `${((range.end - range.start) / duration.value) * 100}%`,
    })),
  );

  function absoluteTime() {
    return absoluteTimeForMedia(
      options.video.value?.currentTime || 0,
      timeline.offset,
      timeline.mediaOrigin || 0,
    );
  }

  function rangeContains(ranges: TimeRanges, value: number) {
    for (let index = 0; index < ranges.length; index++) {
      if (
        value >= ranges.start(index) - 0.15 &&
        value <= ranges.end(index) + 0.15
      ) {
        return true;
      }
    }
    return false;
  }

  function completePendingPosition() {
    const element = options.video.value;
    if (!element || timeline.pendingAbsolute === undefined) return;
    const mode = options.getMode();
    if (
      (mode === "adaptive" || mode === "native-hls" || mode === "original-hls") &&
      timeline.mediaOrigin === undefined
    ) {
      if (element.buffered.length) timeline.mediaOrigin = element.buffered.start(0);
      else if (element.seekable.length) timeline.mediaOrigin = element.seekable.start(0);
      else return;
    }
    const local = mediaTimeForAbsolute(
      timeline.pendingAbsolute,
      timeline.offset,
      timeline.mediaOrigin || 0,
    );
    if (mode === "original-direct") {
      if (element.readyState < 1) return;
    } else if (
      !rangeContains(element.seekable, local) &&
      !rangeContains(element.buffered, local)
    ) {
      return;
    }
    element.currentTime = local;
    current.value = timeline.pendingAbsolute;
    timeline.pendingAbsolute = undefined;
    options.loading.value = false;
    if (timeline.resumeAfterLoad) {
      timeline.resumeAfterLoad = false;
      void element.play();
    }
  }

  function bufferAhead(element: HTMLVideoElement) {
    for (let index = 0; index < element.buffered.length; index++) {
      if (
        element.currentTime >= element.buffered.start(index) - 0.15 &&
        element.currentTime <= element.buffered.end(index) + 0.15
      ) {
        return Math.max(0, element.buffered.end(index) - element.currentTime);
      }
    }
    return 0;
  }

  function updateBufferedRanges() {
    const element = options.video.value;
    if (!element || !duration.value) {
      bufferedRanges.value = [];
      return;
    }
    const localRanges: MediaRange[] = [];
    for (let index = 0; index < element.buffered.length; index++) {
      localRanges.push({
        start: element.buffered.start(index),
        end: element.buffered.end(index),
      });
    }
    bufferedRanges.value = bufferedRangesForTimeline(
      localRanges,
      duration.value,
      timeline.offset,
      timeline.mediaOrigin || 0,
    );
  }

  function updateBufferSignal() {
    const element = options.video.value;
    if (element) bufferedSeconds.value = bufferAhead(element);
    updateBufferedRanges();
  }

  function previewSeekEvent(event: Event) {
    timeline.scrubbing = true;
    current.value = Number((event.target as HTMLInputElement).value);
  }

  function commitSeekEvent(event: Event) {
    timeline.scrubbing = false;
    seek(Number((event.target as HTMLInputElement).value));
  }

  function seek(value: number) {
    const element = options.video.value;
    if (!element) return;
    const target = Math.max(0, Math.min(duration.value || value, value));
    const local = mediaTimeForAbsolute(
      target,
      timeline.offset,
      timeline.mediaOrigin || 0,
    );
    const resume = !element.paused || timeline.resumeAfterLoad;
    current.value = target;
    const mode = options.getMode();
    if (mode === "original-direct") {
      element.currentTime = target;
      return;
    }
    if (
      target >= timeline.offset &&
      (rangeContains(element.seekable, local) ||
        rangeContains(element.buffered, local))
    ) {
      element.currentTime = local;
      return;
    }
    if (mode === "original-hls" || mode === "original-remux") {
      options.loadOriginalAt(target, resume, options.getAutomatic());
    } else if (mode === "native-hls") {
      options.loadNativeHLSAt(target, resume);
    } else {
      options.loadAdaptiveAt(target, resume);
    }
  }

  return {
    absoluteTime,
    bufferAhead,
    bufferedRangeStyles,
    bufferedSeconds,
    commitSeekEvent,
    completePendingPosition,
    current,
    duration,
    playedPercent,
    previewSeekEvent,
    seek,
    timeline,
    updateBufferSignal,
    updateBufferedRanges,
  };
}
