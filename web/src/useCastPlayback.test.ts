// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/vue";
import { computed, defineComponent, h, ref, shallowRef } from "vue";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  CastAdapter,
  CastAdapterCallbacks,
  CastMediaRequest,
  CastRemoteSnapshot,
} from "./castTypes";
import { useCastPlayback } from "./useCastPlayback";

class MockCastAdapter implements CastAdapter {
  callbacks?: CastAdapterCallbacks;
  loads: CastMediaRequest[] = [];
  activeTracks: number[][] = [];
  requested = 0;
  toggled = 0;
  volume = 1;
  muted = false;
  loadError?: Error;

  async initialize(callbacks: CastAdapterCallbacks): Promise<void> {
    this.callbacks = callbacks;
    callbacks.availabilityChanged("available");
  }
  async requestSession(): Promise<void> {
    this.requested++;
    this.callbacks?.availabilityChanged("connected");
    this.remote({ connected: true, mediaLoaded: false });
  }
  async loadMedia(request: CastMediaRequest): Promise<void> {
    if (this.loadError) throw this.loadError;
    this.loads.push(request);
    this.remote({
      connected: true,
      mediaLoaded: true,
      paused: !request.autoplay,
      currentTime: 0,
      duration: request.duration,
      playerState: request.autoplay ? "PLAYING" : "PAUSED",
    });
  }
  playOrPause(): void {
    this.toggled++;
  }
  seek(): void {}
  setVolume(volume: number): void {
    this.volume = volume;
  }
  setMuted(muted: boolean): void {
    this.muted = muted;
  }
  setActiveTracks(ids: number[]): void {
    this.activeTracks.push(ids);
  }
  stop(): void {}
  dispose(): void {}

  remote(overrides: Partial<CastRemoteSnapshot>): void {
    this.callbacks?.remoteChanged({
      connected: false,
      mediaLoaded: false,
      paused: true,
      currentTime: 0,
      duration: 0,
      volume: 0.75,
      muted: false,
      playerState: "IDLE",
      idleReason: "",
      deviceName: "Living room",
      ...overrides,
    });
  }
}

afterEach(cleanup);

function mountCast(adapter: MockCastAdapter) {
  const current = ref(125);
  const duration = ref(7200);
  const playing = ref(true);
  const loading = ref(false);
  const volume = ref(1);
  const muted = ref(false);
  const playbackRate = ref(1);
  const audio = ref<number | undefined>(2);
  const subtitle = ref<number | undefined>();
  const pauseLocal = vi.fn();
  const restoreLocal = vi.fn();
  const emit = vi.fn();
  const error = vi.fn();
  let cast!: ReturnType<typeof useCastPlayback>;
  const component = defineComponent({
    setup() {
      cast = useCastPlayback({
        adapter,
        mediaBase: "/api/v1/media/id",
        sessionId: "browser-session",
        title: computed(() => "Example film"),
        duration,
        current,
        playing,
        loading,
        volume,
        muted,
        playbackRate,
        subtitleTracks: computed(() => [
          {
            index: 7,
            codec_name: "subrip",
            codec_type: "subtitle",
            name: "Spanish",
            language: "es",
          },
        ]),
        audio,
        subtitle,
        sourceHDR: computed(() => false),
        deliveryColor: computed(() => "sdr" as const),
        pauseLocal,
        restoreLocal,
        emit,
        error,
      });
      return () => h("div");
    },
  });
  const view = render(component);
  return {
    cast,
    current,
    duration,
    playing,
    loading,
    audio,
    subtitle,
    pauseLocal,
    restoreLocal,
    emit,
    error,
    unmount: view.unmount,
  };
}

