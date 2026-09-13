export type CastAvailability =
  | "unavailable"
  | "available"
  | "connecting"
  | "connected";

export interface CastTrack {
  id: number;
  type: "audio" | "text";
  contentId?: string;
  contentType?: string;
  name: string;
  language: string;
}

export interface CastMediaRequest {
  contentId: string;
  contentType: "application/x-mpegURL";
  title: string;
  duration: number;
  autoplay: boolean;
  currentTime: number;
  playbackRate: number;
  hlsSegmentFormat: "aac" | "fmp4";
  hlsVideoSegmentFormat: "fmp4" | "mpeg2-ts";
  tracks: CastTrack[];
  activeTrackIds: number[];
}

export interface CastRemoteSnapshot {
  connected: boolean;
  mediaLoaded: boolean;
  paused: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  muted: boolean;
  playerState: string;
  idleReason: string;
  deviceName: string;
}

export interface CastAdapterCallbacks {
  availabilityChanged: (availability: CastAvailability) => void;
  remoteChanged: (snapshot: CastRemoteSnapshot) => void;
  error: (message: string) => void;
}

export interface CastAdapter {
  initialize(callbacks: CastAdapterCallbacks): Promise<void>;
  requestSession(): Promise<void>;
  loadMedia(request: CastMediaRequest): Promise<void>;
  playOrPause(): void;
  seek(positionSeconds: number): void;
  setVolume(volume: number): void;
  setMuted(muted: boolean): void;
  setActiveTracks(trackIds: number[]): void;
  stop(): void;
  dispose(): void;
}
