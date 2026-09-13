import {
  computed,
  onBeforeUnmount,
  onMounted,
  readonly,
  shallowRef,
  type ComputedRef,
  type Ref,
} from "vue";
import { buildCastMediaRequest, type CastQuality } from "./castMedia";
import { BrowserCastAdapter } from "./castSdk";
import type {
  CastAdapter,
  CastAvailability,
  CastRemoteSnapshot,
} from "./castTypes";
import type { PlarrEventType } from "./protocol";
import type { PlayerTrack } from "./playerTypes";

interface CastPlaybackOptions {
  adapter?: CastAdapter;
  mediaBase: string;
  sessionId: string;
  title: ComputedRef<string>;
  duration: Ref<number>;
  current: Ref<number>;
  playing: Ref<boolean>;
  loading: Ref<boolean>;
  volume: Ref<number>;
  muted: Ref<boolean>;
  playbackRate: Ref<number>;
  subtitleTracks: ComputedRef<PlayerTrack[]>;
  audio: Ref<number | undefined>;
  subtitle: Ref<number | undefined>;
  sourceHDR: ComputedRef<boolean>;
  deliveryColor: ComputedRef<"hdr" | "sdr">;
  pauseLocal: () => void;
  restoreLocal: (position: number) => void;
  emit: (type: PlarrEventType, payload?: Record<string, unknown>) => void;
  error: (message: string) => void;
}

