// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/vue";
import { defineComponent, shallowRef } from "vue";
import { afterEach, describe, expect, it, vi } from "vitest";
import { usePlaybackStartupWatchdog } from "./usePlaybackStartupWatchdog";

describe("usePlaybackStartupWatchdog", () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  function harness(hasPlayableBuffer = false) {
    const loading = shallowRef(true);
    const onTimeout = vi.fn();
    let arm: () => void = () => undefined;
    let clear: () => void = () => undefined;
    const view = render(
      defineComponent({
        setup() {
          ({ arm, clear } = usePlaybackStartupWatchdog({
            loading,
            timeoutMilliseconds: 1000,
            hasPlayableBuffer: () => hasPlayableBuffer,
            onTimeout,
          }));
          return () => null;
        },
      }),
    );
    return { arm, clear, loading, onTimeout, view };
  }

  it("reports a load that never produces playable media", async () => {
    vi.useFakeTimers();
    const { arm, onTimeout } = harness();
    arm();
    await vi.advanceTimersByTimeAsync(1000);
    expect(onTimeout).toHaveBeenCalledOnce();
  });

  it("does not fail a ready or superseded source", async () => {
    vi.useFakeTimers();
    const ready = harness(true);
    ready.arm();
    await vi.advanceTimersByTimeAsync(1000);
    expect(ready.onTimeout).not.toHaveBeenCalled();

    const superseded = harness();
    superseded.arm();
    superseded.clear();
    await vi.advanceTimersByTimeAsync(1000);
    expect(superseded.onTimeout).not.toHaveBeenCalled();
  });

  it("cleans up its timer when the player unmounts", async () => {
    vi.useFakeTimers();
    const { arm, onTimeout, view } = harness();
    arm();
    view.unmount();
    await vi.advanceTimersByTimeAsync(1000);
    expect(onTimeout).not.toHaveBeenCalled();
  });
});
