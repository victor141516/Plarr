export interface PlayerTrack {
  index: number;
  codec_name: string;
  codec_type: string;
  tags?: Record<string, string>;
  language?: string;
  name?: string;
  bit_rate?: string;
  channels?: number;
  sample_rate?: string;
}

export interface PlayerVideoStream {
  codec_name: string;
  profile?: string;
  pix_fmt?: string;
  level?: number;
  width?: number;
  height?: number;
  bit_rate?: string;
  avg_frame_rate?: string;
  r_frame_rate?: string;
  color_range?: string;
  color_space?: string;
  color_transfer?: string;
  color_primaries?: string;
}

export interface PlayerProbe {
  durationSeconds: number;
  videoDurationSeconds?: number;
  directPlayCandidate?: boolean;
  remuxCandidate?: boolean;
  video?: PlayerVideoStream;
  audio?: PlayerTrack[];
  subtitles?: PlayerTrack[];
  format?: {
    format_name?: string;
    format_long_name?: string;
    bit_rate?: string;
    size?: string;
    tags?: Record<string, string>;
  };
}

export interface PlayerConfig {
  renditions?: Array<{
    height: number;
    videoBitrate: number;
  }>;
  allowedParentOrigins?: string[];
}

export interface QualityLevel {
  height: number;
  bitrate: number;
}

export type TranscodeAttemptStatus =
  | "running"
  | "active"
  | "failed"
  | "succeeded"
  | "skipped"
  | "canceled";

export interface PlaybackTranscodeAttempt {
  name: string;
  status: TranscodeAttemptStatus;
  error?: string;
}

export interface PlaybackTranscodeDiagnostics {
  rendition?: string;
  height?: number;
  color?: "hdr" | "sdr";
  sourceHDR?: boolean;
  attempts: PlaybackTranscodeAttempt[];
  selected?: string;
}

export type PlaybackMode =
  | "adaptive"
  | "native-hls"
  | "original-direct"
  | "original-hls"
  | "original-remux";
