import type {
  CastAdapter,
  CastAdapterCallbacks,
  CastMediaRequest,
  CastRemoteSnapshot,
} from "./castTypes";

type UnknownRecord = Record<string, any>;

const sdkURL =
  "https://www.gstatic.com/cv/js/sender/v1/cast_sender.js?loadCastFramework=1";

let sdkPromise: Promise<void> | undefined;

function loadCastSDK(): Promise<void> {
  if (sdkPromise) return sdkPromise;
  sdkPromise = new Promise((resolve, reject) => {
    const global = window as Window & UnknownRecord;
    if (global.cast?.framework && global.chrome?.cast) {
      resolve();
      return;
    }
    const previous = global.__onGCastApiAvailable;
    global.__onGCastApiAvailable = (available: boolean) => {
      previous?.(available);
      if (available) resolve();
      else reject(new Error("Google Cast is unavailable in this browser."));
    };
    const existing = document.querySelector<HTMLScriptElement>(
      'script[data-plarr-cast-sdk="true"]',
    );
    if (existing) return;
    const script = document.createElement("script");
    script.src = sdkURL;
    script.async = true;
    script.dataset.plarrCastSdk = "true";
    script.onerror = () => reject(new Error("Google Cast SDK could not load."));
    document.head.appendChild(script);
  });
  return sdkPromise;
}

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  const record = error as { description?: string; code?: string } | null;
  return record?.description || record?.code || "Google Cast failed.";
}

export class BrowserCastAdapter implements CastAdapter {
  private callbacks?: CastAdapterCallbacks;
  private context?: UnknownRecord;
  private player?: UnknownRecord;
  private controller?: UnknownRecord;
  private removeListeners: Array<() => void> = [];

  async initialize(callbacks: CastAdapterCallbacks): Promise<void> {
    this.callbacks = callbacks;
    try {
      await loadCastSDK();
      const global = window as Window & UnknownRecord;
      const framework = global.cast.framework;
      const chromeCast = global.chrome.cast;
      this.context = framework.CastContext.getInstance();
      this.context!.setOptions({
        receiverApplicationId:
          chromeCast.media.DEFAULT_MEDIA_RECEIVER_APP_ID,
        autoJoinPolicy: chromeCast.AutoJoinPolicy.ORIGIN_SCOPED,
      });
      if (window.parent !== window) chromeCast.setPageContext?.(window);
      this.player = new framework.RemotePlayer();
      this.controller = new framework.RemotePlayerController(this.player);
      this.listen(
        this.context!,
        framework.CastContextEventType.CAST_STATE_CHANGED,
        () => this.publishAvailability(),
      );
      this.listen(
        this.context!,
        framework.CastContextEventType.SESSION_STATE_CHANGED,
        () => {
          this.publishAvailability();
          this.publishRemote();
        },
      );
      this.listen(
        this.controller!,
        framework.RemotePlayerEventType.ANY_CHANGE,
        () => this.publishRemote(),
      );
      this.publishAvailability();
      this.publishRemote();
    } catch {
      callbacks.availabilityChanged("unavailable");
    }
  }

  async requestSession(): Promise<void> {
    if (!this.context) throw new Error("Google Cast is not ready.");
    await this.context.requestSession();
    this.publishAvailability();
  }

