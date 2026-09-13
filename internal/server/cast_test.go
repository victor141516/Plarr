package server

import (
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/victor141516/Plarr/internal/config"
)

func TestCastCORSPreflightAllowsMediaRangeRequests(t *testing.T) {
	s := &Server{Log: slog.New(slog.NewTextHandler(io.Discard, nil))}
	nextCalled := false
	handler := s.headers(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		nextCalled = true
	}))
	request := httptest.NewRequest(http.MethodOptions, "/api/v1/media/id/hls/master.m3u8", nil)
	response := httptest.NewRecorder()

	handler.ServeHTTP(response, request)

	if response.Code != http.StatusNoContent {
		t.Fatalf("preflight status = %d, want 204", response.Code)
	}
	if nextCalled {
		t.Fatal("preflight reached the media handler")
	}
	if got := response.Header().Get("Access-Control-Allow-Headers"); !strings.Contains(got, "Range") || !strings.Contains(got, "Accept-Encoding") {
		t.Fatalf("Cast media headers are not allowed: %q", got)
	}
	if got := response.Header().Get("Access-Control-Allow-Methods"); !strings.Contains(got, "GET") || !strings.Contains(got, "HEAD") {
		t.Fatalf("Cast media methods are not allowed: %q", got)
	}
}

func TestCastSDKIsAllowedByContentSecurityPolicy(t *testing.T) {
	s := &Server{Log: slog.New(slog.NewTextHandler(io.Discard, nil))}
	handler := s.headers(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/", nil))

	if got := response.Header().Get("Content-Security-Policy"); !strings.Contains(got, "script-src 'self' https://www.gstatic.com") {
		t.Fatalf("Google Cast sender SDK is blocked by CSP: %q", got)
	}
}

func TestRequestedRenditionsLimitsCastMasterToManualQuality(t *testing.T) {
	all := []config.Rendition{
		{Label: "480p", Height: 480},
		{Label: "720p", Height: 720},
	}
	got := requestedRenditions(all, "720P")
	if len(got) != 1 || got[0].Label != "720p" {
		t.Fatalf("manual Cast rendition = %#v, want only 720p", got)
	}
	if got := requestedRenditions(all, ""); len(got) != len(all) {
		t.Fatalf("adaptive Cast master lost renditions: %#v", got)
	}
}
