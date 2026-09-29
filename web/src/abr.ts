export type ABRLevel = { bitrate: number };

// Some browser HEVC Main 10 decoders cannot append very small HDR renditions
// even when the same stream plays at 480p. Keep automatic playback on a
// decodable floor; SDR retains the full low-bandwidth ladder.
export function minimumAutoLevel(
  levels: { height: number }[],
  color: "hdr" | "sdr",
) {
  if (color !== "hdr") return 0;
  if (!levels.some((level) => level.height >= 480)) return 0;
  // Server configuration is ordered high-to-low; hls.js exposes the same
  // ladder low-to-high. Count lower rungs rather than using a config index.
  return levels.filter((level) => level.height < 480).length;
}

export type AutoLevelTarget = {
  autoLevelCapping: number;
  nextAutoLevel: number;
};

export type PinnedAutoLevelTarget = AutoLevelTarget & {
  nextLevel: number;
};

// Start at the safest level, then jump directly to the highest rendition that
// the measured throughput can support. The caller pins that result so there is
// only one ABR authority switching server-side transcode jobs.
export function chooseAutoLevel(
  levels: ABRLevel[],
  current: number,
  bandwidth: number,
  bufferSeconds: number,
  failed: Map<number, number>,
) {
  if (current < 0 || !levels.length || bandwidth <= 0) return current;
  // Switching starts a new FFmpeg rendition and retires the old writer. Keep
  // enough of the old rendition buffered to cover a cold transcode startup.
  if (bufferSeconds < 6) return current;
  const usable = bandwidth * (bufferSeconds < 4 ? 0.72 : 0.82);
  let affordable = current;
  for (let index = current + 1; index < levels.length; index++) {
    if (levels[index]!.bitrate <= usable && (failed.get(index) || 0) < 2)
      affordable = index;
    else break;
  }
  if (affordable <= current) return current;
  return affordable;
}

export function chooseAffordableLevel(
  levels: ABRLevel[],
  bandwidth: number,
  bufferSeconds: number,
  failed: Map<number, number>,
) {
  if (!levels.length || bandwidth <= 0) return 0;
  const usable = bandwidth * (bufferSeconds < 4 ? 0.72 : 0.82);
  let affordable = 0;
  for (let index = 0; index < levels.length; index++) {
    if (levels[index]!.bitrate <= usable && (failed.get(index) || 0) < 2) {
      affordable = index;
      continue;
    }
    break;
  }
  return affordable;
}

export function requestAutoLevel(
  controller: AutoLevelTarget,
  target: number,
) {
  controller.autoLevelCapping = target;
  controller.nextAutoLevel = target;
}

export function pinAutoLevel(
  controller: PinnedAutoLevelTarget,
  target: number,
) {
  requestAutoLevel(controller, target);
  controller.nextLevel = target;
}

export function releasePinnedAutoLevel(controller: PinnedAutoLevelTarget) {
  controller.nextLevel = -1;
}

export function shouldUseOriginal(
  bandwidth: number,
  sourceBitrate: number,
  bufferSeconds: number,
  blockedUntil: number,
  now = Date.now(),
  independentBandwidth = bandwidth,
) {
  return (
    sourceBitrate > 0 &&
    bufferSeconds >= 4 &&
    now >= blockedUntil &&
    bandwidth >= sourceBitrate * 1.5 &&
    independentBandwidth >= sourceBitrate * 1.5
  );
}
