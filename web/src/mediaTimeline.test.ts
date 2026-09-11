import { describe, expect, it } from "vitest";
import {
  absoluteTimeForMedia,
  bufferedRangesForTimeline,
  mediaTimeForAbsolute,
} from "./mediaTimeline";

describe("media timestamp normalization", () => {
  it("maps a non-zero MPEG-TS origin to the beginning of the visible timeline", () => {
    expect(mediaTimeForAbsolute(0, 0, 1.4)).toBe(1.4);
    expect(absoluteTimeForMedia(1.4, 0, 1.4)).toBe(0);
  });

  it("preserves absolute time inside a seek window", () => {
    expect(mediaTimeForAbsolute(3600, 3594, 1.4)).toBeCloseTo(7.4);
    expect(absoluteTimeForMedia(7.4, 3594, 1.4)).toBeCloseTo(3600);
  });

  it("maps and clips buffered media ranges onto the full programme timeline", () => {
    expect(
      bufferedRangesForTimeline(
        [
          { start: 1.4, end: 61.4 },
          { start: 91.4, end: 121.4 },
        ],
        4000,
        3594,
        1.4,
      ),
    ).toEqual([
      { start: 3594, end: 3654 },
      { start: 3684, end: 3714 },
    ]);

    expect(
      bufferedRangesForTimeline([{ start: 0, end: 30 }], 20, 0, 0),
    ).toEqual([{ start: 0, end: 20 }]);
  });
});
