export type InitialPlayback = "original" | "hls-js" | "native-hls";

export function chooseInitialPlayback(options: {
  originalRequested: boolean;
  originalSupported: boolean;
  adaptiveCodecSupported: boolean;
  hlsJsSupported: boolean;
  nativeHlsSupported: boolean;
}): InitialPlayback | undefined {
  if (options.originalRequested && options.originalSupported) return "original";
  if (!options.adaptiveCodecSupported && options.originalSupported)
    return "original";
  if (options.hlsJsSupported) return "hls-js";
  if (options.nativeHlsSupported) return "native-hls";
  if (options.originalSupported) return "original";
}
