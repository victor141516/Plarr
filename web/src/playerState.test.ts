import { describe, expect, it } from "vitest";
import { clampVolume, manualLevelForReload, volumeGlyph } from "./playerState";

describe("manual quality across HLS reloads", () => {
  it("reapplies a pinned rendition after seeking outside the current window", () => {
    expect(manualLevelForReload(false, 1)).toBe(1);
  });
  it("leaves automatic playback uncapped", () => {
    expect(manualLevelForReload(true, 1)).toBeUndefined();
  });
  it("does not treat Original as an adaptive level", () => {
    expect(manualLevelForReload(false, -2)).toBeUndefined();
  });
});

describe("volume controls", () => {
  it("clamps slider values to the media element range", () => {
    expect(clampVolume(-1)).toBe(0);
    expect(clampVolume(0.42)).toBe(0.42);
    expect(clampVolume(2)).toBe(1);
  });
  it("shows silent, low and normal speaker states", () => {
    expect(volumeGlyph(1, true)).toBe("🔇");
    expect(volumeGlyph(0, false)).toBe("🔇");
    expect(volumeGlyph(0.2, false)).toBe("🔈");
    expect(volumeGlyph(0.8, false)).toBe("🔊");
  });
});
