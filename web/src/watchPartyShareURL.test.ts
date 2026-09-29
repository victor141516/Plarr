import { describe, expect, it } from "vitest";
import { watchPartyShareURL } from "./watchPartyShareURL";

describe("watchPartyShareURL", () => {
  it("keeps the room and grant while removing Nestrr-only player context", () => {
    const url = watchPartyShareURL(
      "https://plarr.example/#/play/file?room=abc&playbackToken=grant&title=Film&parentOrigin=https%3A%2F%2Fnestrr.example&contentId=movie%3A7",
    );
    const params = new URLSearchParams(new URL(url).hash.split("?")[1]);
    expect(params.get("room")).toBe("abc");
    expect(params.get("playbackToken")).toBe("grant");
    expect(params.get("title")).toBe("Film");
    expect(params.has("parentOrigin")).toBe(false);
    expect(params.has("contentId")).toBe(false);
  });
});
