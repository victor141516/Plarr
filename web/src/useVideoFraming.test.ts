// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/vue";
import { defineComponent, h, ref } from "vue";
import { afterEach, describe, expect, it } from "vitest";
import { useVideoFraming, videoFrameStorageKey } from "./useVideoFraming";

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe("useVideoFraming", () => {
  it("derives a contained virtual aspect ratio instead of zooming the player", () => {
    let framing!: ReturnType<typeof useVideoFraming>;
    const sourceAspect = ref(16 / 9);
    render(
      defineComponent({
        setup() {
          framing = useVideoFraming({ sourceAspect });
          return () => h("div");
        },
      }),
    );

    framing.adjust("top", 10);
    framing.adjust("bottom", 10);
    expect(framing.crop.top).toBe(10);
    expect(Number(framing.frameStyle.value.aspectRatio)).toBeCloseTo(20 / 9);
    expect(parseFloat(String(framing.videoStyle.value.width))).toBeCloseTo(100);
    expect(parseFloat(String(framing.videoStyle.value.height))).toBeCloseTo(125);
    expect(parseFloat(String(framing.videoStyle.value.left))).toBeCloseTo(0);
    expect(parseFloat(String(framing.videoStyle.value.top))).toBeCloseTo(-12.5);
    expect(framing.videoStyle.value.transform).toBeUndefined();

    framing.reset();
    expect(framing.crop).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
    expect(Number(framing.frameStyle.value.aspectRatio)).toBeCloseTo(16 / 9);
    expect(framing.videoStyle.value).toMatchObject({
      width: "100%",
      height: "100%",
      left: "0%",
      top: "0%",
    });
  });

  it("reacts to the probed source aspect ratio", () => {
    const sourceAspect = ref(4 / 3);
    let framing!: ReturnType<typeof useVideoFraming>;
    render(
      defineComponent({
        setup() {
          framing = useVideoFraming({ sourceAspect });
          return () => h("div");
        },
      }),
    );

    expect(Number(framing.frameStyle.value.aspectRatio)).toBeCloseTo(4 / 3);
    sourceAspect.value = 2;
    expect(Number(framing.frameStyle.value.aspectRatio)).toBeCloseTo(2);
  });

  it("clamps every edge to the supported visual range", () => {
    let framing!: ReturnType<typeof useVideoFraming>;
    render(
      defineComponent({
        setup() {
          framing = useVideoFraming();
          return () => h("div");
        },
      }),
    );

    framing.adjust("left", 100);
    framing.adjust("right", -10);
    expect(framing.crop.left).toBe(40);
    expect(framing.crop.right).toBe(0);
  });

  it("restores and persists framing independently for each media item", () => {
    localStorage.setItem(
      videoFrameStorageKey("movie-one"),
      JSON.stringify({ top: 4, right: 2, bottom: 6, left: 1 }),
    );
    let first!: ReturnType<typeof useVideoFraming>;
    let second!: ReturnType<typeof useVideoFraming>;
    render(
      defineComponent({
        setup() {
          first = useVideoFraming({ mediaId: "movie-one" });
          second = useVideoFraming({ mediaId: "movie-two" });
          return () => h("div");
        },
      }),
    );

    expect(first.crop).toEqual({ top: 4, right: 2, bottom: 6, left: 1 });
    expect(second.crop).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });

    first.adjust("left", 2);
    expect(JSON.parse(
      localStorage.getItem(videoFrameStorageKey("movie-one")) || "",
    )).toEqual({ top: 4, right: 2, bottom: 6, left: 3 });
    expect(localStorage.getItem(videoFrameStorageKey("movie-two"))).toBeNull();
  });

  it("deletes persisted framing when reset", () => {
    let framing!: ReturnType<typeof useVideoFraming>;
    render(
      defineComponent({
        setup() {
          framing = useVideoFraming({ mediaId: "movie-reset" });
          return () => h("div");
        },
      }),
    );

    framing.adjust("bottom", 5);
    expect(
      localStorage.getItem(videoFrameStorageKey("movie-reset")),
    ).not.toBeNull();
    framing.reset();
    expect(framing.crop).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
    expect(localStorage.getItem(videoFrameStorageKey("movie-reset"))).toBeNull();
  });
});