export function useCastPlayback(options: CastPlaybackOptions) {
  const adapter = options.adapter ?? new BrowserCastAdapter();
  const availability = shallowRef<CastAvailability>("unavailable");
  const active = shallowRef(false);
  const deviceName = shallowRef("");
  const quality = shallowRef<CastQuality>("auto");
  const windowStart = shallowRef(0);
  let generation = 0;
  let ended = false;
  let heartbeat: number | undefined;
  let receiverRecoveryAttempts = 0;
  let receiverRecoveryTimer: number | undefined;

  const available = computed(
    () => availability.value !== "unavailable" || active.value,
  );
  const connected = computed(() => active.value);

  function stopHeartbeat(): void {
    if (heartbeat !== undefined) window.clearInterval(heartbeat);
    heartbeat = undefined;
  }

  function stopReceiverRecovery(): void {
    if (receiverRecoveryTimer !== undefined) {
      window.clearTimeout(receiverRecoveryTimer);
    }
    receiverRecoveryTimer = undefined;
  }

  function startHeartbeat(): void {
    stopHeartbeat();
    heartbeat = window.setInterval(() => {
      if (active.value && options.playing.value) options.emit("heartbeat");
    }, 5000);
  }

  function activeTrackIds(): number[] {
    return [
      ...(options.subtitle.value === undefined
        ? []
        : [100_000 + options.subtitle.value]),
    ];
  }

  async function loadAt(position: number, autoplay: boolean): Promise<boolean> {
    const start = Math.max(0, Math.min(options.duration.value || position, position));
    windowStart.value = start;
    ended = false;
    options.loading.value = true;
    try {
      await adapter.loadMedia(
        buildCastMediaRequest({
          origin: window.location.origin,
          mediaBase: options.mediaBase,
          sessionId: `${options.sessionId}-cast`,
          generation: ++generation,
          start,
          duration: options.duration.value,
          title: options.title.value,
          quality: quality.value,
          color: options.deliveryColor.value,
          sourceHDR: options.sourceHDR.value,
          audio: options.audio.value,
          subtitle: options.subtitle.value,
          subtitleTracks: options.subtitleTracks.value,
          autoplay,
          playbackRate: options.playbackRate.value,
        }),
      );
      return true;
    } catch (error) {
      options.loading.value = false;
      const message = error instanceof Error ? error.message : "Google Cast failed.";
      options.error(message);
      if (!active.value) options.restoreLocal(start);
      return false;
    }
  }

  async function request(): Promise<void> {
    const resume = options.playing.value;
    const position = options.current.value;
    try {
      availability.value = "connecting";
      await adapter.requestSession();
      active.value = true;
      options.pauseLocal();
      const loaded = await loadAt(position, resume);
      if (!loaded) {
        active.value = false;
        options.restoreLocal(position);
        return;
      }
      startHeartbeat();
    } catch (error) {
      availability.value = "available";
      const message = error instanceof Error ? error.message : "Google Cast failed.";
      options.error(message);
    }
  }

  function remoteChanged(snapshot: CastRemoteSnapshot): void {
    deviceName.value = snapshot.deviceName;
    if (!snapshot.connected) {
      if (active.value) {
        const position = options.current.value;
        active.value = false;
        stopHeartbeat();
        options.restoreLocal(position);
      }
      return;
    }
    if (!active.value || !snapshot.mediaLoaded) return;
    options.current.value = Math.min(
      options.duration.value || Infinity,
      windowStart.value + snapshot.currentTime,
    );
    options.playing.value = !snapshot.paused;
    options.volume.value = snapshot.volume;
    options.muted.value = snapshot.muted;
    options.loading.value = snapshot.playerState === "BUFFERING";
    if (
      snapshot.playerState === "PLAYING" ||
      snapshot.playerState === "PAUSED"
    ) {
      receiverRecoveryAttempts = 0;
      stopReceiverRecovery();
    }
    if (
      snapshot.playerState === "IDLE" &&
      snapshot.idleReason === "ERROR" &&
      receiverRecoveryTimer === undefined
    ) {
      if (receiverRecoveryAttempts >= 2) {
        const position = options.current.value;
        active.value = false;
        stopHeartbeat();
        options.loading.value = false;
        options.error("Google Cast could not load this stream.");
        options.restoreLocal(position);
        return;
      }
      receiverRecoveryAttempts++;
      options.loading.value = true;
      receiverRecoveryTimer = window.setTimeout(() => {
        receiverRecoveryTimer = undefined;
        void loadAt(options.current.value, true);
      }, 250);
      return;
    }
    if (
      snapshot.playerState === "IDLE" &&
      !ended &&
      (snapshot.idleReason === "FINISHED" ||
        options.current.value >= options.duration.value * 0.95)
    ) {
      ended = true;
      options.current.value = options.duration.value;
      options.playing.value = false;
      options.emit("ended");
    }
  }

  function toggle(): void {
    adapter.playOrPause();
  }

  function seek(position: number): void {
    void loadAt(position, options.playing.value);
    options.emit("seek");
  }

  function setVolume(value: number): void {
    adapter.setVolume(value);
  }

  function setMuted(value: boolean): void {
    adapter.setMuted(value);
  }

  function setPlaybackRate(value: number): void {
    options.playbackRate.value = value;
    void loadAt(options.current.value, options.playing.value);
  }

  function selectAudio(index: number): void {
    options.audio.value = index;
    void loadAt(options.current.value, options.playing.value);
  }

  function selectSubtitle(index?: number): void {
    options.subtitle.value = index;
    adapter.setActiveTracks(activeTrackIds());
  }

  function selectQuality(value: CastQuality): void {
    quality.value = value;
    void loadAt(options.current.value, options.playing.value);
  }

  function reload(): void {
    void loadAt(options.current.value, options.playing.value);
  }

  onMounted(() => {
    void adapter.initialize({
      availabilityChanged: (value) => (availability.value = value),
      remoteChanged,
      error: options.error,
    });
  });
  onBeforeUnmount(() => {
    stopHeartbeat();
    stopReceiverRecovery();
    adapter.dispose();
  });

  return {
    active: readonly(active),
    availability: readonly(availability),
    available,
    connected,
    deviceName: readonly(deviceName),
    request,
    toggle,
    seek,
    setVolume,
    setMuted,
    setPlaybackRate,
    selectAudio,
    selectSubtitle,
    selectQuality,
    reload,
  };
}
