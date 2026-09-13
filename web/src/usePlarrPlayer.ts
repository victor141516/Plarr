import Hls from "hls.js";
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  shallowRef,
  watch,
} from "vue";
import { chooseInitialPlayback } from "./initialPlayback";
import {
  type ColorPreference,
  supportsHDRDelivery,
  supportsSourceMSE,
  supportsSourceVideo,
} from "./mediaCapabilities";
import {
  errorMessage,
  isAbortError,
  loadPlayerBootstrap,
} from "./playerBootstrap";
import { useHostBridge } from "./useHostBridge";
import { usePlaybackLease } from "./usePlaybackLease";
import { usePlaybackStartupWatchdog } from "./usePlaybackStartupWatchdog";
import { usePlayerInteractions } from "./usePlayerInteractions";
import { usePlayerTracks } from "./usePlayerTracks";
import { usePlaybackViewModel } from "./usePlaybackViewModel";
import { usePlayerTimeline } from "./usePlayerTimeline";
import { useAdaptivePlayback } from "./useAdaptivePlayback";
import { useOriginalPlayback } from "./useOriginalPlayback";
import { useMediaElementEvents } from "./useMediaElementEvents";
import { parsePlayerLocation } from "./playerLocation";
import { useTranscodeDiagnostics } from "./useTranscodeDiagnostics";
import { useTimelinePreview } from "./useTimelinePreview";
import { useVideoFraming } from "./useVideoFraming";
import { measureNetworkBandwidth } from "./bandwidthProbe";
import { AVSyncRecoveryLimiter } from "./avSyncGuard";
import {
  type PlaybackMode,
  type PlayerProbe,
  type QualityLevel,
} from "./playerTypes";

