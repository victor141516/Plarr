package transcode

import (
	"io"
	"log/slog"
	"slices"
	"strings"
	"testing"

	"github.com/victor141516/Plarr/internal/cache"
)

func TestPreviewGenerationHasASeparateBoundedWorkerPool(t *testing.T) {
	manager := New(
		"ffmpeg-that-does-not-exist",
		cache.New(t.TempDir(), 1<<20),
		nil,
		nil,
		slog.New(slog.NewTextHandler(io.Discard, nil)),
	)
	if got := cap(manager.previewSlots); got != 1 {
		t.Fatalf("preview worker capacity = %d, want 1", got)
	}
}

func TestTimelinePreviewPlanRefinesWholeTimelineInPriorityOrder(t *testing.T) {
	got := timelinePreviewPlan(900, 2)
	want := []float64{450, 150, 750, 50, 250, 350, 550, 650, 850}
	if !slices.Equal(got, want) {
		t.Fatalf("timelinePreviewPlan() = %v, want %v", got, want)
	}
}

func TestTimelinePreviewPlanDepthFiveHasExactly243UniqueFrames(t *testing.T) {
	got := timelinePreviewPlan(8733.975, 5)
	if len(got) != 243 {
		t.Fatalf("timelinePreviewPlan() returned %d frames, want 243", len(got))
	}
	seen := map[float64]bool{}
	for _, second := range got {
		if seen[second] {
			t.Fatalf("timelinePreviewPlan() duplicated timestamp %.3f", second)
		}
		seen[second] = true
	}
}

func TestTimelinePreviewBatchUsesOneConcatInputAndBoundedThreads(t *testing.T) {
	args := previewBatchArgs("timeline.ffconcat", "frame-%03d.jpg", 20, true)
	joined := strings.Join(args, " ")
	for _, expected := range []string{
		"-f concat", "-i timeline.ffconcat", "-threads 1", "-filter_threads 1",
		"-hwaccel cuda", "scale_cuda=-2:80", "-frames:v 20", "-atomic_writing 1",
	} {
		if !strings.Contains(joined, expected) {
			t.Fatalf("batch args are missing %q: %s", expected, joined)
		}
	}
	if strings.Count(joined, " -i ") != 1 {
		t.Fatalf("batch must open exactly one concat input: %s", joined)
	}
}

func TestPreviewConcatManifestKeepsRequestedPriority(t *testing.T) {
	manifest := previewConcatManifest("movie.mkv", []float64{450, 150, 750}, 900)
	first := strings.Index(manifest, "inpoint 450.000")
	second := strings.Index(manifest, "inpoint 150.000")
	third := strings.Index(manifest, "inpoint 750.000")
	if first < 0 || second <= first || third <= second {
		t.Fatalf("manifest did not preserve priority order:\n%s", manifest)
	}
}

func TestPreviewFrameUsesFastSeekAndOneTinyJPEG(t *testing.T) {
	args := previewFrameArgs("movie.mkv", 120, "preview.jpg")
	seek := slices.Index(args, "-ss")
	input := slices.Index(args, "-i")
	if seek < 0 || input < 0 || seek > input {
		t.Fatalf("preview seek must happen before opening the input: %v", args)
	}
	joined := strings.Join(args, " ")
	for _, expected := range []string{"-frames:v 1", "scale=-2:80:flags=fast_bilinear", "format=yuvj420p", "-f image2"} {
		if !strings.Contains(joined, expected) {
			t.Fatalf("preview args are missing %q: %s", expected, joined)
		}
	}
}

func TestPreviewFrameCUDAKeepsDecodeAndScaleOnGPU(t *testing.T) {
	args := previewFrameCUDAArgs("movie.mkv", 120, "preview.jpg")
	joined := strings.Join(args, " ")
	for _, expected := range []string{"-hwaccel cuda", "-hwaccel_output_format cuda", "scale_cuda=-2:80:format=yuv420p", "hwdownload", "format=yuvj420p", "-frames:v 1"} {
		if !strings.Contains(joined, expected) {
			t.Fatalf("CUDA preview args are missing %q: %s", expected, joined)
		}
	}
}
