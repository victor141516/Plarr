import { describe, expect, it } from "vitest";
import {
  HLS_SEGMENT_SECONDS,
  playbackWindowStart,
  SEEK_PREROLL_SECONDS,
} from "./playbackWindow";

describe("playback generation windows", () => {
  it("uses one segment-aligned preroll for every adaptive reload", () => {
    expect(HLS_SEGMENT_SECONDS).toBe(2);
    expect(SEEK_PREROLL_SECONDS).toBe(5);
    expect(playbackWindowStart(5494.9)).toBe(5488);
    expect(playbackWindowStart(6)).toBe(0);
    expect(playbackWindowStart(7.1)).toBe(2);
  });

  it("clamps invalid or negative targets to the beginning", () => {
    expect(playbackWindowStart(-10)).toBe(0);
    expect(playbackWindowStart(Number.NaN)).toBe(0);
  });
});
