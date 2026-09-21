import type { CastMediaRequest, CastTrack } from "./castTypes";
import type { PlayerTrack } from "./playerTypes";
import { playbackURL } from "./playbackURL";

export type CastQuality = "auto" | "original" | string;

export interface CastMediaOptions {
  origin: string;
  mediaBase: string;
  sessionId: string;
  generation: number;
  start: number;
  duration: number;
  title: string;
  quality: CastQuality;
  color: "hdr" | "sdr";
  sourceHDR: boolean;
  audio?: number;
  subtitle?: number;
  subtitleTracks: PlayerTrack[];
  autoplay: boolean;
  playbackRate: number;
  playbackToken?: string;
}

const subtitleTrackOffset = 100_000;

function absoluteURL(origin: string, path: string): string {
  return new URL(path, origin).toString();
}

function castTracks(options: CastMediaOptions): CastTrack[] {
  const query = new URLSearchParams({
    session: options.sessionId,
    generation: String(options.generation),
    start: options.start.toFixed(3),
  });
  return [
    ...options.subtitleTracks.map((track) => ({
      id: subtitleTrackOffset + track.index,
      type: "text" as const,
      contentId: absoluteURL(
        options.origin,
        playbackURL(
          `${options.mediaBase}/subtitles/${track.index}.vtt?${query}`,
          options.playbackToken,
        ),
      ),
      contentType: "text/vtt",
      name: track.name || `Subtitle ${track.index}`,
      language: track.language || "und",
    })),
  ];
}

export function subtitleCastTrackId(index: number): number {
  return subtitleTrackOffset + index;
}

export function buildCastMediaRequest(
  options: CastMediaOptions,
): CastMediaRequest {
  const query = new URLSearchParams({
    session: options.sessionId,
    generation: String(options.generation),
    start: options.start.toFixed(3),
    color: options.color,
  });
  if (options.sourceHDR) query.set("sourceHDR", "1");
  if (options.audio !== undefined) query.set("audio", String(options.audio));
  if (options.quality !== "auto" && options.quality !== "original") {
    query.set("quality", options.quality);
  }
  const master =
    options.quality === "original"
      ? `${options.mediaBase}/hls/original/master.m3u8`
      : `${options.mediaBase}/hls/master.m3u8`;
  const tracks = castTracks(options);
  const activeTrackIds = [
    ...(options.subtitle === undefined
      ? []
      : [subtitleCastTrackId(options.subtitle)]),
  ];
  const fmp4Video = options.quality === "original" || options.color === "hdr";
  return {
    contentId: absoluteURL(
      options.origin,
      playbackURL(`${master}?${query}`, options.playbackToken),
    ),
    contentType: "application/x-mpegURL",
    title: options.title,
    duration: options.duration,
    autoplay: options.autoplay,
    currentTime: 0,
    playbackRate: options.playbackRate,
    hlsSegmentFormat: options.quality === "original" ? "fmp4" : "aac",
    hlsVideoSegmentFormat: fmp4Video ? "fmp4" : "mpeg2-ts",
    tracks,
    activeTrackIds,
  };
}
