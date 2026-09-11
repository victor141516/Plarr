// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/vue";
import { computed, defineComponent, h, ref } from "vue";
import { afterEach, describe, expect, it, vi } from "vitest";
import { usePlayerInteractions } from "./usePlayerInteractions";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("usePlayerInteractions", () => {
  it("owns keyboard, volume and overlay interactions behind a small API", async () => {
    const togglePlayback = vi.fn();
    const seek = vi.fn();
    const video = document.createElement("video");
    video.volume = 0.75;
    const controls = ref(false);
    const diagnosticsOpen = ref(false);
    let interactions!: ReturnType<typeof usePlayerInteractions>;

    render(
      defineComponent({
        setup() {
          interactions = usePlayerInteractions({
            video: ref(video),
            current: ref(40),
            playing: ref(false),
            controls,
            diagnosticsOpen,
            diagnosticsCopied: ref(false),
            menu: ref("quality"),
            volume: ref(0.75),
            muted: ref(false),
            diagnosticCopyText: computed(() => "diagnostics"),
            togglePlayback,
            seek,
          });
          return () => h("div");
        },
      }),
    );

    await fireEvent.keyDown(window, { key: " ", code: "Space" });
    await fireEvent.keyUp(window, { key: " ", code: "Space" });
    expect(togglePlayback).toHaveBeenCalledOnce();
    await fireEvent.keyDown(window, { key: "ArrowRight", code: "ArrowRight" });
    expect(seek).toHaveBeenCalledWith(45);

    interactions.toggleMute();
    expect(video.muted).toBe(true);
    interactions.toggleDiagnostics();
    expect(diagnosticsOpen.value).toBe(true);
    expect(controls.value).toBe(true);
  });

  it("treats a short Space as play/pause and a held Space as temporary 2×", async () => {
    vi.useFakeTimers();
    const togglePlayback = vi.fn();
    const video = document.createElement("video");
    Object.defineProperty(video, "paused", { configurable: true, value: false });
    const play = vi.spyOn(video, "play").mockResolvedValue();
    const pause = vi.spyOn(video, "pause").mockImplementation(() => undefined);

    render(
      defineComponent({
        setup() {
          usePlayerInteractions({
            video: ref(video),
            current: ref(0),
            playing: ref(true),
            controls: ref(true),
            diagnosticsOpen: ref(false),
            diagnosticsCopied: ref(false),
            menu: ref(""),
            volume: ref(1),
            muted: ref(false),
            diagnosticCopyText: computed(() => ""),
            togglePlayback,
            seek: vi.fn(),
          });
          return () => h("div");
        },
      }),
    );

    await fireEvent.keyDown(window, { key: " ", code: "Space" });
    await fireEvent.keyUp(window, { key: " ", code: "Space" });
    expect(togglePlayback).toHaveBeenCalledOnce();

    video.playbackRate = 1.25;
    await fireEvent.keyDown(window, { key: " ", code: "Space" });
    await vi.advanceTimersByTimeAsync(350);
    expect(video.playbackRate).toBe(2);
    await fireEvent.keyUp(window, { key: " ", code: "Space" });
    expect(video.playbackRate).toBe(1.25);
    expect(togglePlayback).toHaveBeenCalledOnce();
    expect(play).not.toHaveBeenCalled();
    expect(pause).not.toHaveBeenCalled();
  });

  it("plays a paused video at 2× while the surface is held and restores it", async () => {
    vi.useFakeTimers();
    const video = document.createElement("video");
    let paused = true;
    Object.defineProperty(video, "paused", {
      configurable: true,
      get: () => paused,
    });
    vi.spyOn(video, "play").mockImplementation(async () => {
      paused = false;
    });
    const pause = vi.spyOn(video, "pause").mockImplementation(() => {
      paused = true;
    });
    let interactions!: ReturnType<typeof usePlayerInteractions>;
    const togglePlayback = vi.fn();

    render(
      defineComponent({
        setup() {
          interactions = usePlayerInteractions({
            video: ref(video),
            current: ref(0),
            playing: ref(false),
            controls: ref(true),
            diagnosticsOpen: ref(false),
            diagnosticsCopied: ref(false),
            menu: ref(""),
            volume: ref(1),
            muted: ref(false),
            diagnosticCopyText: computed(() => ""),
            togglePlayback,
            seek: vi.fn(),
          });
          return () => h("div");
        },
      }),
    );

    interactions.beginSurfacePress({
      pointerType: "mouse",
      button: 0,
      pointerId: 1,
      currentTarget: document.createElement("div"),
    } as unknown as PointerEvent);
    await vi.advanceTimersByTimeAsync(350);
    expect(video.playbackRate).toBe(2);
    expect(paused).toBe(false);

    interactions.endSurfacePress({ pointerType: "mouse" } as PointerEvent);
    expect(video.playbackRate).toBe(1);
    expect(pause).toHaveBeenCalledOnce();
    interactions.surfaceClick();
    expect(togglePlayback).not.toHaveBeenCalled();
  });

  it("hides visible controls instead of pausing on a mobile surface tap", () => {
    const togglePlayback = vi.fn();
    const controls = ref(true);
    let interactions!: ReturnType<typeof usePlayerInteractions>;

    render(
      defineComponent({
        setup() {
          interactions = usePlayerInteractions({
            video: ref(document.createElement("video")),
            current: ref(20),
            playing: ref(true),
            controls,
            diagnosticsOpen: ref(false),
            diagnosticsCopied: ref(false),
            menu: ref(""),
            volume: ref(1),
            muted: ref(false),
            diagnosticCopyText: computed(() => ""),
            togglePlayback,
            seek: vi.fn(),
          });
          return () => h("div");
        },
      }),
    );

    const surface = document.createElement("div");
    surface.getBoundingClientRect = () =>
      ({ left: 0, width: 400 } as DOMRect);
    interactions.beginSurfacePress({
      pointerType: "touch",
      currentTarget: surface,
    } as unknown as PointerEvent);
    interactions.endSurfacePress({
      pointerType: "touch",
      currentTarget: surface,
      clientX: 200,
    } as unknown as PointerEvent);
    interactions.surfaceClick();

    expect(controls.value).toBe(false);
    expect(togglePlayback).not.toHaveBeenCalled();
  });

  it("starts playback from a mobile surface tap while paused", () => {
    const togglePlayback = vi.fn();
    let interactions!: ReturnType<typeof usePlayerInteractions>;

    render(
      defineComponent({
        setup() {
          interactions = usePlayerInteractions({
            video: ref(document.createElement("video")),
            current: ref(20),
            playing: ref(false),
            controls: ref(true),
            diagnosticsOpen: ref(false),
            diagnosticsCopied: ref(false),
            menu: ref(""),
            volume: ref(1),
            muted: ref(false),
            diagnosticCopyText: computed(() => ""),
            togglePlayback,
            seek: vi.fn(),
          });
          return () => h("div");
        },
      }),
    );

    const surface = document.createElement("div");
    surface.getBoundingClientRect = () =>
      ({ left: 0, width: 400 } as DOMRect);
    interactions.beginSurfacePress({
      pointerType: "touch",
      currentTarget: surface,
    } as unknown as PointerEvent);
    interactions.endSurfacePress({
      pointerType: "touch",
      currentTarget: surface,
      clientX: 200,
    } as unknown as PointerEvent);
    interactions.surfaceClick();

    expect(togglePlayback).toHaveBeenCalledOnce();
  });

  it("automatically hides mobile controls five seconds after playback starts", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({ matches: true })),
    );
    const playing = ref(false);
    const controls = ref(true);

    render(
      defineComponent({
        setup() {
          usePlayerInteractions({
            video: ref(document.createElement("video")),
            current: ref(0),
            playing,
            controls,
            diagnosticsOpen: ref(false),
            diagnosticsCopied: ref(false),
            menu: ref(""),
            volume: ref(1),
            muted: ref(false),
            diagnosticCopyText: computed(() => ""),
            togglePlayback: vi.fn(),
            seek: vi.fn(),
          });
          return () => h("div");
        },
      }),
    );

    playing.value = true;
    await vi.advanceTimersByTimeAsync(4999);
    expect(controls.value).toBe(true);
    await vi.advanceTimersByTimeAsync(1);
    expect(controls.value).toBe(false);
  });

  it("puts the complete player in fullscreen when the video is nested in its crop frame", async () => {
    const player = document.createElement("main");
    player.className = "player";
    const surface = document.createElement("div");
    surface.className = "video-surface";
    const frame = document.createElement("div");
    frame.className = "video-frame";
    const video = document.createElement("video");
    frame.appendChild(video);
    surface.appendChild(frame);
    player.appendChild(surface);
    document.body.appendChild(player);

    const requestPlayerFullscreen = vi.fn().mockResolvedValue(undefined);
    const requestFrameFullscreen = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(player, "requestFullscreen", {
      configurable: true,
      value: requestPlayerFullscreen,
    });
    Object.defineProperty(frame, "requestFullscreen", {
      configurable: true,
      value: requestFrameFullscreen,
    });
    Object.defineProperty(document, "fullscreenElement", {
      configurable: true,
      value: null,
    });

    let interactions!: ReturnType<typeof usePlayerInteractions>;
    render(
      defineComponent({
        setup() {
          interactions = usePlayerInteractions({
            video: ref(video),
            current: ref(0),
            playing: ref(false),
            controls: ref(true),
            diagnosticsOpen: ref(false),
            diagnosticsCopied: ref(false),
            menu: ref(""),
            volume: ref(1),
            muted: ref(false),
            diagnosticCopyText: computed(() => ""),
            togglePlayback: vi.fn(),
            seek: vi.fn(),
          });
          return () => h("div");
        },
      }),
    );

    await interactions.fullscreen();

    expect(requestPlayerFullscreen).toHaveBeenCalledOnce();
    expect(requestFrameFullscreen).not.toHaveBeenCalled();
    player.remove();
  });
});
