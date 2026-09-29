import Hls from "hls.js";
import { onBeforeUnmount, type Ref, type ShallowRef } from "vue";
import {
  chooseAutoLevel,
  pinAutoLevel,
  shouldUseOriginal,
} from "./abr";
import { AVSyncGuard, type AVSyncDivergence } from "./avSyncGuard";
import { isExpiredHLSWindow, shouldRetryHLSNetworkError } from "./hlsRetry";
import { manualLevelForReload } from "./playerState";
import { playbackWindowStart } from "./playbackWindow";
import { chooseTrack, type PlarrEventType } from "./protocol";
import type { PlaybackMode, PlayerProbe, QualityLevel } from "./playerTypes";
import { playbackURL } from "./playbackURL";

interface TimelineState {
  offset: number;
  mediaOrigin: number | undefined;
  pendingAbsolute: number | undefined;
  resumeAfterLoad: boolean;
}

interface AdaptivePlaybackOptions {
  video: Ref<HTMLVideoElement | null>;
  loading: Ref<boolean>;
  fatal: Ref<string>;
  probe: ShallowRef<PlayerProbe | null>;
  configuredLevels: Ref<QualityLevel[]>;
  availableLevels: Ref<QualityLevel[]>;
  diagnosticMode: Ref<PlaybackMode>;
  activeLevelIndex: Ref<number>;
  bandwidthEstimate: Ref<number>;
  recentBandwidthProbe: () => number;
  bufferedSeconds: Ref<number>;
  diagnosticsDecision: Ref<string>;
  quality: Ref<string>;
  manualLevel: Ref<number>;
  current: Ref<number>;
  timeline: TimelineState;
  params: URLSearchParams;
  base: string;
  sessionId: string;
  playbackToken?: string;
  onAuthorizationExpired?: () => void;
  emit: (type: PlarrEventType, payload?: Record<string, unknown>) => void;
  setMode: (mode: PlaybackMode) => void;
  resetElement: () => void;
  completePendingPosition: () => void;
  bufferAhead: (element: HTMLVideoElement) => number;
  updatePlaybackSignals: () => void;
  getDeliveryColor: () => "hdr" | "sdr";
  canUseOriginal: () => boolean;
  nextGeneration: () => number;
  onAutomaticOriginal: (target: number, resume: boolean) => void;
  onAVSyncReconciliation: (divergence: AVSyncDivergence) => boolean;
  armStartupWatchdog: () => void;
  clearStartupWatchdog: () => void;
  failPlayback: (message: string, details: string) => void;
  onPlaybackLoad: () => void;
  recoverExpiredWindow: (
    original: boolean,
    target: number,
    resume: boolean,
  ) => void;
  shouldResumePlayback: () => boolean;
  preferMP3Copy: () => boolean;
  onCodecFailure: (details: string) => boolean;
}

