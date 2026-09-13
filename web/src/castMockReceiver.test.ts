import { describe, expect, it, vi } from "vitest";
import { runMockCastReceiver } from "./castMockReceiver";
import type { CastMediaRequest } from "./castTypes";

function response(body: string): Response {
  return new Response(body, { status: 200 });
}

describe("mock Cast receiver", () => {
  it("consumes a real HLS hierarchy progressively like a receiver", async () => {
    const origin = "https://plarr.test";
    const master = `${origin}/api/v1/media/id/hls/master.m3u8?session=cast`;
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url === master) {
        return response(
          '#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",DEFAULT=YES,URI="audio/2/index.m3u8?session=cast"\n#EXT-X-STREAM-INF:BANDWIDTH=1000000,AUDIO="audio"\n720p/index.m3u8?session=cast\n',
        );
      }
      if (url.includes("720p/index.m3u8")) {
        return response("#EXTM3U\n#EXTINF:2,\nsegment-00000.ts?session=cast\n");
      }
      if (url.includes("audio/2/index.m3u8")) {
        return response("#EXTM3U\n#EXTINF:2,\naudio-00000.aac?session=cast\n");
      }
      return new Response(new Uint8Array([1, 2, 3]), { status: 200 });
    }) as typeof fetch;
    const request = {
      contentId: master,
      contentType: "application/x-mpegURL",
      title: "Film",
      duration: 100,
      autoplay: true,
      currentTime: 0,
      playbackRate: 1,
      hlsSegmentFormat: "aac",
      hlsVideoSegmentFormat: "mpeg2-ts",
      tracks: [],
      activeTrackIds: [],
    } satisfies CastMediaRequest;

    const result = await runMockCastReceiver(request, fetcher);

    expect(result.videoSegment).toContain("segment-00000.ts");
    expect(result.audioSegment).toContain("audio-00000.aac");
    expect(result.requested).toHaveLength(5);
  });

  it("requests the fMP4 initialization fragment before media", async () => {
    const master = "https://plarr.test/original/master.m3u8";
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url === master)
        return response("#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\nvideo/index.m3u8\n");
      if (url.endsWith("video/index.m3u8"))
        return response(
          '#EXTM3U\n#EXT-X-MAP:URI="init.mp4"\n#EXTINF:2,\nsegment-00000.m4s\n',
        );
      return new Response(new Uint8Array([1]), { status: 200 });
    }) as typeof fetch;

    const result = await runMockCastReceiver(
      {
        contentId: master,
        contentType: "application/x-mpegURL",
        title: "Film",
        duration: 100,
      autoplay: true,
      currentTime: 0,
      playbackRate: 1,
        hlsSegmentFormat: "aac",
        hlsVideoSegmentFormat: "fmp4",
        tracks: [],
        activeTrackIds: [],
      },
      fetcher,
    );

    expect(result.requested).toEqual([
      master,
      "https://plarr.test/original/video/index.m3u8",
      "https://plarr.test/original/video/init.mp4",
      "https://plarr.test/original/video/segment-00000.m4s",
    ]);
  });
});
