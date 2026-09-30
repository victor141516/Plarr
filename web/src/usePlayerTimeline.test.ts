// @vitest-environment jsdom
import { shallowRef } from "vue";
import { describe, expect, it, vi } from "vitest";
import type { PlaybackMode } from "./playerTypes";
import { usePlayerTimeline } from "./usePlayerTimeline";

function ranges(values: Array<[number, number]>): TimeRanges {
  return {
    length: values.length,
    start: (index: number) => values[index]![0],
    end: (index: number) => values[index]![1],
  };
}

function player(mode: PlaybackMode, paused = false) {
  const element = document.createElement("video");
  Object.defineProperties(element, {
    paused: { configurable: true, value: paused },
    buffered: { configurable: true, value: ranges([[0, 10]]) },
    seekable: { configurable: true, value: ranges([[0, 10]]) },
  });
  const loadAdaptiveAt = vi.fn();
  const loadNativeHLSAt = vi.fn();
  const loadOriginalAt = vi.fn();
  const timeline = usePlayerTimeline({
    video: shallowRef(element),
    loading: shallowRef(true),
    getMode: () => mode,
    getAutomatic: () => true,
    loadAdaptiveAt,
    loadNativeHLSAt,
    loadOriginalAt,
  });
  timeline.duration.value = 8_000;
  return {
    element,
    timeline,
    loadAdaptiveAt,
    loadNativeHLSAt,
    loadOriginalAt,
  };
}

describe("absolute playback transitions", () => {
  it("keeps a requested HLS position pending until playable media covers it", () => {
    const state = player("adaptive");
    Object.defineProperties(state.element, {
      buffered: { configurable: true, value: ranges([]) },
      seekable: { configurable: true, value: ranges([[0, 12]]) },
    });
    state.timeline.timeline.offset = 4_994;
    state.timeline.timeline.mediaOrigin = undefined;
    state.timeline.timeline.pendingAbsolute = 5_000;

    state.timeline.completePendingPosition();

    expect(state.timeline.timeline.pendingAbsolute).toBe(5_000);
    expect(state.timeline.timeline.mediaOrigin).toBeUndefined();

    Object.defineProperty(state.element, "buffered", {
      configurable: true,
      value: ranges([[0.4, 8.4]]),
    });
    state.timeline.completePendingPosition();

    expect(state.timeline.timeline.pendingAbsolute).toBeUndefined();
    expect(state.timeline.timeline.mediaOrigin).toBe(0.4);
    expect(state.element.currentTime).toBeCloseTo(6.4);
  });

  it("maps a retained source-keyframe preroll back to the requested absolute position", () => {
    const state = player("adaptive");
    Object.defineProperties(state.element, {
      buffered: {
        configurable: true,
        value: ranges([[0.512, 10.512]]),
      },
      seekable: {
        configurable: true,
        value: ranges([[0.512, 10.512]]),
      },
    });
    state.timeline.timeline.offset = 5_462;
    state.timeline.timeline.mediaOrigin = undefined;
    state.timeline.timeline.pendingAbsolute = 5_467;

    state.timeline.completePendingPosition();

    expect(state.timeline.timeline.mediaOrigin).toBe(0.512);
    expect(state.element.currentTime).toBeCloseTo(5.512);
    expect(state.timeline.current.value).toBe(5_467);
    expect(state.timeline.timeline.pendingAbsolute).toBeUndefined();
  });

  it("does not restart playback after a seek initiated while paused", () => {
    const state = player("adaptive", true);
    const play = vi.spyOn(state.element, "play");
    state.timeline.timeline.pendingAbsolute = 5;
    state.timeline.timeline.resumeAfterLoad = false;

    state.timeline.completePendingPosition();

    expect(state.timeline.timeline.pendingAbsolute).toBeUndefined();
    expect(play).not.toHaveBeenCalled();
  });

  it.each([
    ["adaptive", "adaptive"],
    ["native-hls", "native"],
    ["original-hls", "original"],
    ["original-remux", "original"],
  ] as const)(
    "reopens %s at one absolute target when seeking outside its window",
    (mode, expected) => {
      const state = player(mode);
      state.timeline.timeline.offset = 100;
      state.timeline.timeline.mediaOrigin = 0;
      state.timeline.seek(3_600);

      if (expected === "adaptive") {
        expect(state.loadAdaptiveAt).toHaveBeenCalledWith(3_600, true);
      } else if (expected === "native") {
        expect(state.loadNativeHLSAt).toHaveBeenCalledWith(3_600, true);
      } else {
        expect(state.loadOriginalAt).toHaveBeenCalledWith(3_600, true, true);
      }
    },
  );

  it("seeks direct playback without creating another timestamp origin", () => {
    const state = player("original-direct");
    state.timeline.seek(3_600);
    expect(state.element.currentTime).toBe(3_600);
    expect(state.loadAdaptiveAt).not.toHaveBeenCalled();
    expect(state.loadOriginalAt).not.toHaveBeenCalled();
  });

  it("preserves the paused intent when a generation window must reopen", () => {
    const state = player("adaptive", true);
    state.timeline.timeline.offset = 100;
    state.timeline.seek(3_600);
    expect(state.loadAdaptiveAt).toHaveBeenCalledWith(3_600, false);
  });
});
