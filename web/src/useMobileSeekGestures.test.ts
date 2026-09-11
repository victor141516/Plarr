// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/vue";
import { defineComponent, h, ref } from "vue";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useMobileSeekGestures } from "./useMobileSeekGestures";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function touchAt(element: HTMLElement, clientX: number): PointerEvent {
  return {
    pointerType: "touch",
    clientX,
    currentTarget: element,
  } as unknown as PointerEvent;
}

describe("useMobileSeekGestures", () => {
  it("accumulates rapid taps in a side quarter from one timeline position", () => {
    vi.useFakeTimers();
    const surface = document.createElement("div");
    surface.getBoundingClientRect = () =>
      ({ left: 0, width: 400 } as DOMRect);
    const seek = vi.fn();
    let gestures!: ReturnType<typeof useMobileSeekGestures>;

    render(
      defineComponent({
        setup() {
          gestures = useMobileSeekGestures({
            current: ref(50),
            seek,
            singleTap: vi.fn(),
            revealControls: vi.fn(),
          });
          return () => h("div");
        },
      }),
    );

    gestures.handlePointerUp(touchAt(surface, 20));
    vi.advanceTimersByTime(100);
    gestures.handlePointerUp(touchAt(surface, 20));
    vi.advanceTimersByTime(100);
    gestures.handlePointerUp(touchAt(surface, 20));

    expect(seek).toHaveBeenNthCalledWith(1, 45);
    expect(seek).toHaveBeenNthCalledWith(2, 40);
    expect(gestures.hintDirection.value).toBe("backward");
    expect(gestures.hintSeconds.value).toBe(10);

    vi.advanceTimersByTime(500);
    expect(gestures.hintDirection.value).toBeUndefined();
  });

  it("keeps a single side tap as the normal play-pause gesture", () => {
    vi.useFakeTimers();
    const surface = document.createElement("div");
    surface.getBoundingClientRect = () =>
      ({ left: 0, width: 400 } as DOMRect);
    const togglePlayback = vi.fn();
    let gestures!: ReturnType<typeof useMobileSeekGestures>;

    render(
      defineComponent({
        setup() {
          gestures = useMobileSeekGestures({
            current: ref(20),
            seek: vi.fn(),
            singleTap: togglePlayback,
            revealControls: vi.fn(),
          });
          return () => h("div");
        },
      }),
    );

    gestures.handlePointerUp(touchAt(surface, 390));
    expect(gestures.consumeSyntheticClick()).toBe(true);
    vi.advanceTimersByTime(320);
    expect(togglePlayback).toHaveBeenCalledOnce();
  });
});
