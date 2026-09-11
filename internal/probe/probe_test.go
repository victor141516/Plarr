package probe

import "testing"

func TestIsHDRUsesTransferFunctionInsteadOfBitDepthAlone(t *testing.T) {
	if !IsHDR(&Stream{PixFmt: "yuv420p10le", ColorTransfer: "smpte2084"}) {
		t.Fatal("PQ Main 10 stream was not recognised as HDR")
	}
	if !IsHDR(&Stream{ColorTransfer: "arib-std-b67"}) {
		t.Fatal("HLG stream was not recognised as HDR")
	}
	if IsHDR(&Stream{PixFmt: "yuv420p10le", ColorTransfer: "bt709"}) {
		t.Fatal("ten-bit SDR must not be reported as HDR")
	}
}

func TestStreamDurationPrefersNumericDuration(t *testing.T) {
	stream := &Stream{Duration: "12.375", Tags: map[string]string{"DURATION": "00:00:20.000"}}
	if got := streamDurationSeconds(stream); got != 12.375 {
		t.Fatalf("streamDurationSeconds() = %f, want 12.375", got)
	}
}

func TestStreamDurationParsesMatroskaDurationTag(t *testing.T) {
	stream := &Stream{Tags: map[string]string{"DURATION": "02:25:33.975000000"}}
	if got := streamDurationSeconds(stream); got != 8733.975 {
		t.Fatalf("streamDurationSeconds() = %f, want 8733.975", got)
	}
}
