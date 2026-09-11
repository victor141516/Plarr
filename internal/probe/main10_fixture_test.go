package probe

import (
	"context"
	"os/exec"
	"path/filepath"
	"testing"
)

func TestProbeSyntheticHEVCMain10HDRFixture(t *testing.T) {
	ffmpeg, err := exec.LookPath("ffmpeg")
	if err != nil {
		t.Skip("ffmpeg is not installed")
	}
	ffprobe, err := exec.LookPath("ffprobe")
	if err != nil {
		t.Skip("ffprobe is not installed")
	}
	target := filepath.Join(t.TempDir(), "main10-hdr.mkv")
	args := []string{
		"-hide_banner", "-loglevel", "error", "-y",
		"-f", "lavfi", "-i", "testsrc2=size=320x180:rate=24000/1001",
		"-f", "lavfi", "-i", "sine=frequency=880:sample_rate=48000",
		"-t", "1", "-map", "0:v:0", "-map", "1:a:0",
		"-vf", "format=yuv420p10le", "-c:v", "libx265", "-profile:v", "main10",
		"-color_primaries", "bt2020", "-color_trc", "smpte2084", "-colorspace", "bt2020nc",
		"-c:a", "eac3", target,
	}
	if out, runErr := exec.Command(ffmpeg, args...).CombinedOutput(); runErr != nil {
		t.Skipf("installed ffmpeg cannot create the Main 10 fixture: %v (%s)", runErr, out)
	}
	result, err := (Client{Path: ffprobe}).Probe(context.Background(), target)
	if err != nil {
		t.Fatal(err)
	}
	if result.Video == nil || result.Video.CodecName != "hevc" || result.Video.PixFmt != "yuv420p10le" || !IsHDR(result.Video) {
		t.Fatalf("fixture was not probed as HEVC Main 10 HDR: %#v", result.Video)
	}
	if !result.RemuxCandidate {
		t.Fatal("HEVC Main 10 must remain eligible for an original-video remux")
	}
}
