package transcode

import (
	"slices"
	"strings"
	"testing"
)

func TestOriginalHLSMuxesCopiedVideoAndAudioIntoOneFMP4Playlist(t *testing.T) {
	args := originalHLSArgs("movie.mkv", 0, "cache", "cache/index.m3u8", 0, "h264", 2, true)
	joined := strings.Join(args, " ")
	if !strings.Contains(joined, "-map 0:v:0 -map 0:2? -c:v copy -c:a copy") {
		t.Fatalf("original video and selected audio were not muxed together: %s", joined)
	}
	if !strings.Contains(joined, "-f hls") || !strings.Contains(joined, "-hls_segment_type fmp4") || !strings.Contains(joined, "segment-%05d.m4s") {
		t.Fatalf("original output is not segmented fMP4 HLS: %s", joined)
	}
	if slices.Contains(args, "-an") || slices.Contains(args, "-vn") {
		t.Fatalf("muxed original HLS unexpectedly disabled a selected stream: %v", args)
	}
}

func TestOriginalHLSPreservesVideoTimestampsWithoutEncoding(t *testing.T) {
	args := originalHLSArgs("movie.mkv", 123.5, "cache", "cache/index.m3u8", 4, "h264", 2, false)
	joined := strings.Join(args, " ")
	if !strings.Contains(joined, "-copyts -start_at_zero -ss 123.500 -noaccurate_seek") {
		t.Fatalf("seek timestamps were not preserved: %s", joined)
	}
	if slices.Contains(args, "h264_nvenc") || slices.Contains(args, "libx264") {
		t.Fatalf("original HLS must not encode video: %v", args)
	}
}

func TestOriginalHEVCHLSUsesBrowserCompatibleSampleEntry(t *testing.T) {
	args := originalHLSArgs("hdr.mkv", 0, "cache", "cache/index.m3u8", 0, "hevc", 1, false)
	joined := strings.Join(args, " ")
	if !strings.Contains(joined, "-c:v copy -tag:v hvc1") {
		t.Fatalf("HEVC original was not copied with the hvc1 sample entry: %s", joined)
	}
}

func TestOriginalHLSCopiesBrowserCompatibleAudioWithoutEncoding(t *testing.T) {
	args := originalHLSArgs("movie.mkv", 123.5, "cache", "cache/index.m3u8", 4, "h264", 2, true)
	joined := strings.Join(args, " ")
	if !strings.Contains(joined, "-map 0:v:0 -map 0:2? -c:v copy -c:a copy") {
		t.Fatalf("compatible original audio was not copied: %s", joined)
	}
	if strings.Contains(joined, "-b:a") || strings.Contains(joined, "-ac 1") || strings.Contains(joined, "-ar 32000") {
		t.Fatalf("audio copy must not alter bitrate, channels, or sample rate: %s", joined)
	}
	if !strings.Contains(joined, "-copyts -start_at_zero -ss 123.500 -noaccurate_seek") {
		t.Fatalf("audio copy did not preserve the original timeline: %s", joined)
	}
}

func TestOriginalHLSTranscodesOnlyCompatibilityAudio(t *testing.T) {
	args := originalHLSArgs("movie.mkv", 0, "cache", "cache/index.m3u8", 0, "h264", 2, false)
	joined := strings.Join(args, " ")
	if !strings.Contains(joined, "-map 0:v:0 -map 0:2? -c:v copy -c:a aac") {
		t.Fatalf("incompatible audio did not use the AAC fallback: %s", joined)
	}
	if strings.Contains(joined, "-c:a copy") {
		t.Fatalf("compatibility encoding cannot be reported as a stream copy: %s", joined)
	}
}

func TestOriginalHLSCompatibilityPreservesSixChannels(t *testing.T) {
	args := originalHLSArgs("movie.mkv", 0, "cache", "cache/index.m3u8", 0, "h264", 2, false, 6)
	joined := strings.Join(args, " ")
	if !strings.Contains(joined, "-c:a aac -b:a 320000") || strings.Contains(joined, "-ac ") || strings.Contains(joined, "-ar ") {
		t.Fatalf("original audio compatibility path altered the source channel layout or sample rate: %s", joined)
	}
	if !strings.Contains(joined, "-af aformat=channel_layouts=5.1") {
		t.Fatalf("six-channel AAC in fragmented MP4 needs an explicit browser-compatible 5.1 layout: %s", joined)
	}
}

func TestOriginalHLSKeepsAndMutesCompatibilityAudioPreroll(t *testing.T) {
	args := originalHLSArgs("episode.mkv", 192, "cache", "cache/index.m3u8", 96, "h264", 1, false)
	joined := strings.Join(args, " ")
	if !strings.Contains(joined, "-copyts -start_at_zero -ss 192.000 -noaccurate_seek -i episode.mkv") {
		t.Fatalf("original compatibility audio did not retain the keyframe pre-roll: %s", joined)
	}
	if !strings.Contains(joined, "-af volume=enable='lt(t,192.000)':volume=0") {
		t.Fatalf("original compatibility audio pre-roll was not muted: %s", joined)
	}
	if !strings.Contains(joined, "-c:a aac") {
		t.Fatalf("incompatible original audio did not use the AAC fallback: %s", joined)
	}
}

func TestOriginalHLSWithoutAudioKeepsVideoOnly(t *testing.T) {
	args := originalHLSArgs("silent.mkv", 0, "cache", "cache/index.m3u8", 0, "h264", -1, false)
	joined := strings.Join(args, " ")
	if !strings.Contains(joined, "-map 0:v:0 -an -c:v copy") {
		t.Fatalf("video-only original HLS was not preserved: %s", joined)
	}
}
