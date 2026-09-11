import type {
  PlaybackTranscodeAttempt,
  PlaybackTranscodeDiagnostics,
  PlayerProbe,
  PlayerTrack,
  PlayerVideoStream,
} from "./playerTypes";

export type DiagnosticRow = { label: string; value: string };
export type DiagnosticSection = { title: string; rows: DiagnosticRow[] };

type DiagnosticProbe = Omit<Partial<PlayerProbe>, "audio"> & {
  audio?: Array<Partial<PlayerTrack>>;
};

export type PlaybackDiagnosticInput = {
  probe: DiagnosticProbe | null;
  selectedAudio?: Partial<PlayerTrack>;
  mode:
    | "adaptive"
    | "native-hls"
    | "original-direct"
    | "original-hls"
    | "original-remux";
  automatic: boolean;
  quality: string;
  activeLevel?: { height: number; bitrate: number };
  bandwidthEstimate: number;
  bufferSeconds: number;
  decision: string;
  deliveryColor?: "hdr" | "sdr";
  sourceHDR?: boolean;
  transcodeDiagnostics?: PlaybackTranscodeDiagnostics | null;
  transcodeDiagnosticsError?: string;
  playbackIssue?: string;
  reactiveAVSyncReconciliations?: number;
};

function number(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

export function formatBitrate(value: unknown) {
  const bitrate = number(value);
  if (!bitrate) return "Not reported";
  if (bitrate >= 1_000_000) {
    const digits = bitrate >= 10_000_000 ? 1 : 2;
    return `${(bitrate / 1_000_000).toFixed(digits)} Mbps`;
  }
  return `${Math.round(bitrate / 1_000)} kbps`;
}

function rational(value: unknown) {
  const parts = String(value || "").split("/");
  const numerator = Number(parts[0]);
  const denominator = Number(parts[1]);
  if (
    !Number.isFinite(numerator) ||
    !Number.isFinite(denominator) ||
    !denominator
  )
    return 0;
  return numerator / denominator;
}

function compact(value: number) {
  return value.toFixed(3).replace(/\.?0+$/, "");
}

export function frameRateDescription(video?: PlayerVideoStream) {
  const average = rational(video?.avg_frame_rate);
  const nominal = rational(video?.r_frame_rate);
  if (!average && !nominal) return "Not reported";
  if (average && nominal && Math.abs(average - nominal) > 0.01)
    return `${compact(average)} fps average · ${compact(nominal)} fps nominal`;
  return `${compact(average || nominal)} fps`;
}

function codec(value: unknown) {
  const name = String(value || "").toLowerCase();
  const labels: Record<string, string> = {
    h264: "H.264",
    hevc: "HEVC",
    av1: "AV1",
    vp9: "VP9",
    aac: "AAC",
    ac3: "AC-3",
    eac3: "E-AC-3",
    truehd: "TrueHD",
    dts: "DTS",
    opus: "Opus",
    mp3: "MP3",
  };
  return labels[name] || name.toUpperCase() || "Not reported";
}

function channels(value: unknown) {
  const count = number(value);
  const layout: Record<number, string> = {
    1: "mono",
    2: "stereo",
    6: "5.1",
    8: "7.1",
  };
  return count
    ? `${count}${layout[count] ? ` (${layout[count]})` : ""}`
    : "Not reported";
}

function containerName(value: unknown) {
  const raw = String(value || "");
  if (!raw) return "Not reported";
  if (raw.includes("matroska")) return "Matroska / MKV";
  if (raw.includes("mp4") || raw.includes("mov")) return "MP4 / MOV";
  if (raw.includes("webm")) return "WebM";
  return raw;
}

function processingRows(input: PlaybackDiagnosticInput): DiagnosticRow[] {
  const audioCodec = codec(input.selectedAudio?.codec_name);
  if (input.mode === "original-direct")
    return [
      { label: "Delivery", value: "Original file · direct play" },
      { label: "Video", value: "Original stream · no encoding" },
      {
        label: "Audio",
        value: `Original stream (${audioCodec}) · no encoding`,
      },
      { label: "Container", value: "Original container" },
      { label: "Frame timing", value: "Original timestamps" },
    ];
  if (input.mode === "original-hls" || input.mode === "original-remux") {
    const copiedAudio =
      String(input.selectedAudio?.codec_name || "").toLowerCase() === "aac";
    return [
      {
        label: "Delivery",
        value:
          input.mode === "original-hls"
            ? "Original quality · buffered HLS remux"
            : "Original quality · compatibility remux",
      },
      { label: "Video", value: "Original stream · stream copy" },
      {
        label: "Audio",
        value: copiedAudio
          ? `Original stream (${audioCodec}) · stream copy`
          : `${audioCodec} → AAC · compatibility encoding`,
      },
      {
        label: "Container",
        value:
          input.mode === "original-hls"
            ? `HLS / one fragmented MP4 timeline (${copiedAudio ? audioCodec : "AAC"} audio)`
            : "Remux to fragmented MP4",
      },
      { label: "Frame timing", value: "Original timestamps" },
    ];
  }
  const level = input.activeLevel;
  const hdr = input.deliveryColor === "hdr";
  const toneMapped = input.sourceHDR && !hdr;
  return [
    {
      label: "Delivery",
      value: `${input.automatic ? "Automatic" : "Manual"} adaptive HLS`,
    },
    {
      label: "Video",
      value: `${hdr ? "HEVC Main 10" : "H.264"} re-encode${level?.height ? ` · ${level.height}p` : ""}${level?.bitrate ? ` · ${formatBitrate(level.bitrate)}` : ""}${toneMapped ? " · HDR→SDR tone mapping" : hdr ? " · HDR preserved" : ""}`,
    },
    { label: "Audio", value: "AAC re-encode · 48 kbps · mono" },
    {
      label: "Container",
      value: hdr ? "HLS / fragmented MP4 segments" : "HLS / MPEG-TS segments",
    },
    { label: "Frame timing", value: "Source timestamps preserved" },
  ];
}

function strategyPipeline(
  name: string,
  input: PlaybackDiagnosticInput,
): string {
  const hdr = input.transcodeDiagnostics?.color === "hdr";
  const toneMapped =
    input.transcodeDiagnostics?.sourceHDR &&
    input.transcodeDiagnostics?.color === "sdr";
  const pipelines: Record<string, string> = {
    "hls-cache": "Existing HLS segments reused",
    "nvidia-cuda-tonemap":
      "NVIDIA decode → CUDA resize + HDR→SDR tone mapping → H.264 NVENC",
    "nvidia-opencl":
      "Software decode + resize → OpenCL HDR→SDR tone mapping → H.264 NVENC",
    "intel-qsv": "Software decode + resize → H.264 Intel QSV",
    vaapi: "Software decode + resize → H.264 VA-API",
  };
  if (name === "nvidia-cuda") {
    return hdr
      ? "NVIDIA decode → CUDA resize → HEVC Main 10 NVENC"
      : "NVIDIA decode → CUDA resize → H.264 NVENC";
  }
  if (name === "nvidia") {
    if (hdr) return "Software decode + resize → HEVC Main 10 NVENC";
    if (toneMapped)
      return "Software decode + HDR→SDR tone mapping + resize → H.264 NVENC";
    return "Software decode + resize → H.264 NVENC";
  }
  if (name === "cpu") {
    if (hdr) return "Software decode + resize → HEVC Main 10 software encode";
    if (toneMapped)
      return "Software decode + HDR→SDR tone mapping + resize → H.264 software encode";
    return "Software decode + resize → H.264 software encode";
  }
  return pipelines[name] || name;
}

function attemptStatus(attempt: PlaybackTranscodeAttempt): string {
  const labels: Record<PlaybackTranscodeAttempt["status"], string> = {
    running: "Starting",
    active: "Active",
    failed: "Failed",
    succeeded: "Completed",
    skipped: "Skipped",
    canceled: "Canceled",
  };
  return labels[attempt.status];
}

function conversionAttemptRows(
  input: PlaybackDiagnosticInput,
): DiagnosticRow[] {
  if (
    input.mode !== "adaptive" &&
    input.mode !== "native-hls"
  ) {
    return [
      {
        label: "Result",
        value: "No video conversion attempted for the selected original mode.",
      },
    ];
  }
  if (
    input.transcodeDiagnosticsError &&
    !input.transcodeDiagnostics?.attempts.length
  ) {
    return [
      {
        label: "Status",
        value: `Diagnostics unavailable · ${input.transcodeDiagnosticsError}`,
      },
    ];
  }
  const diagnostics = input.transcodeDiagnostics;
  if (!diagnostics || diagnostics.attempts.length === 0) {
    return [{ label: "Status", value: "Waiting for conversion diagnostics" }];
  }
  const context = [
    diagnostics.rendition,
    diagnostics.height ? `${diagnostics.height}p` : "",
    diagnostics.sourceHDR
      ? diagnostics.color === "sdr"
        ? "HDR source → SDR delivery"
        : "HDR preserved"
      : "SDR source",
  ].filter(Boolean);
  const attempts = diagnostics.attempts.map((attempt, index) => ({
    label: `${index + 1}. ${attempt.name}`,
    value: [
      attemptStatus(attempt),
      strategyPipeline(attempt.name, input),
      attempt.error,
    ]
      .filter(Boolean)
      .join(" · "),
  }));
  const selected = diagnostics.selected;
  return [
    { label: "Request", value: context.join(" · ") },
    ...attempts,
    {
      label: "Result",
      value: selected
        ? `${selected} · ${strategyPipeline(selected, input)}`
        : "No strategy has produced playable output yet",
    },
    ...(input.transcodeDiagnosticsError
      ? [
          {
            label: "Refresh",
            value: `Diagnostics unavailable · ${input.transcodeDiagnosticsError}`,
          },
        ]
      : []),
  ];
}

export function buildPlaybackDiagnostics(
  input: PlaybackDiagnosticInput,
): DiagnosticSection[] {
  const video = input.probe?.video;
  const sourceBitrate = number(input.probe?.format?.bit_rate);
  const reportedVideoBitrate = number(video?.bit_rate);
  const derivedVideoBitrate = Math.max(
    0,
    sourceBitrate -
      (input.probe?.audio || []).reduce(
        (total, track) => total + number(track.bit_rate),
        0,
      ),
  );
  const usableFactor = input.bufferSeconds < 4 ? 0.72 : 0.82;
  const bandwidthRows: DiagnosticRow[] = [
    {
      label: "Detected bandwidth",
      value: input.bandwidthEstimate
        ? formatBitrate(input.bandwidthEstimate)
        : "Not available in this mode",
    },
    { label: "Playable buffer", value: `${input.bufferSeconds.toFixed(1)} s` },
    {
      label: "Adaptive safety budget",
      value: input.bandwidthEstimate
        ? `${formatBitrate(input.bandwidthEstimate * usableFactor)} (${Math.round(usableFactor * 100)}% of estimate)`
        : "Not available",
    },
    {
      label: "Original threshold",
      value: sourceBitrate
        ? `${formatBitrate(sourceBitrate * 1.5)} and at least 4.0 s buffered`
        : "Unavailable because source bitrate was not reported",
    },
    {
      label: "Decision",
      value: input.automatic
        ? input.decision
        : "Manual quality selection; bandwidth is not choosing the rendition.",
    },
  ];
  return [
    ...(input.playbackIssue
      ? [
          {
            title: "Playback error",
            rows: [{ label: "Latest", value: input.playbackIssue }],
          },
        ]
      : []),
    {
      title: "Original file",
      rows: [
        {
          label: "Container",
          value: containerName(input.probe?.format?.format_name),
        },
        {
          label: "Overall bitrate",
          value: formatBitrate(input.probe?.format?.bit_rate),
        },
        { label: "Video codec", value: codec(video?.codec_name) },
        {
          label: "Video profile",
          value: video?.profile || "Not reported",
        },
        {
          label: "Pixel format",
          value: video?.pix_fmt || "Not reported",
        },
        {
          label: "Dynamic range",
          value: input.sourceHDR ? "HDR" : "SDR",
        },
        {
          label: "Resolution",
          value:
            video?.width && video?.height
              ? `${video.width} × ${video.height}`
              : "Not reported",
        },
        {
          label: "Video bitrate",
          value: reportedVideoBitrate
            ? formatBitrate(reportedVideoBitrate)
            : derivedVideoBitrate
              ? `≈ ${formatBitrate(derivedVideoBitrate)} (derived from overall bitrate)`
              : "Not reported",
        },
        { label: "Frame rate", value: frameRateDescription(video) },
        { label: "Audio codec", value: codec(input.selectedAudio?.codec_name) },
        {
          label: "Audio bitrate",
          value: formatBitrate(input.selectedAudio?.bit_rate),
        },
        {
          label: "Audio channels",
          value: channels(input.selectedAudio?.channels),
        },
      ],
    },
    {
      title: "Current delivery",
      rows: [
        ...processingRows(input),
        {
          label: "Reactive A/V reconciliations",
          value: String(input.reactiveAVSyncReconciliations || 0),
        },
      ],
    },
    { title: "Video conversion attempts", rows: conversionAttemptRows(input) },
    {
      title: "Bandwidth decision",
      rows: [
        { label: "Selected quality", value: input.quality },
        ...(input.activeLevel?.bitrate
          ? [
              {
                label: "Rendition target",
                value: formatBitrate(input.activeLevel.bitrate),
              },
            ]
          : []),
        ...bandwidthRows,
      ],
    },
  ];
}

export function diagnosticsText(sections: DiagnosticSection[]) {
  return [
    "Plarr playback information",
    ...sections.flatMap((section) => [
      "",
      section.title,
      ...section.rows.map((row) => `${row.label}: ${row.value}`),
    ]),
  ].join("\n");
}
