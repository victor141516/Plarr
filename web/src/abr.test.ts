import { describe, expect, it } from "vitest";
import {
  chooseAffordableLevel,
  chooseAutoLevel,
  pinAutoLevel,
  releasePinnedAutoLevel,
  requestAutoLevel,
  shouldUseOriginal,
} from "./abr";

const levels = [
  80_000, 180_000, 350_000, 1_000_000, 2_500_000, 5_000_000, 8_000_000,
].map((bitrate) => ({ bitrate }));

describe("fast adaptive upgrades", () => {
  it("jumps directly to the highest affordable rung", () =>
    expect(chooseAutoLevel(levels, 0, 100_000_000, 3, new Map())).toBe(6));
  it("stops at the highest rung inside the safety budget", () =>
    expect(chooseAutoLevel(levels, 0, 3_000_000, 6, new Map())).toBe(3));
  it("does not upgrade before even one next-level fragment is affordable", () =>
    expect(chooseAutoLevel(levels, 0, 100_000, 1, new Map())).toBe(0));
  it("does not leap to a high bitrate while there is under two seconds buffered", () =>
    expect(chooseAutoLevel(levels, 0, 12_000_000, 0.7, new Map())).toBe(0));
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
