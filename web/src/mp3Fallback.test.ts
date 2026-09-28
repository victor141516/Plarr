import { describe, expect, it } from "vitest";
import { shouldRetryMP3WithAAC } from "./mp3Fallback";

describe("MP3 compatibility fallback", () => {
  const request = {
    selectedCodec: "mp3", mp3CopyActive: true, alreadyRetried: false,
    failure: "decode" as const,
  };

  it("retries a copied MP3 track after a decoder failure", () => {
    expect(shouldRetryMP3WithAAC(request)).toBe(true);
  });

  it("does not retry repeatedly or mistake network failures for codec failures", () => {
    expect(shouldRetryMP3WithAAC({ ...request, alreadyRetried: true })).toBe(false);
    expect(shouldRetryMP3WithAAC({ ...request, failure: "network" })).toBe(false);
    expect(shouldRetryMP3WithAAC({ ...request, failure: "other" })).toBe(false);
  });

  it("does not alter AAC or an MP3 track already converted to AAC", () => {
    expect(shouldRetryMP3WithAAC({ ...request, selectedCodec: "aac" })).toBe(false);
    expect(shouldRetryMP3WithAAC({ ...request, mp3CopyActive: false })).toBe(false);
  });
});
