import { describe, expect, it } from "vitest";
import { runMockCastReceiver } from "./castMockReceiver";
import type { CastMediaRequest } from "./castTypes";

const liveMasterURL = (
  globalThis as {
    process?: { env?: Record<string, string | undefined> };
  }
).process?.env?.PLARR_CAST_TEST_URL;

describe.skipIf(!liveMasterURL)("live Cast media delivery", () => {
  it("lets a receiver fetch the master, playlists, and first media segments", async () => {
    const request: CastMediaRequest = {
      contentId: liveMasterURL!,
      contentType: "application/x-mpegURL",
      title: "Cast integration test",
      duration: 10,
      autoplay: true,
      currentTime: 0,
      playbackRate: 1,
      hlsSegmentFormat: "aac",
      hlsVideoSegmentFormat: "mpeg2-ts",
      tracks: [],
      activeTrackIds: [],
    };

    let result;
    try {
      result = await runMockCastReceiver(request);
    } catch (error) {
      if (!(error instanceof Error) || !error.message.includes("hls_window_expired")) {
        throw error;
      }
      const recoveredURL = new URL(request.contentId);
      recoveredURL.searchParams.set(
        "generation",
        String(Number(recoveredURL.searchParams.get("generation") || "0") + 1),
      );
      request.contentId = recoveredURL.toString();
      result = await runMockCastReceiver(request);
    }

    expect(result.requested[0]).toBe(request.contentId);
    expect(result.videoSegment).toMatch(/(?:seg|segment)-\d+\.(?:ts|m4s)(?:\?|$)/);
    expect(result.requested.length).toBeGreaterThanOrEqual(3);
  }, 60_000);
});
