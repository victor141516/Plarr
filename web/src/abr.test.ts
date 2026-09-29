import { describe, expect, it } from "vitest";
import {
  chooseAffordableLevel,
  chooseAutoLevel,
  effectiveAdaptiveBandwidth,
  minimumAutoLevel,
  pinAutoLevel,
  releasePinnedAutoLevel,
  requestAutoLevel,
  shouldUseOriginal,
} from "./abr";

const levels = [
  80_000, 180_000, 350_000, 1_000_000, 2_500_000, 5_000_000, 8_000_000,
].map((bitrate) => ({ bitrate }));

describe("fast adaptive upgrades", () => {
  it("does not mistake cached HLS fragments for public-link capacity", () => {
    expect(effectiveAdaptiveBandwidth(260_000_000, 12_000_000)).toBe(12_000_000);
    expect(effectiveAdaptiveBandwidth(8_000_000, 12_000_000)).toBe(8_000_000);
    expect(effectiveAdaptiveBandwidth(0, 12_000_000)).toBe(12_000_000);
    expect(effectiveAdaptiveBandwidth(8_000_000, 0)).toBe(8_000_000);
  });
  it("starts and stays at a browser-compatible HDR rung", () => {
    const renditions = [240, 360, 480, 720].map((height) => ({ height }));
    expect(minimumAutoLevel(renditions, "hdr")).toBe(2);
    expect(minimumAutoLevel([...renditions].reverse(), "hdr")).toBe(2);
    expect(minimumAutoLevel(renditions, "sdr")).toBe(0);
  });
  it("jumps directly to the highest affordable rung once there is transition headroom", () =>
    expect(chooseAutoLevel(levels, 0, 100_000_000, 6, new Map())).toBe(6));
  it("stops at the highest rung inside the safety budget", () =>
    expect(chooseAutoLevel(levels, 0, 3_000_000, 6, new Map())).toBe(3));
  it("does not upgrade before even one next-level fragment is affordable", () =>
    expect(chooseAutoLevel(levels, 0, 100_000, 1, new Map())).toBe(0));
  it("waits for enough old-rendition buffer to cover a cold transcode switch", () => {
    expect(chooseAutoLevel(levels, 0, 100_000_000, 3, new Map())).toBe(0);
    expect(chooseAutoLevel(levels, 0, 12_000_000, 0.7, new Map())).toBe(0);
  });
  it("avoids a level that has failed twice", () =>
    expect(chooseAutoLevel(levels, 1, 100_000_000, 6, new Map([[2, 2]]))).toBe(
      1,
    ));

  it("selects the best affordable rung in either direction", () => {
    expect(chooseAffordableLevel(levels, 3_000_000, 6, new Map())).toBe(3);
    expect(chooseAffordableLevel(levels, 100_000_000, 6, new Map())).toBe(6);
  });

  it("stops before a repeatedly failing rung", () =>
    expect(
      chooseAffordableLevel(levels, 100_000_000, 6, new Map([[4, 2]])),
    ).toBe(3));

  it("requests one non-destructive automatic switch without manual mode", () => {
    const controller = { autoLevelCapping: 0, nextAutoLevel: 0 };
    requestAutoLevel(controller, 6);
    expect(controller).toEqual({ autoLevelCapping: 6, nextAutoLevel: 6 });
  });
});

describe("automatic original quality", () => {
  it("does not trust a cached-fragment throughput spike over the independent network probe", () =>
    expect(
      shouldUseOriginal(200_000_000, 63_000_000, 5, 0, 100, 5_000_000),
    ).toBe(false));
  it("allows Original when both independent measurements have ample margin", () =>
    expect(
      shouldUseOriginal(150_000_000, 63_000_000, 5, 0, 100, 120_000_000),
    ).toBe(true));
  it("requires a recent independent probe before selecting Original automatically", () =>
    expect(
      shouldUseOriginal(150_000_000, 63_000_000, 5, 0, 100, 0),
    ).toBe(false));
  it("uses original when measured bandwidth has a 50% margin", () =>
    expect(shouldUseOriginal(6_000_000, 4_000_000, 5, 0, 100)).toBe(true));
  it("waits for a useful buffer before leaving adaptive HLS", () =>
    expect(shouldUseOriginal(20_000_000, 4_000_000, 2, 0, 100)).toBe(false));
  it("respects the cooldown after an original stream stalls", () =>
    expect(shouldUseOriginal(20_000_000, 4_000_000, 5, 200, 100)).toBe(false));

  it("pins an authorized Original level until the automatic guard releases it", () => {
    const controller = {
      autoLevelCapping: 0,
      nextAutoLevel: 0,
      nextLevel: -1,
    };
    pinAutoLevel(controller, 7);
    expect(controller).toEqual({
      autoLevelCapping: 7,
      nextAutoLevel: 7,
      nextLevel: 7,
    });
    releasePinnedAutoLevel(controller);
    expect(controller.nextLevel).toBe(-1);
  });
});
