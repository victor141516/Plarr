// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/vue";
import { defineComponent, nextTick, shallowRef } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { usePlaybackLease } from "./usePlaybackLease";

describe("usePlaybackLease", () => {
  const active = shallowRef(true);
  const fetchMock = vi.fn(() => Promise.resolve(new Response(null, { status: 204 })));
  const sendBeaconMock = vi.fn(() => true);

  beforeEach(() => {
    vi.useFakeTimers();
    active.value = true;
    fetchMock.mockClear();
    sendBeaconMock.mockClear();
    vi.stubGlobal("fetch", fetchMock);
    Object.defineProperty(navigator, "sendBeacon", {
      configurable: true,
      value: sendBeaconMock,
    });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  function renderLease() {
    let cancelActiveJobs: () => void = () => undefined;
    let resumeActiveJobs: () => void = () => undefined;
    const view = render(
      defineComponent({
        setup() {
          ({ cancelActiveJobs, resumeActiveJobs } = usePlaybackLease({
            sessionId: "session-1",
            active,
            heartbeatMilliseconds: 1000,
          }));
          return () => null;
        },
      }),
    );
    return { view, cancelActiveJobs, resumeActiveJobs };
  }

  it("renews only while playback is active", async () => {
    renderLease();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(2000);
    expect(fetchMock).toHaveBeenCalledTimes(3);

    active.value = false;
    await nextTick();
    await vi.advanceTimersByTimeAsync(2000);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("closes the backend session when the player disappears", () => {
    const { view } = renderLease();
    view.unmount();
    expect(sendBeaconMock).toHaveBeenCalledWith(
      "/api/v1/playback/sessions/session-1/close",
      "",
    );
  });

  it("keeps a failed playback terminal until a new source load resumes it", async () => {
    const { cancelActiveJobs, resumeActiveJobs } = renderLease();
    fetchMock.mockClear();

    cancelActiveJobs();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/playback/sessions/session-1/close",
      { method: "POST", keepalive: true },
    );

    active.value = false;
    await nextTick();
    active.value = true;
    await nextTick();
    await vi.advanceTimersByTimeAsync(2000);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    resumeActiveJobs();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/playback/sessions/session-1/heartbeat",
      { method: "POST", keepalive: true },
    );
  });
});
