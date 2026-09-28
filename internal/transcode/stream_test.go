package transcode

import (
	"bytes"
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/victor141516/Plarr/internal/cache"
)

func TestStartupWriterDoesNotCommitPartialEncoderAttempt(t *testing.T) {
	var dst bytes.Buffer
	w := &startupWriter{dst: &dst, limit: 8}
	if _, err := w.Write([]byte("broken")); err != nil {
		t.Fatal(err)
	}
	if w.committed || dst.Len() != 0 {
		t.Fatal("startup bytes were committed before the encoder proved viable")
	}
}

func TestStartupWriterFlushesAndThenStreams(t *testing.T) {
	var dst bytes.Buffer
	w := &startupWriter{dst: &dst, limit: 8}
	if _, err := w.Write([]byte("fragment")); err != nil {
		t.Fatal(err)
	}
	if !w.committed || dst.String() != "fragment" {
		t.Fatalf("startup buffer was not flushed: committed=%v output=%q", w.committed, dst.String())
	}
	if _, err := w.Write([]byte("-next")); err != nil {
		t.Fatal(err)
	}
	if dst.String() != "fragment-next" {
		t.Fatalf("subsequent bytes were not streamed: %q", dst.String())
	}
}

func TestStreamReturnsWhenFirstSegmentIsPublished(t *testing.T) {
	root := t.TempDir()
	target := filepath.Join(root, "job", "index.m3u8")
	m := &Manager{Cache: cache.New(root, 1<<30), running: map[string]*job{}}
	releaseJob := make(chan struct{})
	jobDone := make(chan struct{})

	err := m.stream(context.Background(), "job", target, ".ts", "", "0", "video", func(context.Context) error {
		defer close(jobDone)
		if err := os.MkdirAll(filepath.Dir(target), 0o750); err != nil {
			return err
		}
		if err := os.WriteFile(target, []byte("#EXTM3U\nsegment-00000.ts\n"), 0o640); err != nil {
			return err
		}
		<-releaseJob
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	select {
	case <-jobDone:
		t.Fatal("stream waited for the complete background job")
	default:
	}
	close(releaseJob)
	select {
	case <-jobDone:
	case <-time.After(time.Second):
		t.Fatal("background job did not finish")
	}
}

func TestStreamSurvivesRequestCancellation(t *testing.T) {
	root := t.TempDir()
	target := filepath.Join(root, "job", "index.m3u8")
	m := &Manager{Cache: cache.New(root, 1<<30), running: map[string]*job{}}
	allowPublish := make(chan struct{})
	jobDone := make(chan struct{})
	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	err := m.stream(ctx, "job", target, ".aac", "", "0", "audio", func(context.Context) error {
		defer close(jobDone)
		<-allowPublish
		if err := os.MkdirAll(filepath.Dir(target), 0o750); err != nil {
			return err
		}
		return os.WriteFile(target, []byte("#EXTM3U\naudio-00000.aac\n"), 0o640)
	})
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("expected canceled request, got %v", err)
	}
	close(allowPublish)
	select {
	case <-jobDone:
	case <-time.After(time.Second):
		t.Fatal("canceled request killed the background job")
	}
	if !playlistReady(target, ".aac") {
		t.Fatal("background job did not publish its playlist")
	}
}

func TestStartingANewVideoLaneCancelsThePreviousVideoJob(t *testing.T) {
	root := t.TempDir()
	m := &Manager{Cache: cache.New(root, 1<<30), running: map[string]*job{}}
	firstTarget := filepath.Join(root, "first", "index.m3u8")
	firstCanceled := make(chan struct{})
	if err := m.stream(context.Background(), "first", firstTarget, ".ts", "session", "0", "video", func(ctx context.Context) error {
		if err := os.MkdirAll(filepath.Dir(firstTarget), 0o750); err != nil {
			return err
		}
		if err := os.WriteFile(firstTarget, []byte("#EXTM3U\nsegment-00000.ts\n"), 0o640); err != nil {
			return err
		}
		<-ctx.Done()
		close(firstCanceled)
		return ctx.Err()
	}); err != nil {
		t.Fatal(err)
	}

	secondTarget := filepath.Join(root, "second", "index.m3u8")
	if err := m.stream(context.Background(), "second", secondTarget, ".m4s", "session", "0", "video", func(context.Context) error {
		if err := os.MkdirAll(filepath.Dir(secondTarget), 0o750); err != nil {
			return err
		}
		return os.WriteFile(secondTarget, []byte("#EXTM3U\nsegment-00000.m4s\n"), 0o640)
	}); err != nil {
		t.Fatal(err)
	}
	select {
	case <-firstCanceled:
	case <-time.After(time.Second):
		t.Fatal("previous video job continued after a source switch")
	}
}

func TestCancelSessionStopsEveryPlaybackLane(t *testing.T) {
	root := t.TempDir()
	m := &Manager{Cache: cache.New(root, 1<<30), running: map[string]*job{}}
	canceled := make(chan string, 2)

	start := func(key, suffix, lane string) {
		t.Helper()
		target := filepath.Join(root, key, "index.m3u8")
		if err := m.stream(context.Background(), key, target, suffix, "session", "0", lane, func(ctx context.Context) error {
			if err := os.MkdirAll(filepath.Dir(target), 0o750); err != nil {
				return err
			}
			segment := "segment-00000" + suffix
			if err := os.WriteFile(target, []byte("#EXTM3U\n"+segment+"\n"), 0o640); err != nil {
				return err
			}
			<-ctx.Done()
			canceled <- lane
			return ctx.Err()
		}); err != nil {
			t.Fatal(err)
		}
	}

	start("video", ".ts", "video")
	start("audio", ".aac", "audio")
	m.CancelSession("session")

	seen := map[string]bool{}
	for len(seen) < 2 {
		select {
		case lane := <-canceled:
			seen[lane] = true
		case <-time.After(time.Second):
			t.Fatalf("session cancellation left a playback lane running: %#v", seen)
		}
	}
}

func TestExpiredSessionLeaseCancelsItsBackgroundJobs(t *testing.T) {
	root := t.TempDir()
	m := &Manager{
		Cache:         cache.New(root, 1<<30),
		running:       map[string]*job{},
		sessionLeases: map[string]*sessionLease{},
		sessionIdle:   20 * time.Millisecond,
	}
	target := filepath.Join(root, "leased", "index.m3u8")
	canceled := make(chan struct{})
	if err := m.stream(context.Background(), "leased", target, ".ts", "browser-session", "0", "video", func(ctx context.Context) error {
		if err := os.MkdirAll(filepath.Dir(target), 0o750); err != nil {
			return err
		}
		if err := os.WriteFile(target, []byte("#EXTM3U\nsegment-00000.ts\n"), 0o640); err != nil {
			return err
		}
		<-ctx.Done()
		close(canceled)
		return ctx.Err()
	}); err != nil {
		t.Fatal(err)
	}
	select {
	case <-canceled:
	case <-time.After(time.Second):
		t.Fatal("background job survived after its browser session lease expired")
	}
}

func TestInspectPlaylistFindsReusableProgress(t *testing.T) {
	target := filepath.Join(t.TempDir(), "index.m3u8")
	contents := "#EXTM3U\n#EXTINF:2.000,\nsegment-00000.ts\n#EXTINF:1.750,\nsegment-00001.ts\n"
	if err := os.WriteFile(target, []byte(contents), 0o640); err != nil {
		t.Fatal(err)
	}
	state := inspectPlaylist(target, ".ts")
	if state.segments != 2 || state.duration != 3.75 || state.complete {
		t.Fatalf("unexpected playlist state: %#v", state)
	}
}

func TestHLSStartNumberStaysStableWhenGenerationResumes(t *testing.T) {
	if got := hlsStartNumber(3594, 0); got != 1797 {
		t.Fatalf("unexpected first segment number: %d", got)
	}
	if got := hlsStartNumber(3594, 8); got != 1797 {
		t.Fatalf("unexpected resumed segment number: %d", got)
	}
}

func TestWaitForGeneratedFileWaitsForTheExactSegment(t *testing.T) {
	root := t.TempDir()
	target := filepath.Join(root, "job", "segment-00001.m4s")
	active := &job{done: make(chan struct{})}
	m := &Manager{Cache: cache.New(root, 1<<30), running: map[string]*job{"job": active}}

	go func() {
		time.Sleep(20 * time.Millisecond)
		_ = os.MkdirAll(filepath.Dir(target), 0o750)
		_ = os.WriteFile(target, []byte("segment"), 0o640)
		close(active.done)
	}()
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	if err := m.waitForGeneratedFile(ctx, "job", target); err != nil {
		t.Fatalf("exact segment was not observed: %v", err)
	}
}

func TestWaitForGeneratedFileReturnsTheGenerationFailure(t *testing.T) {
	root := t.TempDir()
	target := filepath.Join(root, "job", "segment-00001.m4s")
	want := errors.New("ffmpeg stopped")
	active := &job{done: make(chan struct{}), err: want}
	close(active.done)
	m := &Manager{Cache: cache.New(root, 1<<30), running: map[string]*job{"job": active}}

	if err := m.waitForGeneratedFile(context.Background(), "job", target); !errors.Is(err, want) {
		t.Fatalf("expected generation error %v, got %v", want, err)
	}
}

func TestRepairPlaylistDropsAnUnpublishedTrailingSegment(t *testing.T) {
	dir := t.TempDir()
	target := filepath.Join(dir, "index.m3u8")
	contents := "#EXTM3U\n#EXT-X-MEDIA-SEQUENCE:10\n#EXTINF:2.000,\nsegment-00010.m4s\n#EXTINF:2.000,\nsegment-00011.m4s\n"
	if err := os.WriteFile(target, []byte(contents), 0o640); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "segment-00010.m4s"), []byte("published"), 0o640); err != nil {
		t.Fatal(err)
	}

	state := repairPlaylistForResume(target, ".m4s")
	if state.segments != 1 || state.duration != 2 || state.complete {
		t.Fatalf("unexpected repaired state: %#v", state)
	}
	repaired, err := os.ReadFile(target)
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(repaired, []byte("segment-00011.m4s")) {
		t.Fatalf("unpublished segment remained in repaired playlist: %s", repaired)
	}
}

