import { onBeforeUnmount, type Ref } from "vue";
import type { PlarrEventType } from "./protocol";
import type { PlaybackMode } from "./playerTypes";

interface MediaElementEventsOptions {
  video: Ref<HTMLVideoElement | null>;
  playing: Ref<boolean>;
  loading: Ref<boolean>;
  current: Ref<number>;
  duration: Ref<number>;
  timeline: {
    pendingAbsolute: number | undefined;
    scrubbing: boolean;
  };
  getMode: () => PlaybackMode;
  absoluteTime: () => number;
  completePendingPosition: () => void;
  updateBufferedRanges: () => void;
  applyNativeTracks: () => void;
  syncVolumeFromElement: () => void;
  scheduleOriginalFallback: () => void;
  clearOriginalStall: () => void;
  emit: (type: PlarrEventType, payload?: Record<string, unknown>) => void;
  startHeartbeat: () => void;
  stopHeartbeat: () => void;
  armStartupWatchdog: () => void;
  clearStartupWatchdog: () => void;
  failPlayback: (message: string, details: string) => void;
  onCodecFailure: (details: string) => boolean;
  onBuffering?: () => void;
  onReady?: () => void;
}

export function useMediaElementEvents(options: MediaElementEventsOptions) {
  let controller: AbortController | undefined;

  function attach(element: HTMLVideoElement) {
    controller?.abort();
    controller = new AbortController();
    const listen = (type: string, listener: EventListener) =>
      element.addEventListener(type, listener, { signal: controller!.signal });

    listen("play", () => {
      options.playing.value = true;
      options.emit("play");
      options.startHeartbeat();
    });
    listen("playing", () => {
      options.onReady?.();
      if (options.timeline.pendingAbsolute === undefined) options.clearStartupWatchdog();
      options.clearOriginalStall();
      if (options.timeline.pendingAbsolute === undefined) {
        options.loading.value = false;
      }
    });
    listen("waiting", () => {
      options.onBuffering?.();
      options.loading.value = true;
      options.armStartupWatchdog();
      options.scheduleOriginalFallback();
    });
    listen("canplay", () => {
      options.onReady?.();
      options.completePendingPosition();
      if (options.timeline.pendingAbsolute === undefined) {
        options.clearStartupWatchdog();
        if (element.readyState >= 3) options.loading.value = false;
      }
    });
    listen("loadedmetadata", () => {
      if (options.getMode() === "original-direct") options.applyNativeTracks();
      options.completePendingPosition();
    });
    listen("progress", () => {
      options.completePendingPosition();
      options.updateBufferedRanges();
    });
    listen("pause", () => {
      options.clearStartupWatchdog();
      if (options.timeline.pendingAbsolute === undefined && element.readyState >= 3) {
        options.loading.value = false;
      }
      options.playing.value = false;
      options.emit("pause");
      options.stopHeartbeat();
    });
    listen("seeking", () => {
      if (options.timeline.pendingAbsolute === undefined) options.emit("seek");
    });
    listen("timeupdate", () => {
      if (!options.timeline.scrubbing && options.timeline.pendingAbsolute === undefined) {
        options.current.value = Math.min(
          options.duration.value || Infinity,
          options.absoluteTime(),
        );
      }
      options.updateBufferedRanges();
    });
    listen("durationchange", () => {
      if (!options.duration.value && Number.isFinite(element.duration)) {
        options.duration.value = element.duration;
      }
    });
    listen("volumechange", options.syncVolumeFromElement);
    listen("ended", () => {
      options.clearStartupWatchdog();
      options.current.value = options.duration.value;
      options.emit("ended");
      options.stopHeartbeat();
    });
    listen("error", () => {
      if (element.error &&
        (element.error.code === 3 || element.error.code === 4) &&
        options.onCodecFailure(element.error.message || `Media error code ${element.error.code}`)) return;
      if (element.error && options.timeline.pendingAbsolute === undefined) {
        const details = element.error.message || `Media error code ${element.error.code}`;
        options.failPlayback("Playback failed.", `Media element error: ${details}`);
      }
    });
  }

  onBeforeUnmount(() => controller?.abort());

  return { attach };
}
