export function mediaTimeForAbsolute(
  absoluteSeconds: number,
  windowStartSeconds: number,
  mediaOriginSeconds: number,
) {
  return Math.max(
    mediaOriginSeconds,
    absoluteSeconds - windowStartSeconds + mediaOriginSeconds,
  );
}

export function absoluteTimeForMedia(
  mediaSeconds: number,
  windowStartSeconds: number,
  mediaOriginSeconds: number,
) {
  return Math.max(0, windowStartSeconds + mediaSeconds - mediaOriginSeconds);
}

export type MediaRange = { start: number; end: number };

export function bufferedRangesForTimeline(
  ranges: MediaRange[],
  durationSeconds: number,
  windowStartSeconds: number,
  mediaOriginSeconds: number,
) {
  if (!(durationSeconds > 0)) return [];

  return ranges
    .map(({ start, end }) => ({
      start: Math.max(
        0,
        Math.min(
          durationSeconds,
          absoluteTimeForMedia(start, windowStartSeconds, mediaOriginSeconds),
        ),
      ),
      end: Math.max(
        0,
        Math.min(
          durationSeconds,
          absoluteTimeForMedia(end, windowStartSeconds, mediaOriginSeconds),
        ),
      ),
    }))
    .filter(({ start, end }) => end > start);
}
