// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { BrowserCastAdapter, resetCastSDKForTests } from "./castSdk";
import type { CastMediaRequest } from "./castTypes";

function eventTarget<T extends Record<string, unknown>>(values: T) {
  return Object.assign(values, {
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });
}

afterEach(() => {
  delete (window as any).cast;
  delete (window as any).chrome;
  delete (window as any).__onGCastApiAvailable;
  resetCastSDKForTests();
});

describe("BrowserCastAdapter", () => {
  it("maps Plarr media and track controls onto the official Cast APIs", async () => {
    const editTracksInfo = vi.fn(
      (_request: unknown, success: () => void) => success(),
    );
    const mediaSession = { idleReason: "", editTracksInfo };
    const loadMedia = vi.fn(async (_request: unknown) => undefined);
    const session = {
      loadMedia,
      getCastDevice: () => ({ friendlyName: "Living room" }),
      getMediaSession: () => mediaSession,
    };
    const context = eventTarget({
      setOptions: vi.fn(),
      requestSession: vi.fn(async () => undefined),
      getCurrentSession: () => session,
      getCastState: () => "CONNECTED",
    });
    const player = {
      isConnected: true,
      isMediaLoaded: false,
      isPaused: true,
      currentTime: 0,
      duration: 0,
      volumeLevel: 1,
      isMuted: false,
      playerState: "IDLE",
    };
    const controller = eventTarget({
      playOrPause: vi.fn(),
      seek: vi.fn(),
      setVolumeLevel: vi.fn(),
      muteOrUnmute: vi.fn(),
      stop: vi.fn(),
    });

    function MediaInfo(this: Record<string, unknown>, id: string, type: string) {
      this.contentId = id;
      this.contentType = type;
    }
    function Metadata(this: Record<string, unknown>) {}
    function Track(this: Record<string, unknown>, id: number, type: string) {
      this.trackId = id;
      this.type = type;
    }
    function LoadRequest(this: Record<string, unknown>, media: unknown) {
      this.media = media;
    }
    function EditTracksInfoRequest(
      this: Record<string, unknown>,
      activeTrackIds: number[],
    ) {
      this.activeTrackIds = activeTrackIds;
    }

    (window as any).cast = {
      framework: {
        CastContext: { getInstance: () => context },
        CastState: {
          CONNECTED: "CONNECTED",
          CONNECTING: "CONNECTING",
          NO_DEVICES_AVAILABLE: "NO_DEVICES_AVAILABLE",
        },
        CastContextEventType: {
          CAST_STATE_CHANGED: "caststatechanged",
          SESSION_STATE_CHANGED: "sessionstatechanged",
        },
        RemotePlayer: function RemotePlayer() {
          return player;
        },
        RemotePlayerController: function RemotePlayerController() {
          return controller;
        },
        RemotePlayerEventType: { ANY_CHANGE: "anychanged" },
      },
    };
    (window as any).chrome = {
      cast: {
        AutoJoinPolicy: { ORIGIN_SCOPED: "origin_scoped" },
        media: {
          DEFAULT_MEDIA_RECEIVER_APP_ID: "CC1AD845",
          MediaInfo,
          StreamType: { BUFFERED: "BUFFERED" },
          HlsSegmentFormat: { FMP4: "FMP4", AAC: "AAC" },
          HlsVideoSegmentFormat: { FMP4: "FMP4", MPEG2_TS: "MPEG2_TS" },
          GenericMediaMetadata: Metadata,
          Track,
          TrackType: { AUDIO: "AUDIO", TEXT: "TEXT" },
          TextTrackType: { SUBTITLES: "SUBTITLES" },
          LoadRequest,
          EditTracksInfoRequest,
        },
      },
    };

    const adapter = new BrowserCastAdapter();
    await adapter.initialize({
      availabilityChanged: vi.fn(),
      remoteChanged: vi.fn(),
      error: vi.fn(),
    });
    const request: CastMediaRequest = {
      contentId: "https://plarr.example/media/master.m3u8",
      contentType: "application/x-mpegURL",
      title: "Example",
      duration: 100,
      autoplay: true,
      currentTime: 3,
      playbackRate: 1.5,
      hlsSegmentFormat: "aac",
      hlsVideoSegmentFormat: "mpeg2-ts",
      tracks: [
        {
          id: 100_007,
          type: "text",
          contentId: "https://plarr.example/media/subtitles/7.vtt",
          contentType: "text/vtt",
          name: "Spanish",
          language: "es",
        },
      ],
      activeTrackIds: [100_007],
    };

    await adapter.loadMedia(request);
    adapter.setActiveTracks([]);

    const load = loadMedia.mock.calls[0]![0] as Record<string, any>;
    expect(load.playbackRate).toBe(1.5);
    expect(load.media.hlsSegmentFormat).toBe("AAC");
    expect(load.media.hlsVideoSegmentFormat).toBe("MPEG2_TS");
    expect(load.media.tracks[0]).toMatchObject({
      trackId: 100_007,
      trackContentType: "text/vtt",
      subtype: "SUBTITLES",
    });
    expect(editTracksInfo.mock.calls[0]![0]).toMatchObject({
      activeTrackIds: [],
    });
  });
});
