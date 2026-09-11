import { describe, expect, it } from "vitest";
import {
  isHDRVideo,
  resolveDeliveryColor,
  videoContentTypes,
} from "./mediaCapabilities";

describe("media capabilities", () => {
  const main10 = {
    codec_name: "hevc",
    profile: "Main 10",
    pix_fmt: "yuv420p10le",
    color_transfer: "smpte2084",
  };

  it("recognises Main 10 PQ and emits an HEVC Main 10 content type", () => {
    expect(isHDRVideo(main10)).toBe(true);
    expect(videoContentTypes(main10)[0]).toContain("hvc1.2.4.L153.B0");
  });

  it("preserves HDR by default and tone maps only when requested or unsupported", () => {
    expect(resolveDeliveryColor("auto", true, true)).toBe("hdr");
    expect(resolveDeliveryColor("hdr", true, true)).toBe("hdr");
    expect(resolveDeliveryColor("sdr", true, true)).toBe("sdr");
    expect(resolveDeliveryColor("auto", true, false)).toBe("sdr");
    expect(resolveDeliveryColor("hdr", false, true)).toBe("sdr");
  });
});
