package transcode

import (
	"slices"
	"strings"
	"testing"
)

func testManager() *Manager {
	return &Manager{
		Hardware:         []string{"nvidia"},
		encoders:         map[string]bool{"h264_nvenc": true, "hevc_nvenc": true, "libx265": true},
		filters:          map[string]bool{"scale_cuda": true, "zscale": true, "tonemap": true, "tonemap_cuda": true, "tonemap_opencl": true},
		failedStrategies: map[string]bool{},
	}
}

func TestNVIDIAIsAttemptedForLowestRendition(t *testing.T) {
	strategies := testManager().videoStrategies(240, ColorSDR, false)
	if len(strategies) < 2 || strategies[0].name != "nvidia-cuda" || strategies[1].name != "nvidia" {
		t.Fatalf("240p did not attempt the accelerated paths first: %#v", strategies)
	}
	args := strategyArgs([]string{"-hide_banner", "-i", "movie.mkv"}, strategies[0], nil)
	input := slices.Index(args, "-i")
	hwaccel := slices.Index(args, "-hwaccel")
	if hwaccel < 0 || hwaccel > input {
		t.Fatalf("CUDA decode arguments must precede the input: %v", args)
	}
}

func TestHDRStrategyPreservesMain10AndPQ(t *testing.T) {
	strategies := testManager().videoStrategies(1080, ColorHDR, true)
	joined := strings.Join(strategies[0].args, " ")
	if !strings.Contains(joined, "hevc_nvenc") || !strings.Contains(joined, "main10") || !strings.Contains(joined, "p010le") {
		t.Fatalf("HDR strategy did not preserve ten-bit HEVC: %s", joined)
	}
}

func TestSDRStrategyToneMapsHDRAndOutputsEightBits(t *testing.T) {
	strategies := testManager().videoStrategies(720, ColorSDR, true)
	for _, strategy := range strategies {
		joined := strings.Join(strategy.args, " ")
		if !strings.Contains(joined, "tonemap=hable") || (!strings.Contains(joined, "format=yuv420p") && !strings.Contains(joined, "format=nv12")) {
			t.Fatalf("strategy %s does not tone map HDR to browser-compatible SDR: %s", strategy.name, joined)
		}
	}
}

func TestSDRFromHDRAttemptsCUDAThenOpenCLBeforeSoftwareToneMapping(t *testing.T) {
	strategies := testManager().videoStrategies(720, ColorSDR, true)
	if len(strategies) < 4 || strategies[0].name != "nvidia-cuda-tonemap" || strategies[1].name != "nvidia-opencl" || strategies[2].name != "nvidia" || strategies[3].name != "cpu" {
		t.Fatalf("HDR-to-SDR strategy order does not preserve GPU and CPU fallbacks: %#v", strategies)
	}
	cudaArgs := strategyArgs([]string{"-hide_banner", "-i", "movie.mkv"}, strategies[0], nil)
	cudaJoined := strings.Join(cudaArgs, " ")
	if !strings.Contains(cudaJoined, "tonemap_cuda") || !strings.Contains(cudaJoined, "h264_nvenc") {
		t.Fatalf("primary accelerated SDR strategy does not combine CUDA tone mapping and NVENC: %s", cudaJoined)
	}
	if !strings.Contains(cudaJoined, "tradeoff=1") || !strings.Contains(cudaJoined, "tonemap_mode=auto") {
		t.Fatalf("CUDA tone mapping is not configured for real-time streaming: %s", cudaJoined)
	}
	if strings.Contains(cudaJoined, "zerolatency") {
		t.Fatalf("CUDA tone mapping enables the NVENC mode that corrupts tone-mapped frames: %s", cudaJoined)
	}
	if !strings.Contains(cudaJoined, "-threads 1") {
		t.Fatalf("CUDA decoding is not constrained to the stable single-threaded path: %s", cudaJoined)
	}
	args := strategyArgs([]string{"-hide_banner", "-i", "movie.mkv"}, strategies[1], nil)
	input := slices.Index(args, "-i")
	device := slices.Index(args, "-init_hw_device")
	if device < 0 || device > input {
		t.Fatalf("OpenCL device initialization must precede the input: %v", args)
	}
	joined := strings.Join(args, " ")
	if !strings.Contains(joined, "tonemap_opencl") || !strings.Contains(joined, "h264_nvenc") {
		t.Fatalf("accelerated SDR strategy does not combine OpenCL tone mapping and NVENC: %s", joined)
	}
}

func TestFailedOpenCLStrategyIsSkippedAfterFirstRuntimeFailure(t *testing.T) {
	m := testManager()
	strategy := m.videoStrategies(720, ColorSDR, true)[1]
	m.rememberStrategyFailure(strategy, ColorSDR)
	if !m.strategyFailed(strategy, ColorSDR) {
		t.Fatal("failed OpenCL strategy was not remembered")
	}
}

func TestNVENCStrategiesDoNotEnableZeroLatency(t *testing.T) {
	manager := testManager()
	cases := []struct {
		color     ColorMode
		sourceHDR bool
	}{
		{color: ColorSDR, sourceHDR: false},
		{color: ColorSDR, sourceHDR: true},
		{color: ColorHDR, sourceHDR: true},
	}
	for _, tc := range cases {
		for _, strategy := range manager.videoStrategies(1080, tc.color, tc.sourceHDR) {
			joined := strings.Join(strategy.args, " ")
			if strings.Contains(joined, "nvenc") && strings.Contains(joined, "zerolatency") {
				t.Fatalf("NVENC strategy %s enables the driver-incompatible zero-latency mode: %s", strategy.name, joined)
			}
		}
	}
}

func TestHDRAndSDRUseDifferentCacheKeys(t *testing.T) {
	m := testManager()
	hdr := m.key("movie.mkv", hlsVideoCacheVersion, "720p", string(ColorHDR), "0")
	sdr := m.key("movie.mkv", hlsVideoCacheVersion, "720p", string(ColorSDR), "0")
	if hdr == sdr {
		t.Fatal("HDR and SDR segments shared a cache key")
	}
}
