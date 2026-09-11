import { describe, expect, it } from "vitest";
import {
  declaredLanguageLabel,
  formatMediaTime,
  playerTitle,
} from "./playerPresentation";

describe("player presentation metadata", () => {
  it("prefers the localized catalog title over embedded and physical names", () => {
    const params = new URLSearchParams({ title: "Interstellar" });
    expect(
      playerTitle(
        params,
        "Interstellar [release.example]",
        "Movies/Interstellar [release.example].mkv",
      ),
    ).toBe("Interstellar");
  });

  it("falls back safely when no catalog title was supplied", () => {
    expect(
      playerTitle(new URLSearchParams(), "Embedded title", "Movies/file.mkv"),
    ).toBe("Embedded title");
    expect(
      playerTitle(new URLSearchParams(), undefined, "Movies/file.mkv"),
    ).toBe("file.mkv");
  });

  it("shows the declared language code and makes missing declarations explicit", () => {
    expect(declaredLanguageLabel("spa")).toBe("SPA");
    expect(declaredLanguageLabel("eng")).toBe("ENG");
    expect(declaredLanguageLabel("und")).toBe("Not declared");
    expect(declaredLanguageLabel()).toBe("Not declared");
  });

  it("formats finite durations without leaking invalid values", () => {
    expect(formatMediaTime(65)).toBe("1:05");
    expect(formatMediaTime(3665)).toBe("1:01:05");
    expect(formatMediaTime(Number.NaN)).toBe("0:00");
  });
});
