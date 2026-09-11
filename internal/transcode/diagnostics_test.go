package transcode

import (
	"errors"
	"strings"
	"testing"
)

func TestStrategyDiagnosticsRecordsFallbackAndSelectedPath(t *testing.T) {
	m := &Manager{strategyDiagnostics: map[string]*playbackStrategyTrace{}}
	m.beginVideoDiagnostics("browser-session", "video-key", "1080p", 1080, ColorSDR, true)
	m.recordVideoStrategy("browser-session", "video-key", "nvidia-cuda-tonemap", "running", "")
	m.updateVideoStrategy("browser-session", "video-key", "nvidia-cuda-tonemap", "failed", "CUDA device unavailable", false)
	m.recordVideoStrategy("browser-session", "video-key", "nvidia-opencl", "skipped", "Unavailable after an earlier runtime failure.")
	m.recordVideoStrategy("browser-session", "video-key", "nvidia", "running", "")
	m.markVideoStrategyActive("browser-session", "video-key")

	got := m.StrategyDiagnostics("browser-session")
	if got.Selected != "nvidia" || got.Rendition != "1080p" || got.Height != 1080 || !got.SourceHDR {
		t.Fatalf("unexpected diagnostic summary: %#v", got)
	}
	if len(got.Attempts) != 3 || got.Attempts[0].Status != "failed" || got.Attempts[2].Status != "active" {
		t.Fatalf("unexpected attempts: %#v", got.Attempts)
	}

	got.Attempts[0].Error = "mutated"
	if m.StrategyDiagnostics("browser-session").Attempts[0].Error != "CUDA device unavailable" {
		t.Fatal("returned diagnostics shared mutable attempt storage")
	}
}

func TestOldVideoJobCannotOverwriteNewDiagnosticTrace(t *testing.T) {
	m := &Manager{strategyDiagnostics: map[string]*playbackStrategyTrace{}}
	m.beginVideoDiagnostics("session", "old-key", "720p", 720, ColorSDR, true)
	m.recordVideoStrategy("session", "old-key", "cpu", "running", "")
	m.beginVideoDiagnostics("session", "new-key", "1080p", 1080, ColorHDR, true)
	m.recordVideoStrategy("session", "new-key", "nvidia-cuda", "running", "")
	m.updateVideoStrategy("session", "old-key", "cpu", "canceled", "Playback changed or closed.", false)
	m.markVideoStrategyActive("session", "new-key")

	got := m.StrategyDiagnostics("session")
	if got.Rendition != "1080p" || got.Selected != "nvidia-cuda" || len(got.Attempts) != 1 {
		t.Fatalf("old job changed current diagnostics: %#v", got)
	}
}

func TestStrategyErrorSummaryIsSingleLineAndBounded(t *testing.T) {
	message := "FFmpeg failed: " + strings.Repeat("x", 300) + "\nsecret second line"
	got := strategyErrorSummary(errors.New(message))
	if len(got) > 240 || strings.Contains(got, "secret") || strings.ContainsAny(got, "\r\n") {
		t.Fatalf("unsafe diagnostic error summary: %q", got)
	}
}
