import { describe, expect, it } from "vitest";
import { chooseTrack, eventId, normalized } from "./protocol";
describe("deterministic tracks", () => {
  it("ignores accents and case", () =>
    expect(normalized("Español")).toBe("espanol"));
  it("matches BCP 47 preferences to ISO 639 track tags", () =>
    expect(
      chooseTrack(
        [
          { index: 1, language: "eng" },
          { index: 2, language: "spa" },
        ],
        "es-ES",
      )?.index,
    ).toBe(2));
  it("uses exact title among same-language tracks", () =>
    expect(
      chooseTrack(
        [
          { index: 2, language: "es", name: "Latinoamericano" },
          { index: 1, language: "es", name: "Español de España" },
        ],
        "es",
        "español de españa",
      )?.index,
    ).toBe(1));
  it("sorts deterministically without a title match", () =>
    expect(
      chooseTrack(
        [
          { index: 2, language: "es", name: "Z" },
          { index: 1, language: "es", name: "A" },
        ],
        "es",
        "Other",
      )?.index,
    ).toBe(1));
});
describe("event identifiers", () => {
  it("creates a UUID-shaped identifier", () =>
    expect(eventId()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    ));
});
