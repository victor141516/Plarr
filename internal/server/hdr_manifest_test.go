package server

import (
	"testing"

	"github.com/victor141516/Plarr/internal/probe"
)

func TestHLSVideoCodecDescribesHEVCMain10(t *testing.T) {
	got := hlsVideoCodec(&probe.Stream{CodecName: "hevc", Profile: "Main 10", PixFmt: "yuv420p10le"})
	if got != "hvc1.2.4.L153.B0" {
		t.Fatalf("unexpected Main 10 codec string: %s", got)
	}
}
