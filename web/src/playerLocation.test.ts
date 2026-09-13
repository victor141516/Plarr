import { describe, expect, it } from "vitest";
import { parsePlayerLocation } from "./playerLocation";

function encodePath(value: string) {
  return btoa(value).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

describe("parsePlayerLocation", () => {
  it("decodes the media path and keeps public routing parameters", () => {
    const id = encodePath("Movies/Arrival.mkv");
    const parsed = parsePlayerLocation(
      `#/play/${id}?parentOrigin=https%3A%2F%2Fnestrr.test&quality=original&hasPrevious=1&hasNext=0`,
    );
    expect(parsed.mediaPath).toBe("Movies/Arrival.mkv");
    expect(parsed.parentOrigin).toBe("https://nestrr.test");
    expect(parsed.params.get("quality")).toBe("original");
    expect(parsed.hasPrevious).toBe(true);
    expect(parsed.hasNext).toBe(false);
    expect(parsed.base).toBe(`/api/v1/media/${id}`);
  });

  it("returns an empty id outside the player route", () => {
    const parsed = parsePlayerLocation("#/settings");
    expect(parsed.mediaId).toBe("");
    expect(parsed.hasPrevious).toBe(false);
    expect(parsed.hasNext).toBe(false);
  });
});
