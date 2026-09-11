type ProbeTrack = { index: number; codec_name?: string };
type ProbeLike = {
  format?: { format_name?: string };
  audio?: ProbeTrack[];
};

function containerName(formatName = "") {
  const names = formatName.toLowerCase().split(",");
  if (names.includes("matroska")) return "MKV";
  if (names.includes("webm")) return "WebM";
  if (names.some((name) => name === "mov" || name.startsWith("mp4")))
    return "MP4";
  if (names.includes("avi")) return "AVI";
  if (names.includes("mpegts")) return "MPEG-TS";
  return names[0]?.toUpperCase() || "source";
}

export function originalQualityDescription(
  probe: ProbeLike | null,
  audioIndex: number | undefined,
  direct: boolean,
  bufferedHls = false,
) {
  if (direct) return "Video original · Audio original";

  const tracks = probe?.audio || [];
  const selected =
    tracks.find((track) => track.index === audioIndex) || tracks[0];
  const codec = selected?.codec_name?.toLowerCase() || "";
  const audio =
    !selected || codec === "aac" || codec === "mp3"
      ? "Audio original"
      : "Audio transcoded";
  return `Video original · ${audio} · Remux ${containerName(probe?.format?.format_name)}→${bufferedHls ? "HLS" : "MP4"}`;
}
