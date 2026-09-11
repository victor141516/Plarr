export const playbackRateSteps = [
  0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3,
] as const;

export function closestPlaybackRateIndex(value: number): number {
  let closest = 0;
  for (let index = 1; index < playbackRateSteps.length; index++) {
    if (
      Math.abs(playbackRateSteps[index]! - value) <
      Math.abs(playbackRateSteps[closest]! - value)
    ) {
      closest = index;
    }
  }
  return closest;
}

export function playbackRateLabel(value: number): string {
  return `${value}×`;
}
