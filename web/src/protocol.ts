export type PlarrEventType =
  | "ready"
  | "opened"
  | "play"
  | "pause"
  | "seek"
  | "heartbeat"
  | "ended"
  | "closed"
  | "page-hidden"
  | "audio-track-changed"
  | "subtitle-track-changed"
  | "subtitles-enabled"
  | "subtitles-disabled"
  | "automatic-rendition-changed"
  | "manual-quality-changed"
  | "next-requested"
  | "previous-requested"
  | "playback-error";

export interface PlarrEvent {
  source: "plarr";
  version: 1;
  eventId: string;
  sessionId: string;
  type: PlarrEventType;
  mediaPath: string;
  positionSeconds: number;
  durationSeconds: number;
  paused: boolean;
  occurredAt: string;
  [key: string]: unknown;
}
export function eventId() {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6]! & 15) | 64;
  bytes[8] = (bytes[8]! & 63) | 128;
  const hex = [...bytes]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
export function envelope(
  type: PlarrEventType,
  sessionId: string,
  mediaPath: string,
  video: HTMLVideoElement | null,
  extra: Record<string, unknown> = {},
): PlarrEvent {
  return {
    source: "plarr",
    version: 1,
    eventId: eventId(),
    sessionId,
    type,
    mediaPath,
    positionSeconds: video?.currentTime || 0,
    durationSeconds: Number.isFinite(video?.duration) ? video!.duration : 0,
    paused: video?.paused ?? true,
    occurredAt: new Date().toISOString(),
    ...extra,
  };
}
export function normalized(value?: string) {
  return (value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}
const languageAliases: Record<string, string> = {
  eng: "en",
  spa: "es",
  fra: "fr",
  fre: "fr",
  por: "pt",
  deu: "de",
  ger: "de",
  ita: "it",
  jpn: "ja",
  kor: "ko",
  zho: "zh",
  chi: "zh",
  rus: "ru",
  ara: "ar",
  hin: "hi",
};
export function normalizedLanguage(value?: string) {
  const primary = normalized(value).split(/[-_]/)[0] || "";
  return languageAliases[primary] || primary;
}
export function chooseTrack<
  T extends { language?: string; name?: string; index?: number },
>(tracks: T[], language?: string, title?: string) {
  const same = tracks.filter(
    (t) => normalizedLanguage(t.language) === normalizedLanguage(language),
  );
  if (same.length === 1) return same[0];
  const exact = same.find((t) => normalized(t.name) === normalized(title));
  if (exact) return exact;
  return (
    [...same].sort(
      (a, b) =>
        normalized(a.name).localeCompare(normalized(b.name)) ||
        (a.index || 0) - (b.index || 0),
    )[0] || tracks[0]
  );
}
