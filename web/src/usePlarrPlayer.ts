import Hls from "hls.js";
import { effectiveAdaptiveBandwidth } from "./abr";
import { useTelevisionRemote } from "./useTelevisionRemote";
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  shallowRef,
  watch,
  type CSSProperties,
} from "vue";
import { chooseInitialPlayback } from "./initialPlayback";
import {
  type ColorPreference,
  supportsHDRDelivery,
  supportsMP3Playback,
  supportsMP3InMP4,
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
import {
  useVideoAdjustments,
  videoGammaFilterId,
} from "./useVideoAdjustments";
import { useVideoFraming } from "./useVideoFraming";
import { measureNetworkBandwidth } from "./bandwidthProbe";
import { AVSyncRecoveryLimiter } from "./avSyncGuard";
import { useCastPlayback } from "./useCastPlayback";
import { useWatchParty, type PartyState } from "./useWatchParty";
import { roomCorrection, watchPartyToggleAction } from "./watchPartyClock";
import { playbackURL } from "./playbackURL";
import { playbackNeedsPreviewPriority } from "./previewPlaybackPriority";
import { shouldRetryMP3WithAAC } from "./mp3Fallback";
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
  const mp3Supported = shallowRef(false);
  const mp3MP4Supported = shallowRef(false);
  const mp3CopyRejected = shallowRef(false);
  const mp3FallbackReason = shallowRef("");
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
  const {
    base,
    mediaId,
    mediaPath,
    params,
    parentOrigin,
    hasPrevious,
    hasNext,
  } = parsePlayerLocation(location.hash);
  const trustedParent = shallowRef(false);
  const playbackToken = params.get("playbackToken") || "";
  const roomId = params.get("room") || "";
  const roomNeedsGesture = shallowRef(false);
  let roomIntent = true;
  let roomInitialized = false;
  let roomStart = 0;
  let roomIsPlaying = false;
  let roomLastRevision = 0;
  let roomBufferTimer: number | undefined;
  let roomSyncHoldTimer: number | undefined;
  let roomReportTimer: number | undefined;
  let authorizationExpiredNotified = false;
  let authorizationExpired = (): void => undefined;
  const {
    imageURL: timelinePreviewURL,
    request: previewTimeline,
    clear: clearTimelinePreview,
    initialize: initializeTimelinePreview,
    pausePreload: pauseTimelinePreload,
    resumePreload: resumeTimelinePreload,
    stopPreload: stopTimelinePreload,
  } = useTimelinePreview({
    base,
    playbackToken,
    onAuthorizationExpired: () => authorizationExpired(),
  });
  const {
    absoluteTime,
    bufferAhead,
    bufferedRangeStyles,
    bufferedSeconds,
    commitSeekEvent: commitLocalSeekEvent,
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
  function seekInRoom(position: number): void {
    const target = Math.max(0, Math.min(duration.value || position, position));
    seek(target);
    if (roomId) party.command({ type: "seek", position: target });
  }
  watch(
    [bufferedSeconds, playing, loading],
    ([buffered, isPlaying, isLoading]) => {
      if (playbackNeedsPreviewPriority(buffered, isPlaying, isLoading)) {
        pauseTimelinePreload();
        return;
      }
      resumeTimelinePreload();
    },
    { immediate: true },
  );
  const {
    crop: videoFrameCrop,
    frameStyle: videoFrameStyle,
    videoStyle: framingVideoStyle,
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
  const {
    values: videoAdjustments,
    adjusted: videoAppearanceAdjusted,
    gammaExponent,
    style: videoAdjustmentStyle,
    set: setVideoAdjustment,
    reset: resetVideoAdjustments,
  } = useVideoAdjustments();
  const videoContentStyle = computed<CSSProperties>(() => ({
    ...framingVideoStyle.value,
    ...videoAdjustmentStyle.value,
  }));
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
  authorizationExpired = () => {
    if (authorizationExpiredNotified) return;
    authorizationExpiredNotified = true;
    emit("authorization-expired", {
      quality: quality.value,
      colorPreference: colorPreference.value,
      playbackRate: video.value?.playbackRate || 1,
    });
    failPlayback(
      "Playback authorization expired.",
      "The playback grant is no longer valid.",
    );
  };
  const { cancelActiveJobs, resumeActiveJobs } = usePlaybackLease({
    sessionId,
    active: computed(() => loading.value || playing.value),
    playbackToken,
    onAuthorizationExpired: authorizationExpired,
  });
  useTelevisionRemote({
    enabled: params.get("tv") === "1",
    video,
    menu,
    diagnosticsOpen,
    close,
    toggle,
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
  function preferMP3Copy(): boolean {
    return mp3Supported.value && !mp3CopyRejected.value &&
      !!probe.value?.audio?.some((track) => track.codec_name?.toLowerCase() === "mp3");
  }

  function preferMP3CopyForOriginal(): boolean {
    return preferMP3Copy() && mp3MP4Supported.value;
  }

  function onCodecFailure(details: string): boolean {
    if (mode === "native-hls" || !shouldRetryMP3WithAAC({
      selectedCodec: selectedAudioTrack.value?.codec_name,
      mp3CopyActive: mode === "adaptive" ? preferMP3Copy() :
        mode === "original-direct" ? !mp3CopyRejected.value : preferMP3CopyForOriginal(),
      alreadyRetried: mp3CopyRejected.value,
      failure: "decode",
    })) return false;
    mp3CopyRejected.value = true;
    mp3FallbackReason.value = details;
    diagnosticsDecision.value = `MP3 playback failed (${details}); retrying once with AAC compatibility audio.`;
    const target = timeline.pendingAbsolute ?? current.value;
    const resume = playing.value || timeline.resumeAfterLoad;
    const previousMode = mode;
    queueMicrotask(() => {
      if (disposed) return;
      if (previousMode === "adaptive") {
        loadAdaptiveAt(target, resume);
      } else {
        loadOriginalAt(target, resume, isAutomatic());
      }
    });
    return true;
  }
  const {
    diagnostics: transcodeDiagnostics,
    error: transcodeDiagnosticsError,
  } = useTranscodeDiagnostics({
    sessionId,
    active: computed(() => diagnosticsOpen.value || loading.value),
    playbackToken,
    onAuthorizationExpired: authorizationExpired,
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
    recentBandwidthProbe: () =>
      Date.now() < probedBandwidthValidUntil ? probedBandwidth : 0,
    bufferedSeconds,
    diagnosticsDecision,
    quality,
    manualLevel,
    current,
    timeline,
    params,
    base,
    sessionId,
    playbackToken,
    onAuthorizationExpired: authorizationExpired,
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
    preferMP3Copy,
    onCodecFailure,
  });
  stopPlaybackEngine = destroyHls;
  const {
    applyNativeTracks,
    applySubtitle,
    audio,
    audioTracks,
    initialize: initializeTracks,
    selectedAudioTrack,
    selectAudio: selectLocalAudio,
    selectSubtitle: selectLocalSubtitle,
    subtitle,
    subtitleTracks,
  } = usePlayerTracks({
    probe,
    video,
    base,
    playbackToken,
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
    playbackToken,
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
    preferMP3Copy: preferMP3CopyForOriginal,
    mp3CopyRejected: () => mp3CopyRejected.value,
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
    mp3CopyRequested: computed(() => diagnosticMode.value === "adaptive" ? preferMP3Copy() :
      diagnosticMode.value === "native-hls" ? false : preferMP3CopyForOriginal()),
    mp3FallbackUsed: mp3CopyRejected,
    mp3FallbackReason,
    isAutomatic,
    canDirect,
    canRemux,
    canOriginalHLS,
  });
  canUseOriginalAutomatically = () =>
    originalAvailable.value && canOriginalHLS();
  const {
    changeVolume: changeLocalVolume,
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
    setPlaybackRate: setLocalPlaybackRate,
    surfaceClick,
    endSurfacePress,
    toggleDiagnostics,
    toggleMute: toggleLocalMute,
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
    seek: seekInRoom,
    onBoostStart: () => { if (roomId) party.command({ type: "boost-start" }); },
    onBoostEnd: () => { if (roomId) party.command({ type: "boost-end" }); },
  });

  const party = useWatchParty(roomId, playbackToken, (state: PartyState) => {
    roomIntent = state.intent;
    roomStart = state.position;
    roomIsPlaying = state.playing;
    if (!roomInitialized || !video.value) return;
    const forcedSeek = state.action === "seek" && state.revision !== roomLastRevision;
    roomLastRevision = state.revision;
    const element = video.value;
    if (Math.abs(element.playbackRate - state.rate) > 0.01) setLocalPlaybackRate(state.rate);
    // The room position has already been projected through an RTT-calibrated
    // server clock. Keep every browser on that timeline after joins and pauses.
    const target = state.position;
    if (forcedSeek && loading.value && Math.abs(current.value - target) > 0.15) {
      seek(target);
    } else if (!loading.value) {
      const correction = roomCorrection(absoluteTime(), target, state.playing);
      if (correction.type === "seek") {
        if (roomSyncHoldTimer !== undefined) clearTimeout(roomSyncHoldTimer);
        roomSyncHoldTimer = undefined;
        seek(correction.position);
      } else if (correction.type === "hold" && !element.paused && roomSyncHoldTimer === undefined) {
        element.pause();
        roomSyncHoldTimer = window.setTimeout(() => {
          roomSyncHoldTimer = undefined;
          if (roomIsPlaying && !roomNeedsGesture.value && !loading.value) {
            void element.play().catch(() => {
              roomNeedsGesture.value = true;
              party.command({ type: "buffering" });
            });
          }
        }, correction.milliseconds);
      }
    }
    if (state.playing) {
      if (element.paused && !loading.value && !roomNeedsGesture.value && roomSyncHoldTimer === undefined) {
        void element.play().catch(() => {
          roomNeedsGesture.value = true;
          party.command({ type: "buffering" });
        });
      }
    } else {
      if (roomSyncHoldTimer !== undefined) clearTimeout(roomSyncHoldTimer);
      roomSyncHoldTimer = undefined;
      if (!element.paused) element.pause();
    }
  });
  function reportRoomBuffering(): void {
    if (!roomId || roomBufferTimer !== undefined) return;
    roomBufferTimer = window.setTimeout(() => {
      roomBufferTimer = undefined;
      party.command({ type: "buffering" });
    }, 500);
  }
  function reportRoomReady(): void {
    if (roomBufferTimer !== undefined) clearTimeout(roomBufferTimer);
    roomBufferTimer = undefined;
    if (roomId && !roomNeedsGesture.value) party.command({ type: "ready" });
  }

  function updateAutomaticQuality(): void {
    // Do not replace the source while the room is still waiting to start.
    if (roomId && (!playing.value || party.buffering.value > 0)) return;
    fastABR();
  }

  const castPlayback = useCastPlayback({
    mediaBase: base,
    sessionId,
    playbackToken,
    title: displayTitle,
    duration,
    current,
    playing,
    loading,
    volume,
    muted,
    playbackRate,
    subtitleTracks,
    audio,
    subtitle,
    sourceHDR,
    deliveryColor,
    pauseLocal: () => {
      clearStartupWatchdog();
      stopHeartbeat();
      destroyHls();
      resetElement();
      playing.value = false;
    },
    restoreLocal: (position) => {
      if (disposed || !video.value) return;
      loading.value = true;
      if (manualLevel.value === -2) {
        loadOriginalAt(position, false, isAutomatic());
      } else {
        loadAdaptiveAt(
          position,
          false,
          manualLevel.value >= 0 ? manualLevel.value : 0,
        );
      }
    },
    emit,
    error: (message) => {
      playbackIssue.value = `Google Cast: ${message}`;
      diagnosticsDecision.value = `Google Cast could not continue: ${message}`;
    },
  });

  function seekRelative(seconds: number): void {
    if (castPlayback.connected.value) {
      castPlayback.seek(current.value + seconds);
      return;
    }
    seekInRoom(current.value + seconds);
  }

  function commitSeekEvent(event: Event): void {
    if (!castPlayback.connected.value) {
      commitLocalSeekEvent(event);
      if (roomId) party.command({ type: "seek", position: current.value });
      return;
    }
    timeline.scrubbing = false;
    castPlayback.seek(Number((event.target as HTMLInputElement).value));
  }

  function changeVolume(event: Event): void {
    if (!castPlayback.connected.value) {
      changeLocalVolume(event);
      return;
    }
    const next = Math.max(
      0,
      Math.min(1, Number((event.target as HTMLInputElement).value)),
    );
    castPlayback.setVolume(next);
  }

  function toggleMute(): void {
    if (castPlayback.connected.value) {
      castPlayback.setMuted(!muted.value);
      return;
    }
    toggleLocalMute();
  }

  function selectAudio(index: number): void {
    if (!castPlayback.connected.value) {
      selectLocalAudio(index);
      return;
    }
    castPlayback.selectAudio(index);
    const track = audioTracks.value.find((item) => item.index === index);
    emit("audio-track-changed", {
      audioLanguage: track?.language,
      audioTitle: track?.name,
    });
    menu.value = "";
  }

  function selectSubtitle(index?: number): void {
    if (!castPlayback.connected.value) {
      selectLocalSubtitle(index);
      return;
    }
    castPlayback.selectSubtitle(index);
    const track = subtitleTracks.value.find((item) => item.index === index);
    emit(
      index === undefined ? "subtitles-disabled" : "subtitle-track-changed",
      {
        subtitleLanguage: track?.language,
        subtitleTitle: track?.name,
        subtitlesEnabled: index !== undefined,
      },
    );
    menu.value = "";
  }

  function setPlaybackRate(value: number): void {
    if (castPlayback.connected.value) {
      castPlayback.setPlaybackRate(value);
      return;
    }
    setLocalPlaybackRate(value);
    if (roomId) party.command({ type: "rate", rate: value });
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
    onCodecFailure,
    onBuffering: reportRoomBuffering,
    onReady: reportRoomReady,
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
          playbackURL(`${base}/bandwidth-probe`, playbackToken),
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
            updateAutomaticQuality();
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
        playbackToken,
        (config) => {
          trustedParent.value =
            !!parentOrigin &&
            (config.allowedParentOrigins || []).includes(parentOrigin);
        },
        authorizationExpired,
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
      if (parentOrigin && !trustedParent.value)
        console.warn("Ignoring an untrusted parent origin");
      initializeTracks();
      await nextTick();
      sourceVideoSupported.value = supportsSourceVideo(video.value!, p.video);
      sourceMSESupported.value = supportsSourceMSE(p.video);
      hdrDeliverySupported.value = supportsHDRDelivery(video.value!);
      mp3Supported.value = supportsMP3Playback(video.value!);
      mp3MP4Supported.value = supportsMP3InMP4(video.value!);
      attachMediaEvents(video.value!);
      if (roomId) {
        await party.connect();
        roomInitialized = true;
      }
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
    const start = roomId ? roomStart : Math.max(0, Number(params.get("start")) || 0);
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
    if (initial === "original") loadOriginalAt(start, !roomId);
    else if (initial === "hls-js") loadAdaptiveAt(start, !roomId);
    else if (initial === "native-hls") loadNativeHLSAt(start, !roomId);
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
    const combined = effectiveAdaptiveBandwidth(measured, initialProbe);
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
    if (castPlayback.connected.value) {
      if (value === "Original") {
        setAutomatic(false);
        manualLevel.value = -2;
        quality.value = "Original";
        diagnosticsDecision.value =
          "Original was selected manually for Google Cast.";
        castPlayback.selectQuality("original");
      } else if (value === "Auto") {
        setAutomatic(true);
        manualLevel.value = -1;
        quality.value = "Auto";
        diagnosticsDecision.value =
          "Google Cast is using the adaptive rendition ladder.";
        castPlayback.selectQuality("auto");
      } else {
        setAutomatic(false);
        const index = Number(value);
        manualLevel.value = index;
        quality.value = `${availableLevels.value[index]?.height}p`;
        diagnosticsDecision.value = `${quality.value} was selected manually for Google Cast.`;
        castPlayback.selectQuality(quality.value);
      }
      emit("manual-quality-changed", { quality: quality.value });
      return;
    }
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
    if (castPlayback.connected.value) {
      if (manualLevel.value === -2 && deliveryColor.value === "sdr") {
        setAutomatic(true);
        manualLevel.value = -1;
        quality.value = "Auto";
        castPlayback.selectQuality("auto");
      } else {
        castPlayback.reload();
      }
      return;
    }
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
    if (roomId) {
      const action = watchPartyToggleAction(video.value?.paused ?? true, roomIntent, roomIsPlaying);
      if (action === "unlock" && video.value) {
        void video.value.play().then(() => {
          roomNeedsGesture.value = false;
          if (!roomIsPlaying) video.value?.pause();
          reportRoomReady();
        }).catch(() => undefined);
        return;
      }
      party.command(action === "pause"
        ? { type: "pause", position: absoluteTime(), clientTime: performance.now() }
        : { type: "play" });
      return;
    }
    if (castPlayback.connected.value) {
      castPlayback.toggle();
      return;
    }
    if (!video.value) return;
    if (timeline.pendingAbsolute !== undefined) {
      timeline.resumeAfterLoad = true;
      return;
    }
    video.value.paused ? void video.value.play() : video.value.pause();
  }
  onMounted(() => {
    void init();
    abrTimer = window.setInterval(updateAutomaticQuality, 750);
    if (roomId) {
      roomReportTimer = window.setInterval(() => {
        if (roomInitialized && !loading.value && video.value?.readyState) {
          party.command({ type: "report", position: absoluteTime() });
        }
      }, 1_000);
    }
  });
  onBeforeUnmount(() => {
    disposed = true;
    initController?.abort();
    stopHeartbeat();
    if (abrTimer) clearInterval(abrTimer);
    if (bandwidthProbeTimer) clearInterval(bandwidthProbeTimer);
    if (originalStallTimer) clearTimeout(originalStallTimer);
    if (roomBufferTimer !== undefined) clearTimeout(roomBufferTimer);
    if (roomSyncHoldTimer !== undefined) clearTimeout(roomSyncHoldTimer);
    if (roomReportTimer !== undefined) clearInterval(roomReportTimer);
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
    castAvailable: castPlayback.available,
    castConnected: castPlayback.connected,
    castDeviceName: castPlayback.deviceName,
    requestCast: castPlayback.request,
    watchParty: party,
    watchPartyActive: !!roomId,
    roomNeedsGesture,
  };
}
