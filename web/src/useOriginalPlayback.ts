import Hls from "hls.js";
import type { Ref, ShallowRef } from "vue";
import type { PlarrEventType } from "./protocol";
import type { PlaybackMode, PlayerProbe, PlayerTrack } from "./playerTypes";
import { playbackWindowStart } from "./playbackWindow";

interface OriginalPlaybackOptions {
  base: string;
  sessionId: string;
  video: Ref<HTMLVideoElement | null>;
  probe: ShallowRef<PlayerProbe | null>;
  selectedAudioTrack: Ref<PlayerTrack | undefined>;
  audio: Ref<number | undefined>;
  sourceVideoSupported: ShallowRef<boolean>;
  sourceMSESupported: ShallowRef<boolean>;
  hdrDeliverySupported: ShallowRef<boolean>;
  loading: Ref<boolean>;
  fatal: Ref<string>;
  quality: Ref<string>;
  manualLevel: Ref<number>;
  diagnosticMode: Ref<PlaybackMode>;
  activeLevelIndex: Ref<number>;
  timeline: {
    offset: number;
    mediaOrigin: number | undefined;
    pendingAbsolute: number | undefined;
    resumeAfterLoad: boolean;
  };
  getDeliveryColor: () => "hdr" | "sdr";
  nextGeneration: () => number;
  isOriginalAvailable: () => boolean;
  originalUnavailableReason: () => string;
  setMode: (mode: PlaybackMode) => void;
  resetElement: () => void;
  destroyHls: () => void;
  loadOriginalHls: (element: HTMLVideoElement, source: string) => void;
  setAutomatic: (value: boolean) => void;
  setPendingManualLevel: (value: number | undefined) => void;
  emit: (type: PlarrEventType, payload?: Record<string, unknown>) => void;
  armStartupWatchdog: () => void;
  failPlayback: (message: string, details: string) => void;
  onPlaybackLoad: () => void;
}

export function useOriginalPlayback(options: OriginalPlaybackOptions) {
  function canDirect() {
    const codec = options.selectedAudioTrack.value?.codec_name?.toLowerCase();
    const audioSupported =
      !codec || ["aac", "mp3", "opus", "vorbis"].includes(codec);
    return (
      !!options.probe.value?.directPlayCandidate &&
      audioSupported &&
      options.sourceVideoSupported.value
    );
  }

  function canRemux() {
    return (
      !!options.probe.value?.remuxCandidate &&
      options.sourceVideoSupported.value
    );
  }

  function canOriginalHLS() {
    const codec = options.probe.value?.video?.codec_name?.toLowerCase();
    return (
      Hls.isSupported() &&
      (codec === "h264" || codec === "hevc") &&
      options.sourceMSESupported.value &&
      canRemux()
    );
  }

  function canAdaptive() {
    if (options.getDeliveryColor() === "hdr") {
      return options.hdrDeliverySupported.value;
    }
    return (
      options.video.value?.canPlayType('video/mp4; codecs="avc1.42E01E"') !== ""
    );
  }

  function adaptiveSourceURL(start: number, generation: number) {
    const query = new URLSearchParams({
      session: options.sessionId,
      color: options.getDeliveryColor(),
      generation: String(generation),
    });
    if (start > 0) query.set("start", start.toFixed(3));
    return `${options.base}/hls/master.m3u8?${query}`;
  }

  function originalHLSURL(start: number, generation: number) {
    const query = new URLSearchParams({
      session: options.sessionId,
      generation: String(generation),
    });
    if (start > 0) query.set("start", start.toFixed(3));
    if (options.audio.value !== undefined) {
      query.set("audio", String(options.audio.value));
    }
    return `${options.base}/hls/original/master.m3u8?${query}`;
  }

  function loadNativeHLSAt(target: number, resume: boolean) {
    options.onPlaybackLoad();
    const element = options.video.value!;
    const start = playbackWindowStart(target);
    options.destroyHls();
    options.resetElement();
    options.setMode("native-hls");
    options.diagnosticMode.value = "native-hls";
    options.activeLevelIndex.value = -1;
    options.timeline.offset = start;
    options.timeline.mediaOrigin = undefined;
    options.timeline.pendingAbsolute = target;
    options.timeline.resumeAfterLoad = resume;
    options.loading.value = true;
    element.src = adaptiveSourceURL(start, options.nextGeneration());
    element.load();
    options.armStartupWatchdog();
  }

  function loadOriginalAt(target: number, resume: boolean, automatic = false) {
    const element = options.video.value!;
    if (!options.isOriginalAvailable()) {
      const reason = options.originalUnavailableReason();
      options.failPlayback(reason, `Original quality is unavailable: ${reason}`);
      return false;
    }
    options.onPlaybackLoad();
    options.destroyHls();
    options.resetElement();
    options.setAutomatic(automatic);
    options.quality.value = automatic ? "Auto · Original" : "Original";
    options.manualLevel.value = automatic ? -1 : -2;
    options.setPendingManualLevel(undefined);
    options.timeline.mediaOrigin = 0;
    options.timeline.pendingAbsolute = target;
    options.timeline.resumeAfterLoad = resume;
    options.loading.value = true;
    options.fatal.value = "";
    options.activeLevelIndex.value = -1;
    if (canOriginalHLS()) {
      options.setMode("original-hls");
      options.diagnosticMode.value = "original-hls";
      options.timeline.offset = target;
      options.timeline.mediaOrigin = undefined;
      options.loadOriginalHls(
        element,
        originalHLSURL(target, options.nextGeneration()),
      );
    } else if (canDirect()) {
      options.setMode("original-direct");
      options.diagnosticMode.value = "original-direct";
      options.timeline.offset = 0;
      element.src = `${options.base}/original?session=${encodeURIComponent(options.sessionId)}`;
      element.load();
      options.armStartupWatchdog();
    } else {
      options.setMode("original-remux");
      options.diagnosticMode.value = "original-remux";
      options.timeline.offset = target;
      const query = new URLSearchParams({ session: options.sessionId });
      if (target > 0) query.set("start", target.toFixed(3));
      if (options.audio.value !== undefined) {
        query.set("audio", String(options.audio.value));
      }
      element.src = `${options.base}/remux.mp4?${query}`;
      element.load();
      options.armStartupWatchdog();
    }
    return true;
  }

  return {
    canAdaptive,
    canDirect,
    canOriginalHLS,
    canRemux,
    loadNativeHLSAt,
    loadOriginalAt,
  };
}
