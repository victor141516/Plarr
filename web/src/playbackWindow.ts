export const HLS_SEGMENT_SECONDS = 2;
export const SEEK_PREROLL_SECONDS = 5;

/**
 * Every adaptive source reload uses the same deterministic absolute window.
 * FFmpeg may retain an earlier source keyframe, but the client-visible window
 * identity and media-sequence base are always derived from this value.
 */
export function playbackWindowStart(targetSeconds: number): number {
  const target = Number.isFinite(targetSeconds)
    ? Math.max(0, targetSeconds)
    : 0;
  return (
    Math.floor(
      Math.max(0, target - SEEK_PREROLL_SECONDS) / HLS_SEGMENT_SECONDS,
    ) * HLS_SEGMENT_SECONDS
  );
}