describe("Cast playback", () => {
  it("hands local playback to a receiver at the absolute current position", async () => {
    const adapter = new MockCastAdapter();
    const player = mountCast(adapter);
    await vi.waitFor(() => expect(player.cast.available.value).toBe(true));

    await player.cast.request();

    expect(adapter.requested).toBe(1);
    expect(player.pauseLocal).toHaveBeenCalledOnce();
    expect(adapter.loads).toHaveLength(1);
    expect(new URL(adapter.loads[0]!.contentId).searchParams.get("start")).toBe(
      "125.000",
    );
    expect(adapter.loads[0]!.autoplay).toBe(true);
    expect(player.cast.connected.value).toBe(true);
    expect(player.playing.value).toBe(true);
  });

  it("restores local playback when the receiver rejects the initial load", async () => {
    const adapter = new MockCastAdapter();
    adapter.loadError = new Error("LOAD_FAILED");
    const player = mountCast(adapter);
    await vi.waitFor(() => expect(player.cast.available.value).toBe(true));

    await player.cast.request();

    expect(player.error).toHaveBeenCalledWith("LOAD_FAILED");
    expect(player.restoreLocal).toHaveBeenCalledWith(125);
    expect(player.cast.connected.value).toBe(false);
  });

  it("maps receiver-relative progress back to Plarr's absolute timeline", async () => {
    const adapter = new MockCastAdapter();
    const player = mountCast(adapter);
    await player.cast.request();

    adapter.remote({
      connected: true,
      mediaLoaded: true,
      paused: false,
      currentTime: 9.5,
      playerState: "PLAYING",
    });

    expect(player.current.value).toBe(134.5);
    expect(player.loading.value).toBe(false);
  });

  it("opens a fresh generation for remote seeks and restores local playback on disconnect", async () => {
    const adapter = new MockCastAdapter();
    const player = mountCast(adapter);
    await player.cast.request();

    player.cast.seek(600);
    await vi.waitFor(() => expect(adapter.loads).toHaveLength(2));
    const second = new URL(adapter.loads[1]!.contentId);
    expect(second.searchParams.get("start")).toBe("600.000");
    expect(second.searchParams.get("generation")).toBe("2");
    expect(player.emit).toHaveBeenCalledWith("seek");

    adapter.remote({ connected: false });
    expect(player.restoreLocal).toHaveBeenCalledWith(600);
    expect(player.cast.connected.value).toBe(false);
  });

  it("reloads for audio and quality but edits subtitle tracks in place", async () => {
    const adapter = new MockCastAdapter();
    const player = mountCast(adapter);
    await player.cast.request();

    player.cast.selectAudio(4);
    player.cast.selectQuality("720p");
    player.cast.selectSubtitle(7);
    await vi.waitFor(() => expect(adapter.loads).toHaveLength(3));

    expect(new URL(adapter.loads[1]!.contentId).searchParams.get("audio")).toBe(
      "4",
    );
    expect(new URL(adapter.loads[2]!.contentId).searchParams.get("quality")).toBe(
      "720p",
    );
    expect(adapter.activeTracks.at(-1)).toEqual([100_007]);
  });

  it("applies playback speed through a new Cast load request", async () => {
    const adapter = new MockCastAdapter();
    const player = mountCast(adapter);
    await player.cast.request();

    player.cast.setPlaybackRate(1.5);
    await vi.waitFor(() => expect(adapter.loads).toHaveLength(2));

    expect(adapter.loads[1]!.playbackRate).toBe(1.5);
  });

  it("does not report cancelled or interrupted receiver sessions as completed", async () => {
    const adapter = new MockCastAdapter();
    const player = mountCast(adapter);
    await player.cast.request();

    adapter.remote({
      connected: true,
      mediaLoaded: true,
      currentTime: 12,
      playerState: "IDLE",
      idleReason: "CANCELLED",
    });

    expect(player.emit).not.toHaveBeenCalledWith("ended");
    expect(player.current.value).toBe(137);
  });

  it("reopens a failed receiver load in a fresh generation", async () => {
    vi.useFakeTimers();
    const adapter = new MockCastAdapter();
    const player = mountCast(adapter);
    await player.cast.request();

    adapter.remote({
      connected: true,
      mediaLoaded: true,
      currentTime: 3,
      playerState: "IDLE",
      idleReason: "ERROR",
    });
    await vi.advanceTimersByTimeAsync(250);

    expect(adapter.loads).toHaveLength(2);
    expect(new URL(adapter.loads[1]!.contentId).searchParams.get("generation")).toBe(
      "2",
    );
    vi.useRealTimers();
  });
});
