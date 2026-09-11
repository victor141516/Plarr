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
