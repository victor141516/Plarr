import { describe, expect, it } from "vitest";
import { playbackURL } from "./playbackURL";

describe("playbackURL", () => {
  it("adds the grant without exposing it when authentication is disabled", () => {
    expect(playbackURL("/media/id/probe", "")).toBe("/media/id/probe");
    expect(playbackURL("/media/id/probe", "a token")).toBe(
      "/media/id/probe?playback_token=a%20token",
    );
    expect(playbackURL("/media/id/master?start=1", "token")).toBe(
      "/media/id/master?start=1&playback_token=token",
    );
  });
});
