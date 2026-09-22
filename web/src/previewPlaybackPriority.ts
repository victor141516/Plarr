export const timelinePreviewBufferThreshold = 30;

export function playbackNeedsPreviewPriority(
  bufferedSeconds: number,
  playing: boolean,
  loading: boolean,
): boolean {
  return (playing || loading) && bufferedSeconds < timelinePreviewBufferThreshold;
}