export function usePlarrPlayer() {
  const video = ref<HTMLVideoElement | null>(null),
    loading = ref(true),
    fatal = ref(""),
    playbackIssue = shallowRef(""),
    probe = shallowRef<PlayerProbe | null>(null),
    controls = ref(true),
    playing = ref(false);
  const volume = ref(1),
    muted = ref(false),
    quality = ref("Auto"),
    manualLevel = ref(-1),
    menu = ref(""),
    diagnosticsOpen = ref(false),
    diagnosticsCopied = ref(false),
    diagnosticMode = ref<PlaybackMode>("adaptive"),
    activeLevelIndex = ref(-1),
    bandwidthEstimate = ref(0),
    diagnosticsDecision = ref(
      "Automatic playback starts at the safest rendition while throughput is measured.",
    ),
    reactiveAVSyncReconciliations = ref(0);
  const colorPreference = shallowRef<ColorPreference>("auto");
  const sourceVideoSupported = shallowRef(false);
  const sourceMSESupported = shallowRef(false);
  const hdrDeliverySupported = shallowRef(false);
  const availableLevels = ref<QualityLevel[]>([]);
  const configuredLevels = ref<QualityLevel[]>([]);
  let abrTimer: number | undefined,
    bandwidthProbeTimer: number | undefined,
    originalStallTimer: number | undefined,
    mode: PlaybackMode = "adaptive",
    disposed = false;
  let probedBandwidth = 0,
    probedBandwidthValidUntil = 0;
  let playbackGeneration = 0;
  const avSyncRecoveryLimiter = new AVSyncRecoveryLimiter();
  let initController: AbortController | undefined;
  const { base, mediaId, mediaPath, params, parentOrigin, hasPrevious, hasNext } =
    parsePlayerLocation(location.hash);
  const trustedParent = shallowRef(false);
  const {
    imageURL: timelinePreviewURL,
    request: previewTimeline,
    clear: clearTimelinePreview,
    initialize: initializeTimelinePreview,
    stopPreload: stopTimelinePreload,
  } = useTimelinePreview({ base });
  const {
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
  } = usePlayerTimeline({
    video,
    loading,
    getMode: () => mode,
    getAutomatic: () => isAutomatic(),
    loadAdaptiveAt: (target, resume) => loadAdaptiveAt(target, resume),
    loadNativeHLSAt: (target, resume) => loadNativeHLSAt(target, resume),
    loadOriginalAt: (target, resume, automatic) =>
      loadOriginalAt(target, resume, automatic),
  });
  const {
    crop: videoFrameCrop,
    frameStyle: videoFrameStyle,
    videoStyle: videoContentStyle,
    adjust: adjustVideoFrame,
    reset: resetVideoFrame,
  } = useVideoFraming({
    mediaId: params.get("contentId") || mediaId,
    sourceAspect: computed(() => {
      const width = Number(probe.value?.video?.width) || 16;
      const height = Number(probe.value?.video?.height) || 9;
      return width / Math.max(1, height);
    }),
  });
  watch(fatal, (message) => {
    if (message) {
      stopTimelinePreload();
    }
  });
  const {
    sessionId,
    send: emit,
    startHeartbeat,
    stopHeartbeat,
    close,
  } = useHostBridge({
    video,
    current,
    duration,
    trusted: trustedParent,
    parentOrigin,
    mediaPath,
  });
  const { cancelActiveJobs, resumeActiveJobs } = usePlaybackLease({
    sessionId,
    active: computed(() => loading.value || playing.value),
  });
  let stopPlaybackEngine: () => void = () => undefined;
  let canUseOriginalAutomatically = () => false;
  let recoverExpiredPlaybackWindow = (
    _original: boolean,
    _target: number,
    _resume: boolean,
  ): void => undefined;
  const { arm: armStartupWatchdog, clear: clearStartupWatchdog } =
    usePlaybackStartupWatchdog({
      loading,
      hasPlayableBuffer: () => {
        const element = video.value;
        return (
          !!element && (element.readyState >= 3 || bufferAhead(element) > 0.25)
        );
      },
      onTimeout: () =>
        failPlayback(
          "Playback could not start.",
          `Startup timed out after 15 seconds without a playable buffer · ${quality.value} · ${diagnosticMode.value}`,
        ),
    });

  function failPlayback(message: string, details: string): void {
    clearStartupWatchdog();
    stopPlaybackEngine();
    loading.value = false;
    playing.value = false;
    fatal.value = message;
    playbackIssue.value = details;
    cancelActiveJobs();
    emit("playback-error", { message, details });
  }
  const {
    diagnostics: transcodeDiagnostics,
    error: transcodeDiagnosticsError,
  } = useTranscodeDiagnostics({
    sessionId,
    active: computed(() => diagnosticsOpen.value || loading.value),
  });
  const {
    blockAutomaticOriginal,
    destroyHls,
    fastABR,
    getHls,
    isAutomatic,
    loadAdaptiveAt,
    loadOriginalHls,
    resetAutomaticUpgradeState,
    setAutomatic,
    setPendingManualLevel,
  } = useAdaptivePlayback({
    video,
    loading,
    fatal,
    probe,
    configuredLevels,
    availableLevels,
    diagnosticMode,
    activeLevelIndex,
    bandwidthEstimate,
    bufferedSeconds,
    diagnosticsDecision,
    quality,
    manualLevel,
    current,
    timeline,
    params,
    base,
    sessionId,
    emit,
    setMode: (value) => (mode = value),
    resetElement,
    completePendingPosition,
    bufferAhead,
    updatePlaybackSignals,
    getDeliveryColor: () => deliveryColor.value,
    canUseOriginal: () => canUseOriginalAutomatically(),
    nextGeneration: () => ++playbackGeneration,
    onAutomaticOriginal: (target, resume) => {
      if (loadOriginalAt(target, resume, true)) {
        emit("automatic-rendition-changed", { quality: "Auto · Original" });
      }
    },
    onAVSyncReconciliation: (divergence) => {
      if (!avSyncRecoveryLimiter.request()) {
        diagnosticsDecision.value =
          "A repeated adaptive audio/video recovery was suppressed to keep playback on the current media timeline.";
        return false;
      }
      reactiveAVSyncReconciliations.value++;
      diagnosticsDecision.value = `Adaptive audio/video divergence detected (${divergence.sequenceDelta} fragments · ${divergence.ptsDelta.toFixed(3)} s). Both tracks are reopening at the current position on a fresh generation.`;
      const target = current.value;
      const resume = playing.value || timeline.resumeAfterLoad;
      queueMicrotask(() => {
        if (mode === "adaptive") loadAdaptiveAt(target, resume);
      });
      return true;
    },
    armStartupWatchdog,
    clearStartupWatchdog,
    failPlayback,
    onPlaybackLoad: beginPlaybackLoad,
    recoverExpiredWindow: (original, target, resume) =>
      recoverExpiredPlaybackWindow(original, target, resume),
    shouldResumePlayback: () => playing.value || timeline.resumeAfterLoad,
  });
  stopPlaybackEngine = destroyHls;
  const {
    applyNativeTracks,
    applySubtitle,
    audio,
    audioTracks,
    initialize: initializeTracks,
    selectedAudioTrack,
    selectAudio,
    selectSubtitle,
    subtitle,
    subtitleTracks,
  } = usePlayerTracks({
    probe,
    video,
    base,
    params,
    current,
    menu,
    getMode: () => mode,
    getHls,
    getAutomatic: isAutomatic,
    loadOriginalAt: (target, resume, automatic) => {
      loadOriginalAt(target, resume, automatic);
    },
    emit,
  });
  const {
    canAdaptive,
    canDirect,
    canOriginalHLS,
    canRemux,
    loadNativeHLSAt,
    loadOriginalAt,
  } = useOriginalPlayback({
    base,
    sessionId,
    video,
    probe,
    selectedAudioTrack,
    audio,
    sourceVideoSupported,
    sourceMSESupported,
    hdrDeliverySupported,
    loading,
    fatal,
    quality,
    manualLevel,
    diagnosticMode,
    activeLevelIndex,
    timeline,
    getDeliveryColor: () => deliveryColor.value,
    nextGeneration: () => ++playbackGeneration,
    isOriginalAvailable: () => originalAvailable.value,
    originalUnavailableReason: () => originalUnavailableReason.value,
    setMode: (value) => (mode = value),
    resetElement,
    destroyHls,
    loadOriginalHls,
    setAutomatic,
    setPendingManualLevel,
    emit,
    armStartupWatchdog,
    failPlayback,
    onPlaybackLoad: beginPlaybackLoad,
  });
  recoverExpiredPlaybackWindow = (original, target, resume) => {
    if (original) {
      loadOriginalAt(target, resume, isAutomatic());
      return;
    }
    loadAdaptiveAt(target, resume);
  };
  const {
    deliveryColor,
    diagnosticCopyText,
    diagnosticSections,
    displayTitle,
    originalAvailable,
    originalDescription,
    originalUnavailableReason,
    sourceHDR,
  } = usePlaybackViewModel({
    probe,
    audio,
    selectedAudioTrack,
    colorPreference,
    hdrDeliverySupported,
    params,
    mediaPath,
    diagnosticMode,
    quality,
    activeLevelIndex,
    availableLevels,
    bandwidthEstimate,
    bufferedSeconds,
    diagnosticsDecision,
    transcodeDiagnostics,
    transcodeDiagnosticsError,
    playbackIssue,
    reactiveAVSyncReconciliations,
    isAutomatic,
    canDirect,
    canRemux,
    canOriginalHLS,
  });
  canUseOriginalAutomatically = () =>
    originalAvailable.value && canOriginalHLS();
  const {
    changeVolume,
    beginSurfacePress,
    cancelSurfacePress,
    closeDiagnostics,
    copyDiagnostics,
    fullscreen,
    pip,
    playbackRate,
    mobileSeekDirection,
    mobileSeekSeconds,
    reveal,
    syncVolumeFromElement,
    setPlaybackRate,
    surfaceClick,
    endSurfacePress,
    toggleDiagnostics,
    toggleMute,
  } = usePlayerInteractions({
    video,
    current,
    playing,
    controls,
    diagnosticsOpen,
    diagnosticsCopied,
    menu,
    volume,
    muted,
    diagnosticCopyText,
    togglePlayback: toggle,
    seek,
  });

  function seekRelative(seconds: number): void {
    seek(current.value + seconds);
  }
  const { attach: attachMediaEvents } = useMediaElementEvents({
    video,
    playing,
    loading,
    current,
    duration,
    timeline,
    getMode: () => mode,
    absoluteTime,
    completePendingPosition,
    updateBufferedRanges,
    applyNativeTracks,
    syncVolumeFromElement,
    scheduleOriginalFallback,
    clearOriginalStall,
    emit,
    startHeartbeat,
    stopHeartbeat,
    armStartupWatchdog,
    clearStartupWatchdog,
    failPlayback,
  });

  async function init() {
    if (!mediaId) {
      failPlayback(
        "No media path was supplied.",
        "The player URL has no media id.",
      );
      return;
    }
    initController?.abort();
    const controller = new AbortController();
    initController = controller;
    try {
      const refreshBandwidthProbe = () => {
        void measureNetworkBandwidth(
          `${base}/bandwidth-probe`,
          controller.signal,
        )
          .then((measured) => {
            if (disposed || controller.signal.aborted) return;
            probedBandwidth = measured;
            probedBandwidthValidUntil = Date.now() + 45_000;
            bandwidthEstimate.value = Math.max(
              bandwidthEstimate.value,
              measured,
            );
            fastABR();
          })
          .catch((error: unknown) => {
            if (!isAbortError(error))
              console.warn("Bandwidth probe unavailable", error);
          });
      };
      refreshBandwidthProbe();
      if (bandwidthProbeTimer) window.clearInterval(bandwidthProbeTimer);
      bandwidthProbeTimer = window.setInterval(refreshBandwidthProbe, 30_000);
      const { config: cfg, probe: p } = await loadPlayerBootstrap(
        base,
        controller.signal,
      );
      if (disposed) return;
      probe.value = p;
      configuredLevels.value = (cfg.renditions || []).map((rendition) => ({
        height: Number(rendition.height) || 0,
        bitrate: Number(rendition.videoBitrate) || 0,
      }));
      duration.value = Number(p.durationSeconds) || 0;
      initializeTimelinePreview(
        Number(p.videoDurationSeconds) || duration.value,
        sessionId,
      );
      trustedParent.value =
        !!parentOrigin &&
        (cfg.allowedParentOrigins || []).includes(parentOrigin);
      if (parentOrigin && !trustedParent.value)
        console.warn("Ignoring an untrusted parent origin");
      initializeTracks();
      await nextTick();
      sourceVideoSupported.value = supportsSourceVideo(video.value!, p.video);
      sourceMSESupported.value = supportsSourceMSE(p.video);
      hdrDeliverySupported.value = supportsHDRDelivery(video.value!);
      attachMediaEvents(video.value!);
      setupPlayback();
      emit("ready");
      emit("opened");
    } catch (error: unknown) {
      if (disposed || isAbortError(error)) return;
      if (bandwidthProbeTimer) window.clearInterval(bandwidthProbeTimer);
      bandwidthProbeTimer = undefined;
      const message = errorMessage(error, "Unable to open media");
      failPlayback(message, `Player initialization failed: ${message}`);
    }
  }
  function setupPlayback() {
    const start = Math.max(0, Number(params.get("start")) || 0);
    video.value!.volume = volume.value;
    video.value!.muted = muted.value;
    const initial = chooseInitialPlayback({
      originalRequested: params.get("quality") === "original",
      originalSupported: originalAvailable.value,
      adaptiveCodecSupported: canAdaptive(),
      hlsJsSupported: Hls.isSupported(),
      nativeHlsSupported: !!video.value!.canPlayType(
        "application/vnd.apple.mpegurl",
      ),
    });
    if (initial === "original") loadOriginalAt(start, true);
    else if (initial === "hls-js") loadAdaptiveAt(start, true);
    else if (initial === "native-hls") loadNativeHLSAt(start, true);
    else throw new Error("This browser cannot play this media.");
    applySubtitle();
  }
  function resetElement() {
    const el = video.value!;
    el.pause();
    el.removeAttribute("src");
    el.load();
  }

  function clearOriginalStall(): void {
    if (originalStallTimer) window.clearTimeout(originalStallTimer);
    originalStallTimer = undefined;
  }

  function beginPlaybackLoad(): void {
    clearOriginalStall();
    resumeActiveJobs();
  }

  function updatePlaybackSignals() {
    updateBufferSignal();
    const measured = getHls()?.bandwidthEstimate || 0;
    const initialProbe =
      Date.now() < probedBandwidthValidUntil ? probedBandwidth : 0;
    const combined = Math.max(
      Number.isFinite(measured) && measured > 0 ? measured : 0,
      initialProbe,
    );
    if (combined > 0) bandwidthEstimate.value = combined;
  }
  function scheduleOriginalFallback() {
    if (
      !isAutomatic() ||
      (mode !== "original-direct" &&
        mode !== "original-hls" &&
        mode !== "original-remux") ||
      originalStallTimer
    )
      return;
    originalStallTimer = window.setTimeout(() => {
      originalStallTimer = undefined;
      const el = video.value;
      if (
        !el ||
        !isAutomatic() ||
        timeline.pendingAbsolute !== undefined ||
        el.paused ||
        bufferAhead(el) >= 1
      )
        return;
      blockAutomaticOriginal(30_000);
      diagnosticsDecision.value =
        "Original playback stalled with less than 1 second buffered; adaptive transcoding was restored and Original is blocked for 30 seconds.";
      quality.value = "Auto";
      loadAdaptiveAt(current.value, true);
      emit("automatic-rendition-changed", { quality: "Auto" });
    }, 1500);
  }

  function selectQuality(value: string) {
    const at = current.value,
      resume = !!video.value && !video.value.paused;
    if (value === "Original") {
      diagnosticsDecision.value =
        "Original was selected manually; the bandwidth estimate did not choose this mode.";
      if (loadOriginalAt(at, resume))
        emit("manual-quality-changed", { quality: "Original" });
      return;
    }
    if (value === "Auto") {
      setAutomatic(true);
      resetAutomaticUpgradeState();
      manualLevel.value = -1;
      quality.value = "Auto";
      diagnosticsDecision.value =
        "Automatic playback restarted at the safest rendition while throughput is measured.";
      loadAdaptiveAt(at, resume, 0);
    } else {
      setAutomatic(false);
      const i = Number(value);
      manualLevel.value = i;
      quality.value = `${availableLevels.value[i]?.height}p`;
      diagnosticsDecision.value = `${quality.value} was selected manually; the bandwidth estimate is informational only.`;
      setPendingManualLevel(i);
      loadAdaptiveAt(at, resume);
    }
    emit("manual-quality-changed", { quality: quality.value });
  }

  function selectColorMode(value: ColorPreference) {
    if (value === "hdr" && !hdrDeliverySupported.value) return;
    const previous = deliveryColor.value;
    colorPreference.value = value;
    if (deliveryColor.value === previous) return;
    const el = video.value;
    if (!el) return;
    const at = current.value;
    const resume = !el.paused;
    if (manualLevel.value === -2 && deliveryColor.value === "sdr") {
      setAutomatic(true);
      manualLevel.value = -1;
      quality.value = "Auto";
      diagnosticsDecision.value =
        "SDR selected; HDR is tone mapped by the adaptive rendition.";
      loadAdaptiveAt(at, resume, 0);
      return;
    }
    if (
      mode === "original-direct" ||
      mode === "original-hls" ||
      mode === "original-remux"
    ) {
      loadOriginalAt(at, resume, isAutomatic());
      return;
    }
    loadAdaptiveAt(at, resume, isAutomatic() ? 0 : undefined);
  }
  function toggle() {
    if (!video.value) return;
    if (timeline.pendingAbsolute !== undefined) {
      timeline.resumeAfterLoad = true;
      return;
    }
    video.value.paused ? void video.value.play() : video.value.pause();
  }
  onMounted(() => {
    void init();
    abrTimer = window.setInterval(fastABR, 750);
  });
  onBeforeUnmount(() => {
    disposed = true;
    initController?.abort();
    stopHeartbeat();
    if (abrTimer) clearInterval(abrTimer);
    if (bandwidthProbeTimer) clearInterval(bandwidthProbeTimer);
    if (originalStallTimer) clearTimeout(originalStallTimer);
    destroyHls();
  });

  return {
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
    hasPrevious,
    hasNext,
  };
}