  async loadMedia(request: CastMediaRequest): Promise<void> {
    const global = window as Window & UnknownRecord;
    const session = this.context?.getCurrentSession();
    if (!session) throw new Error("No Cast receiver is connected.");
    const media = new global.chrome.cast.media.MediaInfo(
      request.contentId,
      request.contentType,
    );
    media.streamType = global.chrome.cast.media.StreamType.BUFFERED;
    media.duration = request.duration;
    media.hlsSegmentFormat =
      request.hlsSegmentFormat === "fmp4"
        ? global.chrome.cast.media.HlsSegmentFormat.FMP4
        : global.chrome.cast.media.HlsSegmentFormat.AAC;
    media.hlsVideoSegmentFormat =
      request.hlsVideoSegmentFormat === "fmp4"
        ? global.chrome.cast.media.HlsVideoSegmentFormat.FMP4
        : global.chrome.cast.media.HlsVideoSegmentFormat.MPEG2_TS;
    const metadata = new global.chrome.cast.media.GenericMediaMetadata();
    metadata.title = request.title;
    media.metadata = metadata;
    media.tracks = request.tracks.map((source) => {
      const type =
        source.type === "audio"
          ? global.chrome.cast.media.TrackType.AUDIO
          : global.chrome.cast.media.TrackType.TEXT;
      const track = new global.chrome.cast.media.Track(source.id, type);
      track.name = source.name;
      track.language = source.language;
      if (source.contentId) track.trackContentId = source.contentId;
      if (source.contentType) track.trackContentType = source.contentType;
      if (source.type === "text") {
        track.subtype = global.chrome.cast.media.TextTrackType.SUBTITLES;
      }
      return track;
    });
    const load = new global.chrome.cast.media.LoadRequest(media);
    load.autoplay = request.autoplay;
    load.currentTime = request.currentTime;
    load.playbackRate = request.playbackRate;
    load.activeTrackIds = request.activeTrackIds;
    await session.loadMedia(load);
    this.publishRemote();
  }

  playOrPause(): void {
    this.controller?.playOrPause();
  }

  seek(positionSeconds: number): void {
    if (!this.player || !this.controller) return;
    this.player.currentTime = positionSeconds;
    this.controller.seek();
  }

  setVolume(volume: number): void {
    if (!this.player || !this.controller) return;
    this.player.volumeLevel = volume;
    this.controller.setVolumeLevel();
  }

  setMuted(muted: boolean): void {
    if (!this.player || !this.controller || this.player.isMuted === muted)
      return;
    this.controller.muteOrUnmute();
  }

  setActiveTracks(trackIds: number[]): void {
    const global = window as Window & UnknownRecord;
    const media = this.context?.getCurrentSession()?.getMediaSession?.();
    if (!media) return;
    const request = new global.chrome.cast.media.EditTracksInfoRequest(trackIds);
    media.editTracksInfo(
      request,
      () => this.publishRemote(),
      (error: unknown) => this.callbacks?.error(errorText(error)),
    );
  }

  stop(): void {
    this.controller?.stop();
  }

  dispose(): void {
    for (const remove of this.removeListeners.splice(0)) remove();
    this.callbacks = undefined;
  }

  private listen(target: UnknownRecord, type: string, listener: () => void) {
    target.addEventListener(type, listener);
    this.removeListeners.push(() => target.removeEventListener(type, listener));
  }

  private publishAvailability(): void {
    if (!this.callbacks || !this.context) return;
    const global = window as Window & UnknownRecord;
    const state = this.context.getCastState();
    const states = global.cast.framework.CastState;
    if (state === states.CONNECTED) this.callbacks.availabilityChanged("connected");
    else if (state === states.CONNECTING)
      this.callbacks.availabilityChanged("connecting");
    else if (state === states.NO_DEVICES_AVAILABLE)
      this.callbacks.availabilityChanged("unavailable");
    else this.callbacks.availabilityChanged("available");
  }

  private publishRemote(): void {
    if (!this.callbacks || !this.player) return;
    const device = this.context?.getCurrentSession()?.getCastDevice?.();
    const media = this.context?.getCurrentSession()?.getMediaSession?.();
    const snapshot: CastRemoteSnapshot = {
      connected: !!this.player.isConnected,
      mediaLoaded: !!this.player.isMediaLoaded,
      paused: !!this.player.isPaused,
      currentTime: Number(this.player.currentTime) || 0,
      duration: Number(this.player.duration) || 0,
      volume: Number(this.player.volumeLevel) || 0,
      muted: !!this.player.isMuted,
      playerState: String(this.player.playerState || ""),
      idleReason: String(media?.idleReason || ""),
      deviceName: String(device?.friendlyName || "Chromecast"),
    };
    this.callbacks.remoteChanged(snapshot);
  }
}

export function resetCastSDKForTests(): void {
  sdkPromise = undefined;
}
