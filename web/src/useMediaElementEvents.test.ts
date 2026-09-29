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
            onCodecFailure: vi.fn(() => false),
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

  it("clears a stale loading state when a ready video pauses", () => {
    const element = document.createElement("video");
    Object.defineProperty(element, "readyState", { configurable: true, value: 4 });
    const loading = shallowRef(false);
    render(defineComponent({
      setup() {
        const { attach } = useMediaElementEvents({
          video: shallowRef(element), playing: shallowRef(true), loading,
          current: shallowRef(0), duration: shallowRef(120),
          timeline: reactive({ pendingAbsolute: undefined as number | undefined, scrubbing: false }),
          getMode: () => "adaptive", absoluteTime: () => 0,
          completePendingPosition: vi.fn(), updateBufferedRanges: vi.fn(),
          applyNativeTracks: vi.fn(), syncVolumeFromElement: vi.fn(),
          scheduleOriginalFallback: vi.fn(), clearOriginalStall: vi.fn(),
          emit: vi.fn(), startHeartbeat: vi.fn(), stopHeartbeat: vi.fn(),
          armStartupWatchdog: vi.fn(), clearStartupWatchdog: vi.fn(),
          failPlayback: vi.fn(), onCodecFailure: vi.fn(() => false),
        });
        attach(element);
        return () => null;
      },
    }));
    element.dispatchEvent(new Event("waiting"));
    expect(loading.value).toBe(true);
    element.dispatchEvent(new Event("pause"));
    expect(loading.value).toBe(false);
  });

  it("lets a decoder error retry MP3 before showing a fatal media error", () => {
    const element = document.createElement("video");
    Object.defineProperty(element, "error", {
      configurable: true,
      value: { code: 3, message: "Unsupported MP3" },
    });
    const onCodecFailure = vi.fn(() => true);
    const failPlayback = vi.fn();
    render(defineComponent({
      setup() {
        const { attach } = useMediaElementEvents({
          video: shallowRef(element), playing: shallowRef(false),
          loading: shallowRef(true), current: shallowRef(0), duration: shallowRef(120),
          timeline: reactive({ pendingAbsolute: 0 as number | undefined, scrubbing: false }),
          getMode: () => "original-hls", absoluteTime: () => 0,
          completePendingPosition: vi.fn(), updateBufferedRanges: vi.fn(),
          applyNativeTracks: vi.fn(), syncVolumeFromElement: vi.fn(),
          scheduleOriginalFallback: vi.fn(), clearOriginalStall: vi.fn(),
          emit: vi.fn(), startHeartbeat: vi.fn(), stopHeartbeat: vi.fn(),
          armStartupWatchdog: vi.fn(), clearStartupWatchdog: vi.fn(),
          failPlayback, onCodecFailure,
        });
        attach(element);
        return () => null;
      },
    }));
    element.dispatchEvent(new Event("error"));
    expect(onCodecFailure).toHaveBeenCalledWith("Unsupported MP3");
    expect(failPlayback).not.toHaveBeenCalled();
  });
});
