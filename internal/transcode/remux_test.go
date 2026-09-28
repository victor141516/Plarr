package transcode

import (
	"slices"
	"strings"
	"testing"

	"github.com/victor141516/Plarr/internal/probe"
)

func remuxProbe(codec string) probe.Result {
	return probe.Result{Audio: []probe.Stream{{Index: 1, CodecName: codec}}}
}

func TestStreamRemuxKeepsAndMutesAudioPrerollWhenTranscoding(t *testing.T) {
	args := streamRemuxArgs("movie.mkv", remuxProbe("ac3"), 4534.228, 1)
	joined := strings.Join(args, " ")
	if !strings.Contains(joined, "-copyts -start_at_zero -ss 4534.228 -noaccurate_seek -i movie.mkv") {
		t.Fatalf("seek does not keep the audio pre-roll: %s", joined)
	}
	if !strings.Contains(joined, "-af volume=enable='lt(t,4534.228)':volume=0") {
		t.Fatalf("audio pre-roll is not muted up to the requested timestamp: %s", joined)
	}
	if !strings.Contains(joined, "-c:v copy") || !strings.Contains(joined, "-c:a aac") {
		t.Fatalf("compatibility remux changed its codecs unexpectedly: %s", joined)
	}
}

func TestStreamRemuxDoesNotFilterCompatibleCopiedAudio(t *testing.T) {
	args := streamRemuxArgs("movie.mkv", remuxProbe("aac"), 4534.228, 1)
	if !slices.Contains(args, "-noaccurate_seek") {
		t.Fatalf("copied audio did not retain the source keyframe pre-roll: %v", args)
	}
	if slices.Contains(args, "-af") {
		t.Fatalf("copied audio received a transcoding filter: %v", args)
	}
	if !strings.Contains(strings.Join(args, " "), "-c:v copy -c:a copy") {
		t.Fatalf("compatible streams were not copied: %v", args)
	}
}

func TestStreamRemuxTranscodesMP3ForBrowserCompatibility(t *testing.T) {
	args := streamRemuxArgs("movie.mkv", remuxProbe("mp3"), 4534.228, 1)
	joined := strings.Join(args, " ")
	if !strings.Contains(joined, "-c:v copy") || !strings.Contains(joined, "-c:a aac") {
		t.Fatalf("MP3 audio was not converted for fragmented MP4 playback: %s", joined)
	}
	if !slices.Contains(args, "-af") {
		t.Fatalf("transcoded MP3 did not retain muted keyframe pre-roll: %v", args)
	}
}

func TestStreamRemuxCopiesMP3OnlyWhenRequested(t *testing.T) {
	args := streamRemuxArgs("movie.mkv", remuxProbe("mp3"), 4534.228, 1, true)
	joined := strings.Join(args, " ")
	if !strings.Contains(joined, "-c:v copy -c:a copy") || slices.Contains(args, "-af") {
		t.Fatalf("supported MP3 was encoded or filtered instead of copied: %s", joined)
	}
}

func TestStreamRemuxDoesNotAddSeekFlagsAtTheBeginning(t *testing.T) {
	args := streamRemuxArgs("movie.mkv", remuxProbe("aac"), 0, 1)
	if slices.Contains(args, "-copyts") || slices.Contains(args, "-start_at_zero") || slices.Contains(args, "-ss") {
		t.Fatalf("zero-start remux received unnecessary seek flags: %v", args)
	}
}
