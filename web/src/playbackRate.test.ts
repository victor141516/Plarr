import { describe, expect, it } from "vitest";
import {
  closestPlaybackRateIndex,
  playbackRateLabel,
  playbackRateSteps,
} from "./playbackRate";

describe("playback rates", () => {
  it("exposes the requested discrete speed scale", () => {
    expect(playbackRateSteps).toEqual([
      0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3,
    ]);
  });

  it("maps arbitrary values to the nearest slider position", () => {
    expect(closestPlaybackRateIndex(1.62)).toBe(5);
    expect(closestPlaybackRateIndex(2.8)).toBe(9);
    expect(playbackRateLabel(1.25)).toBe("1.25×");
  });
});
