// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/vue";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "./App.vue";

const player = vi.hoisted(() => ({
  video: null,
  loading: false,
  fatal: "",
  controls: true,
  close: vi.fn(),
  displayTitle: "The Test Film",
  playing: false,
  toggle: vi.fn(),
  diagnosticsOpen: false,
  diagnosticSections: [],
  diagnosticsCopied: false,
  closeDiagnostics: vi.fn(),
  copyDiagnostics: vi.fn(),
  menu: "",
  current: 0,
  duration: 100,
  bufferedSeconds: 10,
  bufferedRangeStyles: [],
  playedPercent: 0,
  muted: false,
  volume: 1,
  audioTracks: [],
  audio: undefined,
  subtitleTracks: [],
  subtitle: undefined,
  quality: "Auto",
  manualLevel: -1,
  originalDescription: "Original",
  originalAvailable: true,
  originalUnavailableReason: "",
  availableLevels: [],
  sourceHDR: false,
  deliveryColor: "sdr",
  colorPreference: "auto",
  hdrDeliverySupported: false,
  previewSeekEvent: vi.fn(),
  commitSeekEvent: vi.fn(),
  emit: vi.fn(),
  toggleMute: vi.fn(),
  changeVolume: vi.fn(),
  selectAudio: vi.fn(),
  selectSubtitle: vi.fn(),
  selectQuality: vi.fn(),
  selectColorMode: vi.fn(),
  toggleDiagnostics: vi.fn(),
  pip: vi.fn(),
  fullscreen: vi.fn(),
  reveal: vi.fn(),
  beginSurfacePress: vi.fn(),
  cancelSurfacePress: vi.fn(),
  endSurfacePress: vi.fn(),
  surfaceClick: vi.fn(),
  playbackRate: 1,
  mobileSeekDirection: undefined,
  mobileSeekSeconds: 0,
  setPlaybackRate: vi.fn(),
  seekRelative: vi.fn(),
  videoFrameCrop: { top: 0, right: 0, bottom: 0, left: 0 },
  videoFrameStyle: {},
  videoContentStyle: {},
  adjustVideoFrame: vi.fn(),
  resetVideoFrame: vi.fn(),
  timelinePreviewURL: "",
  previewTimeline: vi.fn(),
  clearTimelinePreview: vi.fn(),
}));

vi.mock("./usePlarrPlayer", () => ({
  usePlarrPlayer: () => player,
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("App", () => {
  it("composes the player surface and delegates its primary controls", async () => {
    render(App, {
      global: {
        stubs: {
          PlayerControls: true,
          PlaybackDiagnosticsPanel: true,
          MobileSeekHint: true,
        },
      },
    });

    expect(screen.getByText("The Test Film")).toBeTruthy();
    await fireEvent.click(screen.getByRole("button", { name: "Play" }));
    expect(player.toggle).toHaveBeenCalledOnce();
    await fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(player.close).toHaveBeenCalledOnce();
  });
});
