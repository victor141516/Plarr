import { describe, expect, it } from "vitest";
import {
  playbackNeedsPreviewPriority,
  timelinePreviewBufferThreshold,
} from "./previewPlaybackPriority";

describe("timeline preview playback priority", () => {
  it("suspends preview work while active playback has less than 30 seconds buffered", () => {
    expect(playbackNeedsPreviewPriority(0, false, true)).toBe(true);
    expect(playbackNeedsPreviewPriority(29.9, true, false)).toBe(true);
    expect(
      playbackNeedsPreviewPriority(
        timelinePreviewBufferThreshold,
        true,
        false,
      ),
    ).toBe(false);
  });

  it("allows preview work while playback is paused", () => {
    expect(playbackNeedsPreviewPriority(0, false, false)).toBe(false);
  });
});
