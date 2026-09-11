package server

import (
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestBandwidthProbeIsFixedSizeAndNeverCached(t *testing.T) {
	server := &Server{Log: slog.New(slog.NewTextHandler(io.Discard, nil))}
	request := httptest.NewRequest(http.MethodGet, "/api/v1/media/example/bandwidth-probe", nil)
	response := httptest.NewRecorder()

	server.Handler().ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("unexpected status: %d", response.Code)
	}
	if response.Body.Len() != bandwidthProbeSize {
		t.Fatalf("unexpected payload size: %d", response.Body.Len())
	}
	if got := response.Header().Get("Cache-Control"); got != "no-store" {
		t.Fatalf("unexpected cache control: %q", got)
	}
	if got := response.Header().Get("Content-Type"); got != "application/octet-stream" {
		t.Fatalf("unexpected content type: %q", got)
	}
}
