// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/vue";
import { defineComponent, reactive, shallowRef } from "vue";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useMediaElementEvents } from "./useMediaElementEvents";

describe("useMediaElementEvents", () => {
  afterEach(cleanup);

  it("rearms stall detection on waiting and clears it when playback stops", () => {
    const element = document.createElement("video");
    const armStartupWatchdog = vi.fn();
    const clearStartupWatchdog = vi.fn();
    const scheduleOriginalFallback = vi.fn();

    render(
      defineComponent({
        setup() {
          const { attach } = useMediaElementEvents({
            video: shallowRef(element),
            playing: shallowRef(true),
            loading: shallowRef(false),
            current: shallowRef(0),
            duration: shallowRef(120),
            timeline: reactive({
              pendingAbsolute: undefined as number | undefined,
              scrubbing: false,
            }),
            getMode: () => "adaptive",
            absoluteTime: () => 0,
            completePendingPosition: vi.fn(),
            updateBufferedRanges: vi.fn(),
            applyNativeTracks: vi.fn(),
            syncVolumeFromElement: vi.fn(),
            scheduleOriginalFallback,
            clearOriginalStall: vi.fn(),
            emit: vi.fn(),
            startHeartbeat: vi.fn(),
            stopHeartbeat: vi.fn(),
            armStartupWatchdog,
            clearStartupWatchdog,
            failPlayback: vi.fn(),
          });
          attach(element);
          return () => null;
        },
      }),
    );

    element.dispatchEvent(new Event("waiting"));
    expect(armStartupWatchdog).toHaveBeenCalledOnce();
    expect(scheduleOriginalFallback).toHaveBeenCalledOnce();

    element.dispatchEvent(new Event("pause"));
    expect(clearStartupWatchdog).toHaveBeenCalledOnce();
  });
});
