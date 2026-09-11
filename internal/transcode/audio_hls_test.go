package transcode

import (
	"strings"
	"testing"

	"github.com/victor141516/Plarr/internal/config"
)

func TestAudioHLSStartsOnTheSameTimelineAsVideoHLS(t *testing.T) {
	args := audioHLSArgs("movie.mkv", 1, 880, "cache", "cache/index.m3u8", 440, false)
	joined := strings.Join(args, " ")
	if !strings.Contains(joined, "-muxdelay 0 -f hls") {
		t.Fatalf("audio HLS retained FFmpeg's default 1.4 second MPEG timestamp offset: %s", joined)
	}
	if !strings.Contains(joined, "-copyts -start_at_zero -ss 880.000") {
		t.Fatalf("audio HLS did not preserve the source timeline across level switches: %s", joined)
	}
}

func TestEveryVideoContainerUsesTheSourcePTSWithoutMuxOffset(t *testing.T) {
	r := config.Rendition{Label: "240p", Height: 240, VideoBitrate: 180_000}
	for _, color := range []ColorMode{ColorSDR, ColorHDR} {
		joined := strings.Join(hlsVideoOutputArgs(r, 1286, 0, color, "cache", "cache/index.m3u8"), " ")
		if !strings.Contains(joined, "-force_key_frames source") {
			t.Fatalf("%s video does not mirror source keyframes: %s", color, joined)
		}
		if !strings.Contains(joined, "-muxdelay 0 -f hls") {
			t.Fatalf("%s video can acquire a container-specific timestamp offset: %s", color, joined)
		}
	}
}

func TestTranscodedVideoHLSKeepsTheSourceTimelineForOriginalSwitches(t *testing.T) {
	joined := strings.Join(hlsVideoInputArgs("movie.mkv", 1286), " ")
	if !strings.Contains(joined, "-copyts -start_at_zero -ss 1286.000 -noaccurate_seek -i movie.mkv") {
		t.Fatalf("transcoded video HLS did not retain the source keyframe pre-roll: %s", joined)
	}
	if expression := hlsForceKeyFrames(); expression != "source" {
		t.Fatalf("transcoded keyframes do not mirror the source timeline: %s", expression)
	}
}

func TestAdaptiveAudioAlwaysKeepsAndMutesTheSharedPreroll(t *testing.T) {
	args := audioHLSArgs("movie.mkv", 1, 1286, "cache", "cache/index.m3u8", 643, false)
	joined := strings.Join(args, " ")
	if !strings.Contains(joined, "-copyts -start_at_zero -ss 1286.000 -noaccurate_seek -i movie.mkv") {
		t.Fatalf("adaptive audio did not retain the same source pre-roll as every video level: %s", joined)
	}
	if !strings.Contains(joined, "-af volume=enable='lt(t,1286.000)':volume=0") {
		t.Fatalf("audio before the requested playback window was not muted: %s", joined)
	}
}
