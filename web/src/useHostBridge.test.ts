// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/vue";
import { defineComponent, shallowRef } from "vue";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useHostBridge } from "./useHostBridge";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function mountBridge(trustedValue = true) {
  let bridge: ReturnType<typeof useHostBridge> | undefined;
  const trusted = shallowRef(trustedValue);
  const video = shallowRef<HTMLVideoElement | null>(null);
  const view = render(
    defineComponent({
      setup() {
        bridge = useHostBridge({
          video,
          current: shallowRef(12),
          duration: shallowRef(120),
          trusted,
          parentOrigin: "https://host.example",
          mediaPath: "film.mkv",
          heartbeatMilliseconds: 1000,
        });
        return () => null;
      },
    }),
  );
  return { bridge: bridge!, trusted, video, view };
}

describe("useHostBridge", () => {
  it("sends the public envelope only after the parent is trusted", () => {
    const postMessage = vi
      .spyOn(window, "postMessage")
      .mockImplementation(() => undefined);
    const { bridge, trusted } = mountBridge(false);

    bridge.send("play");
    trusted.value = true;
    bridge.send("play");

    expect(postMessage).toHaveBeenCalledOnce();
    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        source: "plarr",
        version: 1,
        type: "play",
        positionSeconds: 12,
        durationSeconds: 120,
      }),
      "https://host.example",
    );
  });

  it("stops heartbeat work when its component unmounts", () => {
    vi.useFakeTimers();
    const { bridge, view } = mountBridge();
    bridge.startHeartbeat();
    expect(vi.getTimerCount()).toBe(1);

    view.unmount();

    expect(vi.getTimerCount()).toBe(0);
  });

  it("emits heartbeats only while media is actively playing", () => {
    vi.useFakeTimers();
    const postMessage = vi
      .spyOn(window, "postMessage")
      .mockImplementation(() => undefined);
    const { bridge, video } = mountBridge();
    video.value = { paused: false, ended: false } as HTMLVideoElement;

    bridge.startHeartbeat();
    vi.advanceTimersByTime(1000);
    video.value = { paused: true, ended: false } as HTMLVideoElement;
    vi.advanceTimersByTime(1000);

    expect(postMessage).toHaveBeenCalledOnce();
    expect(postMessage.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({ type: "heartbeat" }),
    );
  });

  it("reports reload lifecycle without presenting it as an explicit close", () => {
    const postMessage = vi
      .spyOn(window, "postMessage")
      .mockImplementation(() => undefined);
    mountBridge();

    window.dispatchEvent(new Event("beforeunload"));

    expect(postMessage).toHaveBeenCalledOnce();
    expect(postMessage.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({ type: "page-hidden" }),
    );
  });

  it("keeps closed for an explicit player action", () => {
    const postMessage = vi
      .spyOn(window, "postMessage")
      .mockImplementation(() => undefined);
    const closeWindow = vi.spyOn(window, "close").mockImplementation(() => undefined);
    const { bridge } = mountBridge();

    bridge.close();

    expect(postMessage).toHaveBeenCalledOnce();
    expect(postMessage.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({ type: "closed" }),
    );
    expect(closeWindow).toHaveBeenCalledOnce();
  });
});
