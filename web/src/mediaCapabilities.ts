import type { PlayerVideoStream } from "./playerTypes";

export type ColorPreference = "auto" | "hdr" | "sdr";
export type DeliveryColor = "hdr" | "sdr";

export function isHDRVideo(stream?: PlayerVideoStream): boolean {
  const transfer = stream?.color_transfer?.toLowerCase();
  return transfer === "smpte2084" || transfer === "arib-std-b67";
}

export function videoContentTypes(stream?: PlayerVideoStream): string[] {
  switch (stream?.codec_name?.toLowerCase()) {
    case "hevc": {
      const tenBit =
        stream.profile?.toLowerCase().includes("10") ||
        stream.pix_fmt?.includes("10");
      const codec = tenBit ? "2.4.L153.B0" : "1.6.L120.B0";
      return [
        `video/mp4; codecs="hvc1.${codec}"`,
        `video/mp4; codecs="hev1.${codec}"`,
        'video/mp4; codecs="hvc1"',
      ];
    }
    case "h264":
      return ['video/mp4; codecs="avc1.640029"', 'video/mp4; codecs="avc1.42E01E"'];
    case "vp9":
      return ['video/mp4; codecs="vp09.00.10.08"', 'video/webm; codecs="vp9"'];
    case "vp8":
      return ['video/webm; codecs="vp8"'];
    case "av1":
      return ['video/mp4; codecs="av01.0.05M.08"'];
    default:
      return [];
  }
}

function mediaSourceSupports(contentType: string): boolean {
  return typeof MediaSource !== "undefined" &&
    typeof MediaSource.isTypeSupported === "function"
    ? MediaSource.isTypeSupported(contentType)
    : false;
}

export function supportsSourceVideo(
  element: HTMLVideoElement,
  stream?: PlayerVideoStream,
): boolean {
  return videoContentTypes(stream).some(
    (contentType) =>
      element.canPlayType(contentType) !== "" || mediaSourceSupports(contentType),
  );
}

export function supportsSourceMSE(stream?: PlayerVideoStream): boolean {
  return videoContentTypes(stream).some(mediaSourceSupports);
}

export function supportsHDRDelivery(element: HTMLVideoElement): boolean {
  const contentType = 'video/mp4; codecs="hvc1.2.4.L153.B0"';
  return (
    element.canPlayType(contentType) !== "" || mediaSourceSupports(contentType)
  );
}

export function resolveDeliveryColor(
  preference: ColorPreference,
  sourceHDR: boolean,
  hdrSupported: boolean,
): DeliveryColor {
  if (!sourceHDR || preference === "sdr") return "sdr";
  if (preference === "hdr" || preference === "auto")
    return hdrSupported ? "hdr" : "sdr";
  return "sdr";
}
