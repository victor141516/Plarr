import { describe, expect, it } from "vitest";
import { playerCommand } from "./keyboard";

describe("player keyboard shortcuts", () => {
  it("maps Space to play/pause", () =>
    expect(playerCommand({ key: " ", code: "Space" })).toBe("toggle-playback"));
  it("maps arrows to five-second seek commands", () => {
    expect(playerCommand({ key: "ArrowLeft" })).toBe("seek-backward");
    expect(playerCommand({ key: "ArrowRight" })).toBe("seek-forward");
  });
  it("maps either case of F to fullscreen", () => {
    expect(playerCommand({ key: "f" })).toBe("toggle-fullscreen");
    expect(playerCommand({ key: "F" })).toBe("toggle-fullscreen");
  });
  it("does not hijack typing or modified browser shortcuts", () => {
    expect(playerCommand({ key: "f", typing: true })).toBeUndefined();
    expect(playerCommand({ key: "f", ctrlKey: true })).toBeUndefined();
  });
  it("ignores repeated Space and F events", () => {
    expect(
      playerCommand({ key: " ", code: "Space", repeat: true }),
    ).toBeUndefined();
    expect(playerCommand({ key: "f", repeat: true })).toBeUndefined();
  });
});
