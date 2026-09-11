import { describe, expect, it } from "vitest";
import { chooseInitialPlayback } from "./initialPlayback";

describe("initial playback selection", () => {
  it("uses a playable original when the browser cannot decode adaptive H.264", () => {
    expect(
      chooseInitialPlayback({
        originalRequested: false,
        originalSupported: true,
        adaptiveCodecSupported: false,
        hlsJsSupported: true,
        nativeHlsSupported: false,
      }),
    ).toBe("original");
  });

  it("starts conservatively with HLS when adaptive H.264 is supported", () => {
    expect(
      chooseInitialPlayback({
        originalRequested: false,
        originalSupported: true,
        adaptiveCodecSupported: true,
        hlsJsSupported: true,
        nativeHlsSupported: false,
      }),
    ).toBe("hls-js");
  });

  it("honors an explicit Original selection", () => {
    expect(
      chooseInitialPlayback({
        originalRequested: true,
        originalSupported: true,
        adaptiveCodecSupported: true,
        hlsJsSupported: true,
        nativeHlsSupported: false,
      }),
    ).toBe("original");
  });
});