export function useAdaptivePlayback(options: AdaptivePlaybackOptions) {
  const startupBufferSeconds = 8;
  const steadyBufferSeconds = 300;
  let hls: Hls | null = null;
  let retryTimer: number | undefined;
  let currentLevel = -1;
  let automatic = true;
  let networkRetries = 0;
  let mediaRetries = 0;
  let pendingManualLevel: number | undefined;
  let scaledLevelIndices: number[] = [];
  let automaticOriginalPending = false;
  let autoOriginalBlockedUntil = 0;
  let autoUpgradeBlockedUntil = 0;
  let startupBufferRestricted = true;
  let lowBufferSince = 0;
  const failedUpgrades = new Map<number, number>();

  function clearRetryTimer() {
    if (retryTimer) window.clearTimeout(retryTimer);
    retryTimer = undefined;
  }

  function createHLS(initialLevel: number, restrictStartupBuffer = true) {
    return new Hls({
      enableWorker: true,
      lowLatencyMode: false,
      startLevel: initialLevel,
      startPosition: 0,
      abrBandWidthFactor: 0.85,
      abrBandWidthUpFactor: 0.75,
      maxStarvationDelay: 4,
      maxLoadingDelay: 4,
      maxBufferLength: restrictStartupBuffer
        ? startupBufferSeconds
        : steadyBufferSeconds,
      maxMaxBufferLength: restrictStartupBuffer
        ? startupBufferSeconds
        : steadyBufferSeconds,
      maxBufferSize: 512 * 1024 * 1024,
      backBufferLength: 300,
      manifestLoadingTimeOut: 30000,
      manifestLoadingMaxRetry: 2,
      manifestLoadingRetryDelay: 750,
      manifestLoadingMaxRetryTimeout: 8000,
      levelLoadingTimeOut: 30000,
      levelLoadingMaxRetry: 2,
      levelLoadingRetryDelay: 750,
      levelLoadingMaxRetryTimeout: 8000,
      fragLoadingTimeOut: 60000,
      fragLoadingMaxRetry: 2,
      fragLoadingRetryDelay: 750,
      fragLoadingMaxRetryTimeout: 8000,
    });
  }

  function sourceURL(start: number, generation: number) {
    const query = new URLSearchParams({
      session: options.sessionId,
      color: options.getDeliveryColor(),
      generation: String(generation),
    });
    if (start > 0) query.set("start", start.toFixed(3));
    if (options.preferMP3Copy()) query.set("audioMode", "copy");
    return playbackURL(
      `${options.base}/hls/master.m3u8?${query}`,
      options.playbackToken,
    );
  }

  function loadAdaptiveAt(
    target: number,
    resume: boolean,
    requestedAutoLevel?: number,
  ) {
    options.onPlaybackLoad();
    const element = options.video.value!;
    const start = playbackWindowStart(target);
    pendingManualLevel = manualLevelForReload(
      automatic,
      options.manualLevel.value,
    );
    const initialLevel = requestedAutoLevel ?? pendingManualLevel ?? 0;
    destroyHls();
    options.resetElement();
    options.setMode("adaptive");
    options.diagnosticMode.value = "adaptive";
    options.activeLevelIndex.value = -1;
    options.timeline.offset = start;
    options.timeline.mediaOrigin = undefined;
    options.timeline.pendingAbsolute = target;
    options.timeline.resumeAfterLoad = resume;
    options.loading.value = true;
    options.fatal.value = "";
    networkRetries = 0;
    mediaRetries = 0;
    currentLevel = -1;
    scaledLevelIndices = [];
    automaticOriginalPending = false;
    startupBufferRestricted = true;
    lowBufferSince = 0;
    hls = createHLS(initialLevel);
    bindHLS(hls, initialLevel);
    hls.attachMedia(element);
    hls.loadSource(sourceURL(start, options.nextGeneration()));
    options.armStartupWatchdog();
  }

  function bindHLS(instance: Hls, initialLevel: number, original = false) {
    let windowRecoveryRequested = false;
    let syncRecoveryRequested = false;
    const syncGuard = new AVSyncGuard();
    instance.on(Hls.Events.MANIFEST_PARSED, () => {
      if (hls !== instance) return;
      if (!original) {
        scaledLevelIndices = instance.levels.map((_, index) => index);
        options.availableLevels.value = scaledLevelIndices.map((levelIndex) => {
          const level = instance.levels[levelIndex]!;
          return {
            height: level.height,
            bitrate:
              options.configuredLevels.value.find(
                (configured) => configured.height === level.height,
              )?.bitrate || level.bitrate,
          };
        });
        const preferred = chooseTrack(
          instance.audioTracks.map((track, index) => ({
            ...track,
            index,
            language: track.lang,
            name: track.name,
          })),
          options.params.get("audio") || undefined,
          options.params.get("audioTitle") || undefined,
        );
        if (preferred) instance.audioTrack = preferred.index!;
        if (pendingManualLevel !== undefined) {
          const displayLevel = pendingManualLevel;
          const hlsLevel = scaledLevelIndices[displayLevel] ?? 0;
          automatic = false;
          options.manualLevel.value = displayLevel;
          instance.autoLevelCapping = hlsLevel;
          instance.currentLevel = hlsLevel;
          pendingManualLevel = undefined;
        } else if (automatic) {
          pinAutoLevel(instance, scaledLevelIndices[initialLevel] ?? 0);
        }
      }
      options.completePendingPosition();
    });
    instance.on(Hls.Events.FRAG_LOADED, () => {
      if (hls !== instance) return;
      networkRetries = 0;
      options.completePendingPosition();
    });
    instance.on(Hls.Events.FRAG_BUFFERED, (_, data) => {
      if (hls !== instance) return;
      options.completePendingPosition();
      const element = options.video.value;
      if (element && options.bufferAhead(element) > 0.25) {
        options.clearStartupWatchdog();
      }
      if (
        !original &&
        !syncRecoveryRequested &&
        (data.id === "main" || data.id === "audio")
      ) {
        const sequence = Number(data.frag.sn);
        const start = Number(data.frag.startPTS ?? data.frag.start);
        const divergence = syncGuard.observe({
          lane: data.id,
          sequence,
          start,
        });
        if (divergence && options.onAVSyncReconciliation(divergence)) {
          syncRecoveryRequested = true;
        }
      }
    });
    instance.on(Hls.Events.LEVEL_UPDATED, () => {
      if (hls !== instance) return;
      options.completePendingPosition();
    });
    instance.on(Hls.Events.LEVEL_SWITCHED, (_, data) => {
      if (hls !== instance) return;
      if (original) {
        options.activeLevelIndex.value = -1;
        return;
      }
      currentLevel = data.level;
      const displayLevel = scaledLevelIndices.indexOf(data.level);
      options.activeLevelIndex.value = displayLevel;
      options.diagnosticMode.value = "adaptive";
      if (!automatic) return;
      options.quality.value = `Auto · ${instance.levels[data.level]?.height}p`;
      options.emit("automatic-rendition-changed", {
        quality: options.quality.value,
      });
    });
    instance.on(Hls.Events.ERROR, (_, data) => {
      if (hls !== instance) return;
      const networkStatus = Number(
        (data as unknown as { response?: { code?: number; status?: number }; networkDetails?: { status?: number } }).response?.code ??
          (data as unknown as { response?: { status?: number } }).response?.status ??
          (data as unknown as { networkDetails?: { status?: number } }).networkDetails?.status ??
          0,
      );
      if (networkStatus === 401 || networkStatus === 403) {
        options.onAuthorizationExpired?.();
        return;
      }
      const playableBuffer = options.video.value
        ? options.bufferAhead(options.video.value)
        : 0;
      if (
        data.details.includes("buffer") &&
        playableBuffer < 1 &&
        currentLevel >= 0
      ) {
        failedUpgrades.set(
          currentLevel,
          (failedUpgrades.get(currentLevel) || 0) + 1,
        );
        if (!lowBufferSince) lowBufferSince = Date.now();
      }
      if (
        data.type === Hls.ErrorTypes.NETWORK_ERROR &&
        isExpiredHLSWindow(data) &&
        !windowRecoveryRequested &&
        hls === instance
      ) {
        windowRecoveryRequested = true;
        options.loading.value = true;
        options.diagnosticsDecision.value =
          "The previous HLS generation window ended; playback is reopening at the current position with a fresh media timeline.";
        queueMicrotask(() => {
          if (hls === instance) {
            options.recoverExpiredWindow(
              original,
              options.current.value,
              options.shouldResumePlayback(),
            );
          }
        });
        return;
      }
      if (!data.fatal) return;
      if (
        data.type === Hls.ErrorTypes.MEDIA_ERROR &&
        options.onCodecFailure(`HLS ${data.details}${data.reason ? `: ${data.reason}` : ""}`)
      ) return;
      if (
        data.type === Hls.ErrorTypes.NETWORK_ERROR &&
        shouldRetryHLSNetworkError(data, networkRetries)
      ) {
        networkRetries++;
        options.loading.value = true;
        clearRetryTimer();
        retryTimer = window.setTimeout(
          () => {
            retryTimer = undefined;
            if (hls === instance) instance.startLoad();
          },
          Math.min(8000, 500 * Math.pow(1.4, networkRetries)),
        );
        return;
      }
      if (data.type === Hls.ErrorTypes.MEDIA_ERROR && mediaRetries < 3) {
        mediaRetries++;
        instance.recoverMediaError();
        return;
      }
      console.error(
        "Fatal HLS playback error",
        data.type,
        data.details,
        data.reason || "",
        data.error?.message || "",
        `fragment=${data.frag?.sn ?? "unknown"}`,
      );
      options.clearStartupWatchdog();
      options.failPlayback(
        "Playback failed.",
        `Fatal HLS error: ${data.type} · ${data.details}${data.reason ? ` · ${data.reason}` : ""}`,
      );
    });
  }

  function fastABR() {
    options.updatePlaybackSignals();
    if (!hls || !automatic || currentLevel < 0 || !options.video.value) return;
    const element = options.video.value;
    const buffer = options.bufferAhead(element);
    const bandwidth = options.bandwidthEstimate.value;
    const independentBandwidth = options.recentBandwidthProbe();
    const sourceBitrate = Number(options.probe.value?.format?.bit_rate) || 0;
    const now = Date.now();
    if (buffer < 1) {
      if (!lowBufferSince) lowBufferSince = now;
    } else {
      lowBufferSince = 0;
    }
    const sustainedBufferStarvation =
      lowBufferSince > 0 && now - lowBufferSince >= 3_000;
    if (options.timeline.pendingAbsolute !== undefined || buffer <= 0) return;
    if (startupBufferRestricted && bandwidth > 0 && buffer >= 4) {
      hls.config.maxBufferLength = steadyBufferSeconds;
      hls.config.maxMaxBufferLength = steadyBufferSeconds;
      startupBufferRestricted = false;
    }
    const scaledLevels = scaledLevelIndices.map((index) => hls!.levels[index]!);
    const scaledFailures = new Map<number, number>();
    scaledLevelIndices.forEach((levelIndex, displayIndex) => {
      scaledFailures.set(displayIndex, failedUpgrades.get(levelIndex) || 0);
    });
    if (Date.now() < autoUpgradeBlockedUntil) {
      if (currentLevel >= 0) pinAutoLevel(hls, currentLevel);
      return;
    }
    if (
      options.canUseOriginal() &&
      !automaticOriginalPending &&
      shouldUseOriginal(
        bandwidth,
        sourceBitrate,
        buffer,
        autoOriginalBlockedUntil,
        now,
        independentBandwidth,
      )
    ) {
      options.diagnosticsDecision.value = `Original selected because both the ${Math.round(bandwidth / 1_000_000)} Mbps stream estimate and ${Math.round(independentBandwidth / 1_000_000)} Mbps independent probe met the 1.5× source-bitrate margin with ${buffer.toFixed(1)} s buffered. Audio and video are reopening on one unified timeline.`;
      automaticOriginalPending = true;
      options.onAutomaticOriginal(
        options.current.value,
        options.shouldResumePlayback(),
      );
      return;
    }
    const currentScaledLevel = scaledLevelIndices.indexOf(currentLevel);
    if (currentScaledLevel < 0) return;
    if (sustainedBufferStarvation && currentScaledLevel > 0) {
      const target =
        scaledLevelIndices[currentScaledLevel - 1] ??
        scaledLevelIndices[0] ??
        0;
      failedUpgrades.set(
        currentLevel,
        (failedUpgrades.get(currentLevel) || 0) + 1,
      );
      autoUpgradeBlockedUntil = now + 30_000;
      pinAutoLevel(hls, target);
      options.diagnosticsDecision.value =
        "Automatic one-step downgrade after the playable buffer stayed below one second for three seconds.";
      lowBufferSince = 0;
      return;
    }
    const target = chooseAutoLevel(
      scaledLevels,
      currentScaledLevel,
      bandwidth,
      buffer,
      scaledFailures,
    );
    if (target > currentScaledLevel) {
      const hlsTarget = scaledLevelIndices[target]!;
      const selected = hls.levels[hlsTarget];
      options.diagnosticsDecision.value = `Automatic direct upgrade to ${selected?.height || "the optimal"}p: the ${buffer < 4 ? "72" : "82"}% safety budget from the measured bandwidth supports its target bitrate with ${buffer.toFixed(1)} s buffered.`;
      pinAutoLevel(hls, hlsTarget);
    } else {
      pinAutoLevel(hls, currentLevel);
    }
  }

  function destroyHls() {
    clearRetryTimer();
    options.clearStartupWatchdog();
    hls?.destroy();
    hls = null;
  }

  function loadOriginalHls(element: HTMLVideoElement, source: string) {
    destroyHls();
    currentLevel = -1;
    networkRetries = 0;
    mediaRetries = 0;
    hls = createHLS(0, false);
    bindHLS(hls, 0, true);
    hls.attachMedia(element);
    hls.loadSource(source);
    options.armStartupWatchdog();
  }

  function resetAutomaticUpgradeState() {
    autoUpgradeBlockedUntil = 0;
    failedUpgrades.clear();
  }

  function blockAutomaticOriginal(milliseconds: number) {
    autoOriginalBlockedUntil = Date.now() + milliseconds;
  }

  onBeforeUnmount(destroyHls);

  return {
    bindHLS,
    blockAutomaticOriginal,
    createHLS,
    destroyHls,
    fastABR,
    getHls: () => hls,
    isAutomatic: () => automatic,
    loadAdaptiveAt,
    loadOriginalHls,
    resetAutomaticUpgradeState,
    setAutomatic: (value: boolean) => (automatic = value),
    setPendingManualLevel: (value: number | undefined) =>
      (pendingManualLevel = value),
  };
}
