import { describe, expect, it } from "vitest";
import { originalQualityDescription } from "./originalQuality";

describe("original quality description", () => {
  it("describes direct play without claiming a remux", () => {
    expect(
      originalQualityDescription(
        {
          format: { format_name: "mov,mp4" },
          audio: [{ index: 1, codec_name: "aac" }],
        },
        1,
        true,
      ),
    ).toBe("Video original · Audio original");
  });

  it("describes the compatibility work required by Interstellar", () => {
    expect(
      originalQualityDescription(
        {
          format: { format_name: "matroska,webm" },
          audio: [{ index: 1, codec_name: "ac3" }],
        },
        1,
        false,
      ),
    ).toBe("Video original · Audio transcoded · Remux MKV→MP4");
  });

  it("recognises a container-only remux", () => {
    expect(
      originalQualityDescription(
        {
          format: { format_name: "matroska,webm" },
          audio: [{ index: 2, codec_name: "aac" }],
        },
        2,
        false,
      ),
    ).toBe("Video original · Audio original · Remux MKV→MP4");
  });

  it("labels the buffered original HLS path", () => {
    expect(
      originalQualityDescription(
        {
          format: { format_name: "matroska,webm" },
          audio: [{ index: 1, codec_name: "ac3" }],
        },
        1,
        false,
        true,
      ),
    ).toBe("Video original · Audio transcoded · Remux MKV→HLS");
  });
});
