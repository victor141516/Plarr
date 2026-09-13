import { describe, expect, it } from "vitest";
import {
  buildCastMediaRequest,
  subtitleCastTrackId,
} from "./castMedia";

const baseOptions = {
  origin: "https://plarr.example.test",
  mediaBase: "/api/v1/media/movie-id",
  sessionId: "browser-session-cast",
  generation: 3,
  start: 125.25,
  duration: 7200,
  title: "Example film",
  quality: "auto" as const,
  color: "sdr" as const,
  sourceHDR: false,
  audio: 2,
  subtitle: 7,
  subtitleTracks: [
    {
      index: 7,
      codec_name: "subrip",
      codec_type: "subtitle",
      name: "Spanish",
      language: "es",
    },
  ],
  autoplay: true,
  playbackRate: 1.25,
};

describe("Cast media requests", () => {
  it("builds an absolute adaptive HLS load with an absolute timeline window", () => {
    const request = buildCastMediaRequest(baseOptions);
    const url = new URL(request.contentId);

    expect(url.pathname).toBe("/api/v1/media/movie-id/hls/master.m3u8");
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      session: "browser-session-cast",
      generation: "3",
      start: "125.250",
      color: "sdr",
      audio: "2",
    });
    expect(request.currentTime).toBe(0);
    expect(request.duration).toBe(7200);
    expect(request.playbackRate).toBe(1.25);
    expect(request.hlsSegmentFormat).toBe("aac");
    expect(request.hlsVideoSegmentFormat).toBe("mpeg2-ts");
    expect(request.activeTrackIds).toEqual([subtitleCastTrackId(7)]);
    expect(request.tracks[0]).toMatchObject({
      id: subtitleCastTrackId(7),
      contentId:
        "https://plarr.example.test/api/v1/media/movie-id/subtitles/7.vtt?session=browser-session-cast&generation=3&start=125.250",
      contentType: "text/vtt",
    });
  });

  it("uses original fMP4 HLS without requesting a video transcode", () => {
    const request = buildCastMediaRequest({
      ...baseOptions,
      quality: "original",
      color: "hdr",
      sourceHDR: true,
    });

    expect(new URL(request.contentId).pathname).toBe(
      "/api/v1/media/movie-id/hls/original/master.m3u8",
    );
    expect(request.hlsVideoSegmentFormat).toBe("fmp4");
    expect(request.hlsSegmentFormat).toBe("fmp4");
    expect(request.contentId).toContain("sourceHDR=1");
  });

  it("limits a manual Cast load to the selected rendition", () => {
    const request = buildCastMediaRequest({
      ...baseOptions,
      quality: "720p",
    });

    expect(new URL(request.contentId).searchParams.get("quality")).toBe(
      "720p",
    );
  });
});
