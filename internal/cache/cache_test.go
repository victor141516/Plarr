package cache

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestStartupCleanupAndEviction(t *testing.T) {
	root := t.TempDir()
	os.WriteFile(filepath.Join(root, "old"), make([]byte, 20), 0o644)
	m := New(root, 10)
	if err := m.ClearStartup(); err != nil {
		t.Fatal(err)
	}
	entries, _ := os.ReadDir(root)
	if len(entries) != 0 {
		t.Fatal("startup cache not empty")
	}
	os.WriteFile(filepath.Join(root, "a"), make([]byte, 20), 0o644)
	if err := m.Evict(); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(root, "a")); !os.IsNotExist(err) {
		t.Fatal("cache limit did not evict cold file")
	}
}

func TestEvictionKeepsEveryFileOwnedByAnActiveStream(t *testing.T) {
	root := t.TempDir()
	activeKey := "activehash"
	activeDir := filepath.Join(root, activeKey)
	if err := os.Mkdir(activeDir, 0o755); err != nil {
		t.Fatal(err)
	}
	activeSegment := filepath.Join(activeDir, "segment-00000.m4s")
	if err := os.WriteFile(activeSegment, make([]byte, 20), 0o644); err != nil {
		t.Fatal(err)
	}
	coldFile := filepath.Join(root, "coldhash.jpg")
	if err := os.WriteFile(coldFile, make([]byte, 20), 0o644); err != nil {
		t.Fatal(err)
	}

	m := New(root, 0)
	release := m.Acquire(activeKey)
	defer release()
	if err := m.Evict(); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(activeSegment); err != nil {
		t.Fatalf("active HLS segment was evicted: %v", err)
	}
	if _, err := os.Stat(coldFile); !os.IsNotExist(err) {
		t.Fatal("cold preview was not evicted")
	}
}

func TestEvictionNeverLeavesAnHLSPlaylistWithoutItsInitSegment(t *testing.T) {
	root := t.TempDir()
	stream := filepath.Join(root, "movie")
	if err := os.Mkdir(stream, 0o755); err != nil {
		t.Fatal(err)
	}
	for name, size := range map[string]int{"init.mp4": 2, "index.m3u8": 2, "segment-00000.m4s": 20} {
		if err := os.WriteFile(filepath.Join(stream, name), make([]byte, size), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	// The init segment is normally the oldest file. File-by-file eviction
	// previously removed it while retaining a playlist that still referred to it.
	if err := os.Chtimes(filepath.Join(stream, "init.mp4"), time.Now().Add(-time.Hour), time.Now().Add(-time.Hour)); err != nil {
		t.Fatal(err)
	}
	m := New(root, 21)
	if err := m.Evict(); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"init.mp4", "index.m3u8", "segment-00000.m4s"} {
		if _, err := os.Stat(filepath.Join(stream, name)); !os.IsNotExist(err) {
			t.Fatalf("%s remains in a partially evicted HLS stream: %v", name, err)
		}
	}
}

func TestAcquireDoesNotWaitForAnEvictionScan(t *testing.T) {
	m := New(t.TempDir(), 0)
	scanStarted := make(chan struct{})
	releaseScan := make(chan struct{})
	m.scan = func(string) ([]entry, int64, error) {
		close(scanStarted)
		<-releaseScan
		return nil, 0, nil
	}
	evictionDone := make(chan error, 1)
	go func() { evictionDone <- m.Evict() }()
	<-scanStarted

	acquired := make(chan struct{})
	go func() {
		release := m.Acquire("playback")
		release()
		close(acquired)
	}()
	select {
	case <-acquired:
	case <-time.After(250 * time.Millisecond):
		t.Fatal("active stream acquisition was blocked by a cache scan")
	}
	close(releaseScan)
	if err := <-evictionDone; err != nil {
		t.Fatal(err)
	}
}

func TestEvictionRemovalBlocksOnlyTheEntryBeingRemoved(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "cold.jpg"), []byte("cold"), 0o644); err != nil {
		t.Fatal(err)
	}
	m := New(root, 0)
	removing := make(chan struct{})
	continueRemoval := make(chan struct{})
	m.remove = func(path string) error {
		close(removing)
		<-continueRemoval
		return os.Remove(path)
	}
	evictionDone := make(chan error, 1)
	go func() { evictionDone <- m.Evict() }()
	<-removing

	unrelatedAcquired := make(chan struct{})
	go func() {
		m.Acquire("other")()
		close(unrelatedAcquired)
	}()
	select {
	case <-unrelatedAcquired:
	case <-time.After(250 * time.Millisecond):
		t.Fatal("removing a cold entry blocked another playback window")
	}

	coldAcquired := make(chan struct{})
	go func() {
		m.Acquire("cold")()
		close(coldAcquired)
	}()
	select {
	case <-coldAcquired:
		t.Fatal("a new owner entered an entry while it was being removed")
	case <-time.After(20 * time.Millisecond):
	}
	close(continueRemoval)
	if err := <-evictionDone; err != nil {
		t.Fatal(err)
	}
	select {
	case <-coldAcquired:
	case <-time.After(time.Second):
		t.Fatal("entry acquisition stayed blocked after eviction finished")
	}
}

func TestCacheKeyGroupsStreamFilesAndPreviewTemporaries(t *testing.T) {
	streamPath := filepath.Join("streamhash", "index.m3u8")
	for input, want := range map[string]string{
		streamPath:                "streamhash",
		"previewhash.jpg":         "previewhash",
		"previewhash.jpg.tmp.jpg": "previewhash",
	} {
		if got := cacheKey(input); got != want {
			t.Errorf("cacheKey(%q) = %q, want %q", input, got, want)
		}
	}
}
