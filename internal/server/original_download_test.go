package server

import (
	"bytes"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/victor141516/Plarr/internal/media"
	"github.com/victor141516/Plarr/internal/transcode"
)

func originalDownloadTestServer(t *testing.T, name string, contents []byte) (*Server, string) {
	t.Helper()
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, name), contents, 0o640); err != nil {
		t.Fatal(err)
	}
	return &Server{
		Media:     media.Resolver{Root: root},
		Transcode: &transcode.Manager{},
		Log:       slog.New(slog.NewTextHandler(io.Discard, nil)),
	}, media.Encode(name)
}

func TestOriginalDownloadReturnsSourceBytesAndFilename(t *testing.T) {
	source := []byte{0x1a, 0x45, 0xdf, 0xa3, 0x00, 0xff, 0x10, 0x80, 0x42}
	s, id := originalDownloadTestServer(t, "Original Movie (2026).mkv", source)
	req := httptest.NewRequest(http.MethodGet, "/api/v1/media/"+id+"/download/original", nil)
	rec := httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("unexpected status: %d", rec.Code)
	}
	if !bytes.Equal(rec.Body.Bytes(), source) {
		t.Fatalf("download bytes differ from the source: got %x want %x", rec.Body.Bytes(), source)
	}
	if disposition := rec.Header().Get("Content-Disposition"); !strings.Contains(disposition, "Original Movie (2026).mkv") {
		t.Fatalf("original filename was not preserved: %q", disposition)
	}
	if got := rec.Header().Get("Content-Length"); got != "9" {
		t.Fatalf("source size was not preserved: %q", got)
	}
	if got := rec.Header().Get("Cache-Control"); got != "private, no-transform" {
		t.Fatalf("intermediaries were not forbidden from transforming the source: %q", got)
	}
}

func TestOriginalDownloadRangeIsReadFromSourceFile(t *testing.T) {
	source := []byte("0123456789abcdef")
	s, id := originalDownloadTestServer(t, "source.mp4", source)
	req := httptest.NewRequest(http.MethodGet, "/api/v1/media/"+id+"/download/original", nil)
	req.Header.Set("Range", "bytes=4-9")
	rec := httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusPartialContent || rec.Body.String() != "456789" {
		t.Fatalf("range was not served directly from the source: status=%d body=%q", rec.Code, rec.Body.String())
	}
	if got := rec.Header().Get("Content-Range"); got != "bytes 4-9/16" {
		t.Fatalf("unexpected source range: %q", got)
	}
}
