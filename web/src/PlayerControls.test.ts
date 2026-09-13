// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/vue";
import { afterEach, describe, expect, it } from "vitest";
import PlayerControls from "./PlayerControls.vue";

afterEach(cleanup);

const defaultProps = {
  visible: true,
  current: 65,
  duration: 3600,
  bufferedSeconds: 12,
  bufferedRangeStyles: [{ left: "0%", width: "10%" }],
  playedPercent: 2,
  playing: false,
  muted: false,
  volume: 1,
  audioTracks: [
    { index: 1, codec_name: "aac", codec_type: "audio", name: "Spanish" },
  ],
  subtitleTracks: [],
  quality: "Auto",
  manualLevel: -1,
  originalDescription: "1080p",
  originalAvailable: true,
  originalUnavailableReason: "",
  availableLevels: [{ height: 720, bitrate: 3_000_000 }],
  diagnosticsOpen: false,
  sourceHDR: false,
  deliveryColor: "sdr" as const,
  colorPreference: "auto" as const,
  hdrSupported: false,
  playbackRate: 1,
  timelinePreviewURL: "",
  videoFrameCrop: { top: 0, right: 0, bottom: 0, left: 0 },
  hasPrevious: true,
  hasNext: true,
  castAvailable: false,
  castConnected: false,
  castDeviceName: "",
  menu: "",
};

