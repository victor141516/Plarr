export type ABRLevel = { bitrate: number };

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
  // A fresh playback or rendition switch can briefly report high throughput
  // from a single cached fragment. Wait for a real playback cushion before
  // committing to a higher, potentially expensive rendition.
  if (bufferSeconds < 2) return current;
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
) {
  return (
    sourceBitrate > 0 &&
    bufferSeconds >= 4 &&
    now >= blockedUntil &&
    bandwidth >= sourceBitrate * 1.5
  );
}
