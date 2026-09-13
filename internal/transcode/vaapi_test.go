package transcode

import (
	"slices"
	"strings"
	"testing"
)

func TestVAAPIHardwarePathsAndUploadFallback(t *testing.T) {
	m := &Manager{Hardware: []string{"amd"}, encoders: map[string]bool{"h264_vaapi": true, "hevc_vaapi": true}, filters: map[string]bool{"scale_vaapi": true}, failedStrategies: map[string]bool{}}
	for _, color := range []ColorMode{ColorSDR, ColorHDR} {
		strategies := m.vaapiStrategies(720, color, color == ColorHDR, "software-filter")
		if len(strategies) != 2 || strategies[0].name != "vaapi-decode" || strategies[1].name != "vaapi" {
			t.Fatalf("missing decode and upload paths for %s: %#v", color, strategies)
		}
		args := strategyArgs([]string{"-ss", "2", "-i", "movie.mkv"}, strategies[0], nil)
		if slices.Index(args, "-hwaccel") > slices.Index(args, "-i") || slices.Index(args, "-vaapi_device") > slices.Index(args, "-i") {
			t.Fatalf("device/decode options must precede input: %v", args)
		}
		joined := strings.Join(args, " ")
		if color == ColorSDR && !strings.Contains(joined, "setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709") {
			t.Fatalf("hardware frames would trigger implicit software conversion: %s", joined)
		}
		if color == ColorHDR && (!strings.Contains(joined, "hevc_vaapi") || !strings.Contains(joined, "main10") || !strings.Contains(joined, "p010le") || !strings.Contains(joined, "hvc1")) {
			t.Fatalf("HDR lost ten-bit HEVC: %s", joined)
		}
		m.rememberStrategyFailure(strategies[0], color)
		if !m.strategyFailed(strategies[0], color) || m.strategyFailed(strategies[1], color) {
			t.Fatal("decoder failure must leave upload fallback available")
		}
	}
}

func TestAMDToneMappingKeepsHardwareDecodeWithIndependentFallback(t *testing.T) {
	m := &Manager{Hardware: []string{"amd"}, encoders: map[string]bool{"h264_vaapi": true}, filters: map[string]bool{"scale_vaapi": true, "libplacebo": true}, failedStrategies: map[string]bool{}}
	strategies := m.vaapiStrategies(720, ColorSDR, true, "tonemap=hable")
	if len(strategies) != 2 || strategies[0].name != "vaapi-decode-tonemap" || strategies[1].name != "vaapi" {
		t.Fatalf("missing accelerated tone map and upload fallback: %#v", strategies)
	}
	joined := strings.Join(strategies[0].args, " ")
	if strings.Contains(strings.Join(strategies[0].beforeInput, " ")+joined, "vulkan") {
		t.Fatal("AMD tone mapping must not use unsafe Vulkan userptr imports")
	}
	for _, required := range []string{"scale_vaapi", "tonemap=hable", "hwdownload", "h264_vaapi"} {
		if !strings.Contains(joined, required) {
			t.Fatalf("tone mapping path missing %s: %s", required, joined)
		}
	}
	m.rememberStrategyFailure(strategies[0], ColorSDR)
	if m.strategyFailed(strategies[1], ColorSDR) {
		t.Fatal("hardware decoder failure disabled encoding fallback")
	}
}

func TestVAAPIToneMappingRetainsSoftwareFilter(t *testing.T) {
	m := &Manager{Hardware: []string{"amd"}, encoders: map[string]bool{"h264_vaapi": true}, filters: map[string]bool{}}
	strategies := m.vaapiStrategies(720, ColorSDR, true, "tonemap=hable")
	if len(strategies) != 1 || !strings.Contains(strings.Join(strategies[0].args, " "), "tonemap=hable") {
		t.Fatalf("HDR-to-SDR must not lose tone mapping: %#v", strategies)
	}
	m.Hardware = []string{"nvidia"}
	if len(m.vaapiStrategies(720, ColorSDR, false, "scale")) != 0 {
		t.Fatal("NVIDIA-only configuration attempted VAAPI")
	}
}