describe("PlayerControls", () => {
  it("shows Cast only when a receiver is available", async () => {
    const hidden = render(PlayerControls, { props: defaultProps });
    expect(hidden.queryByRole("button", { name: "Cast" })).toBeNull();
    hidden.unmount();

    const view = render(PlayerControls, {
      props: { ...defaultProps, castAvailable: true },
    });
    await fireEvent.click(view.getByRole("button", { name: "Cast" }));
    expect(view.emitted().cast).toHaveLength(1);
  });

  it("exposes typed playback actions and menu model updates", async () => {
    const view = render(PlayerControls, { props: defaultProps });

    expect(view.getByText("1:05 / 1:00:00")).toBeTruthy();
    await fireEvent.click(view.getByRole("button", { name: "Play" }));
    await fireEvent.click(view.getByRole("button", { name: "Audio tracks" }));

    expect(view.emitted().togglePlayback).toHaveLength(1);
    expect(view.emitted()["update:menu"]).toEqual([["audio"]]);
  });

  it("offers explicit five-second transport controls", async () => {
    const view = render(PlayerControls, { props: defaultProps });

    await fireEvent.click(view.getByRole("button", { name: "Back 5 seconds" }));
    await fireEvent.click(
      view.getByRole("button", { name: "Forward 5 seconds" }),
    );

    expect(view.emitted().seekBy).toEqual([[-5], [5]]);
  });

  it("only renders episode navigation that the host reports as available", () => {
    const view = render(PlayerControls, {
      props: { ...defaultProps, hasPrevious: false, hasNext: true },
    });

    expect(view.queryByRole("button", { name: "Previous episode" })).toBeNull();
    expect(view.getByRole("button", { name: "Next episode" })).toBeTruthy();
  });

  it("adjusts and resets video framing without closing its menu", async () => {
    const view = render(PlayerControls, {
      props: { ...defaultProps, menu: "framing" },
    });

    await fireEvent.click(
      view.getByRole("button", { name: "Crop more from the top" }),
    );
    expect(view.emitted().adjustVideoFrame).toEqual([["top", 1]]);
    expect(view.emitted()["update:menu"]).toBeUndefined();

    await fireEvent.click(view.getByRole("button", { name: "Reset" }));
    expect(view.emitted().resetVideoFrame).toHaveLength(1);
  });

  it("marks the framing control when any edge is adjusted", () => {
    const view = render(PlayerControls, {
      props: {
        ...defaultProps,
        videoFrameCrop: { top: 3, right: 0, bottom: 0, left: 0 },
      },
    });

    const button = view.getByRole("button", { name: "Video framing adjusted" });
    expect(button.querySelector(".framing-indicator")).toBeTruthy();
  });

  it("shows HDR controls only for HDR sources and disables unavailable original", async () => {
    const view = render(PlayerControls, {
      props: {
        ...defaultProps,
        sourceHDR: true,
        hdrSupported: true,
        originalAvailable: false,
        originalUnavailableReason: "HDR is disabled",
        menu: "quality",
      },
    });

    expect(view.getByRole("group", { name: "HDR" })).toBeTruthy();
    expect(
      view.getByRole("button", { name: "HDR Auto" }).getAttribute("aria-pressed"),
    ).toBe("true");
    expect(view.getByRole("button", { name: /Original/ })).toHaveProperty(
      "disabled",
      true,
    );
    await fireEvent.click(view.getByRole("button", { name: "HDR Off" }));
    expect(view.emitted().selectColorMode).toEqual([["sdr"]]);
    expect(view.emitted()["update:menu"]).toBeUndefined();
  });

  it("keeps quality options concise and renders the HDR state as a superscript", () => {
    const view = render(PlayerControls, {
      props: {
        ...defaultProps,
        sourceHDR: true,
        deliveryColor: "hdr",
        quality: "1080p",
        menu: "quality",
      },
    });

    const qualityButton = view.getByRole("button", { name: "1080p HDR" });
    expect(qualityButton.querySelector("sup")?.textContent).toBe("HDR");
    expect(view.queryByText("Adaptive bandwidth")).toBeNull();
    expect(view.queryByText("Bandwidth transcode")).toBeNull();
    expect(view.queryByText("Video original")).toBeNull();
  });

  it("keeps quality open for internal selections and closes on outside click", async () => {
    const view = render(PlayerControls, {
      props: {
        ...defaultProps,
        menu: "quality",
      },
    });

    await fireEvent.click(view.getByRole("button", { name: /Original/ }));
    expect(view.emitted().selectQuality).toEqual([["Original"]]);
    expect(view.emitted()["update:menu"]).toBeUndefined();

    await fireEvent.pointerDown(document.body);
    expect(view.emitted()["update:menu"]).toEqual([[""]]);
  });

  it("toggles every popover from its own button and closes it outside", async () => {
    const audio = render(PlayerControls, {
      props: { ...defaultProps, menu: "audio" },
    });
    await fireEvent.click(audio.getByRole("button", { name: "Audio tracks" }));
    expect(audio.emitted()["update:menu"]).toEqual([[""]]);
    audio.unmount();

    const quality = render(PlayerControls, {
      props: { ...defaultProps, menu: "quality" },
    });
    await fireEvent.click(quality.getByRole("button", { name: "Auto" }));
    expect(quality.emitted()["update:menu"]).toEqual([[""]]);
    quality.unmount();

    const speed = render(PlayerControls, {
      props: { ...defaultProps, menu: "speed" },
    });
    await fireEvent.pointerDown(document.body);
    expect(speed.emitted()["update:menu"]).toEqual([[""]]);
  });

  it("uses a discrete slider for playback speed", async () => {
    const view = render(PlayerControls, {
      props: { ...defaultProps, menu: "speed", playbackRate: 1.5 },
    });
    expect(
      view.getByRole("button", { name: "Playback speed, 1.5×" }),
    ).toBeTruthy();
    await fireEvent.input(view.getByRole("slider", { name: "Playback speed" }), {
      target: { value: "7" },
    });
    expect(view.emitted().selectPlaybackRate).toEqual([[2]]);
  });

  it("requests a frame for the timeline position under the pointer", async () => {
    const view = render(PlayerControls, {
      props: {
        ...defaultProps,
        duration: 100,
        timelinePreviewURL: "blob:preview",
      },
    });
    const timeline = view.getByRole("slider", { name: "Playback position" });
    const shell = timeline.parentElement!;
    shell.getBoundingClientRect = () =>
      ({ left: 10, width: 200 } as DOMRect);
    await fireEvent.pointerMove(shell, { clientX: 110 });
    const previews = view.emitted("timelinePreview") as unknown as number[][];
    expect(previews[0]?.[0]).toBe(50);
    expect(view.getByRole("img", { hidden: true }).getAttribute("src")).toBe(
      "blob:preview",
    );
    await fireEvent.pointerLeave(shell);
    expect(view.emitted().clearTimelinePreview).toHaveLength(1);
  });

  it("keeps a fixed black preview frame while its image is loading", async () => {
    const view = render(PlayerControls, {
      props: { ...defaultProps, duration: 100, timelinePreviewURL: "" },
    });
    const timeline = view.getByRole("slider", { name: "Playback position" });
    const shell = timeline.parentElement!;
    shell.getBoundingClientRect = () =>
      ({ left: 0, width: 100 } as DOMRect);
    await fireEvent.pointerMove(shell, { clientX: 50 });

    expect(view.container.querySelector(".timeline-preview-media")).toBeTruthy();
    expect(view.container.querySelector(".timeline-preview-media img")).toBeNull();
  });

  it("adds the effective color mode to the quality button only for HDR sources", () => {
    const hdr = render(PlayerControls, {
      props: {
        ...defaultProps,
        sourceHDR: true,
        deliveryColor: "sdr",
        quality: "Auto · 1080p",
      },
    });
    expect(hdr.getByRole("button", { name: "1080p SDR" })).toBeTruthy();
    hdr.unmount();

    const original = render(PlayerControls, {
      props: {
        ...defaultProps,
        sourceHDR: true,
        deliveryColor: "hdr",
        quality: "Auto · Original",
      },
    });
    expect(
      original.getByRole("button", { name: "Original HDR" }),
    ).toBeTruthy();
    original.unmount();

    const sdr = render(PlayerControls, {
      props: { ...defaultProps, quality: "Auto · 720p" },
    });
    expect(sdr.getByRole("button", { name: "Auto · 720p" })).toBeTruthy();
  });
});