func TestExpireInterruptedVideoWindowRetiresPartialCache(t *testing.T) {
	root := t.TempDir()
	dir := filepath.Join(root, "partial")
	target := filepath.Join(dir, "index.m3u8")
	if err := os.MkdirAll(dir, 0o750); err != nil {
		t.Fatal(err)
	}
	contents := "#EXTM3U\n#EXTINF:2.000,\nsegment-00000.m4s\n"
	if err := os.WriteFile(target, []byte(contents), 0o640); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "segment-00000.m4s"), []byte("partial"), 0o640); err != nil {
		t.Fatal(err)
	}
	m := &Manager{Cache: cache.New(root, 1<<30), running: map[string]*job{}}

	if !m.expireInterruptedHLSWindow("partial", target, ".m4s") {
		t.Fatal("partial inactive HLS cache was not retired")
	}
	if _, err := os.Stat(dir); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("retired cache directory still exists: %v", err)
	}
}

func TestExpireInterruptedVideoWindowPreservesActiveAndCompleteCaches(t *testing.T) {
	root := t.TempDir()
	writeWindow := func(name, trailer string) string {
		dir := filepath.Join(root, name)
		if err := os.MkdirAll(dir, 0o750); err != nil {
			t.Fatal(err)
		}
		target := filepath.Join(dir, "index.m3u8")
		contents := "#EXTM3U\n#EXTINF:2.000,\nsegment-00000.m4s\n" + trailer
		if err := os.WriteFile(target, []byte(contents), 0o640); err != nil {
			t.Fatal(err)
		}
		return target
	}
	activeTarget := writeWindow("active", "")
	completeTarget := writeWindow("complete", "#EXT-X-ENDLIST\n")
	m := &Manager{
		Cache: cache.New(root, 1<<30),
		running: map[string]*job{
			"active": {done: make(chan struct{})},
		},
	}

	if m.expireInterruptedHLSWindow("active", activeTarget, ".m4s") {
		t.Fatal("active cache was retired")
	}
	if m.expireInterruptedHLSWindow("complete", completeTarget, ".m4s") {
		t.Fatal("complete cache was retired")
	}
}

