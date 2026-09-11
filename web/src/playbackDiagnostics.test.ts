import { describe, expect, it } from "vitest";
import {
  buildPlaybackDiagnostics,
  diagnosticsText,
  frameRateDescription,
} from "./playbackDiagnostics";

const probe = {
  format: { format_name: "matroska,webm", bit_rate: "12000000" },
  video: {
    codec_name: "hevc",
    width: 1920,
    height: 808,
    bit_rate: "10500000",
    avg_frame_rate: "24000/1001",
    r_frame_rate: "24/1",
  },
};
const audio = { codec_name: "eac3", bit_rate: "640000", channels: 6 };

describe("playback diagnostics", () => {
  it("reports average and nominal source frame rates", () => {
    expect(frameRateDescription(probe.video)).toBe(
      "23.976 fps average · 24 fps nominal",
    );
  });

  it("describes a compatibility remux without claiming video encoding", () => {
    const text = diagnosticsText(
      buildPlaybackDiagnostics({
        probe,
        selectedAudio: audio,
        mode: "original-remux",
        automatic: false,
        quality: "Original",
        bandwidthEstimate: 0,
        bufferSeconds: 2,
        decision: "",
      }),
    );
    expect(text).toContain("Video: Original stream · stream copy");
    expect(text).toContain("Audio: E-AC-3 → AAC · compatibility encoding");
    expect(text).toContain("Container: Remux to fragmented MP4");
  });

  it("describes buffered original HLS without claiming video encoding", () => {
    const text = diagnosticsText(
      buildPlaybackDiagnostics({
        probe,
        selectedAudio: audio,
        mode: "original-hls",
        automatic: true,
        quality: "Auto · Original",
        bandwidthEstimate: 20_000_000,
        bufferSeconds: 300,
        decision: "Original selected from measured throughput.",
      }),
    );
    expect(text).toContain("Delivery: Original quality · buffered HLS remux");
    expect(text).toContain("Video: Original stream · stream copy");
    expect(text).toContain(
      "Container: HLS / one fragmented MP4 timeline (AAC audio)",
    );
  });

  it("reports compatible audio as a stream copy in buffered original HLS", () => {
    const text = diagnosticsText(
      buildPlaybackDiagnostics({
        probe,
        selectedAudio: { codec_name: "aac", bit_rate: "384000", channels: 6 },
        mode: "original-hls",
        automatic: false,
        quality: "Original",
        bandwidthEstimate: 20_000_000,
        bufferSeconds: 300,
        decision: "",
      }),
    );
    expect(text).toContain("Audio: Original stream (AAC) · stream copy");
    expect(text).toContain(
      "Container: HLS / one fragmented MP4 timeline (AAC audio)",
    );
  });

  it("reports MP3 audio as an AAC compatibility encoding", () => {
    const text = diagnosticsText(
      buildPlaybackDiagnostics({
        probe,
        selectedAudio: { codec_name: "mp3", bit_rate: "320000", channels: 2 },
        mode: "original-hls",
        automatic: false,
        quality: "Original",
        bandwidthEstimate: 20_000_000,
        bufferSeconds: 300,
        decision: "",
      }),
    );
    expect(text).toContain("Audio: MP3 → AAC · compatibility encoding");
    expect(text).toContain(
      "Container: HLS / one fragmented MP4 timeline (AAC audio)",
    );
  });

  it("exposes the measured signal and adaptive safety margin", () => {
    const text = diagnosticsText(
      buildPlaybackDiagnostics({
        probe,
        selectedAudio: audio,
        mode: "adaptive",
        automatic: true,
        quality: "Auto · 720p",
        activeLevel: { height: 720, bitrate: 5_000_000 },
        bandwidthEstimate: 10_000_000,
        bufferSeconds: 5,
        decision: "Auto selected 720p from the measured throughput.",
      }),
    );
    expect(text).toContain("Detected bandwidth: 10.0 Mbps");
    expect(text).toContain(
      "Adaptive safety budget: 8.20 Mbps (82% of estimate)",
    );
    expect(text).toContain(
      "Original threshold: 18.0 Mbps and at least 4.0 s buffered",
    );
    expect(text).toContain("Video: H.264 re-encode · 720p · 5.00 Mbps");
  });

  it("shows every attempted video path, its failure, and the selected fallback", () => {
    const text = diagnosticsText(
      buildPlaybackDiagnostics({
        probe,
        selectedAudio: audio,
        mode: "adaptive",
        automatic: false,
        quality: "1080p",
        activeLevel: { height: 1080, bitrate: 8_000_000 },
        bandwidthEstimate: 20_000_000,
        bufferSeconds: 20,
        decision: "Manual quality selection.",
        sourceHDR: true,
        deliveryColor: "sdr",
        transcodeDiagnostics: {
          rendition: "1080p",
          height: 1080,
          color: "sdr",
          sourceHDR: true,
          attempts: [
            {
              name: "nvidia-cuda-tonemap",
              status: "failed",
              error: "CUDA device unavailable",
            },
            { name: "nvidia-opencl", status: "skipped" },
            { name: "cpu", status: "active" },
          ],
          selected: "cpu",
        },
      }),
    );

    expect(text).toContain("Video conversion attempts");
    expect(text).toContain(
      "1. nvidia-cuda-tonemap: Failed · NVIDIA decode → CUDA resize + HDR→SDR tone mapping → H.264 NVENC · CUDA device unavailable",
    );
    expect(text).toContain("2. nvidia-opencl: Skipped");
    expect(text).toContain(
      "Result: cpu · Software decode + HDR→SDR tone mapping + resize → H.264 software encode",
    );
  });

  it("keeps the latest startup failure in the copyable diagnostics", () => {
    const text = diagnosticsText(
      buildPlaybackDiagnostics({
        probe,
        selectedAudio: audio,
        mode: "adaptive",
        automatic: true,
        quality: "Auto · 240p",
        bandwidthEstimate: 0,
        bufferSeconds: 0,
        decision: "Waiting for throughput.",
        playbackIssue:
          "Startup timed out after 15 seconds without a playable buffer · Auto · adaptive",
      }),
    );

    expect(text).toContain("Playback error");
    expect(text).toContain(
      "Latest: Startup timed out after 15 seconds without a playable buffer",
    );
  });

  it("reports reactive A/V reconciliations for only the current player session", () => {
    const text = diagnosticsText(
      buildPlaybackDiagnostics({
        probe,
        selectedAudio: audio,
        mode: "adaptive",
        automatic: true,
        quality: "Auto · 720p",
        bandwidthEstimate: 10_000_000,
        bufferSeconds: 5,
        decision: "Tracks were reopened on one generation.",
        reactiveAVSyncReconciliations: 2,
      }),
    );

    expect(text).toContain("Reactive A/V reconciliations: 2");
  });
});