func TestExpireInterruptedHLSWindowAlsoRetiresPartialAudio(t *testing.T) {
	root := t.TempDir()
	dir := filepath.Join(root, "audio")
	if err := os.MkdirAll(dir, 0o750); err != nil {
		t.Fatal(err)
	}
	target := filepath.Join(dir, "index.m3u8")
	playlist := "#EXTM3U\n#EXT-X-MEDIA-SEQUENCE:10\n#EXTINF:2.000,\naudio-00010.aac\n"
	if err := os.WriteFile(target, []byte(playlist), 0o640); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "audio-00010.aac"), []byte("partial"), 0o640); err != nil {
		t.Fatal(err)
	}
	m := &Manager{Cache: cache.New(root, 1<<30), running: map[string]*job{}}

	if !m.expireInterruptedHLSWindow("audio", target, ".aac") {
		t.Fatal("partial inactive audio cache was not retired")
	}
	if _, err := os.Stat(dir); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("retired audio cache directory still exists: %v", err)
	}
}

func TestAudioHLSRequiresFreshWindowAfterItsLeaseWasInterrupted(t *testing.T) {
	root := t.TempDir()
	m := &Manager{Cache: cache.New(root, 1<<30), running: map[string]*job{}}
	key := audioHLSCacheKey(m, "movie.mkv", 1, 120, false, "aac")
	dir := filepath.Join(root, key)
	if err := os.MkdirAll(dir, 0o750); err != nil {
		t.Fatal(err)
	}
	target := filepath.Join(dir, "index.m3u8")
	playlist := "#EXTM3U\n#EXT-X-MEDIA-SEQUENCE:60\n#EXTINF:2.000,\naudio-00060.aac\n"
	if err := os.WriteFile(target, []byte(playlist), 0o640); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "audio-00060.aac"), []byte("partial"), 0o640); err != nil {
		t.Fatal(err)
	}

	if _, err := m.AudioHLS(context.Background(), "movie.mkv", 1, 120, "session", false, "aac", 2); !errors.Is(err, ErrHLSWindowExpired) {
		t.Fatalf("AudioHLS error = %v, want ErrHLSWindowExpired", err)
	}
}
