package server

import (
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/victor141516/Plarr/internal/transcode"
)

func TestPlaybackDiagnosticsReturnsAnEmptyTypedTrace(t *testing.T) {
	s := &Server{
		Transcode: &transcode.Manager{},
		Log:       slog.New(slog.NewTextHandler(io.Discard, nil)),
	}
	request := httptest.NewRequest(http.MethodGet, "/api/v1/playback/sessions/browser-session/diagnostics", nil)
	response := httptest.NewRecorder()

	s.Handler().ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("unexpected status: %d", response.Code)
	}
	if !strings.Contains(response.Body.String(), `"attempts":[]`) {
		t.Fatalf("unexpected response: %s", response.Body.String())
	}
}

func TestPlaybackDiagnosticsRejectsInvalidSession(t *testing.T) {
	s := &Server{
		Transcode: &transcode.Manager{},
		Log:       slog.New(slog.NewTextHandler(io.Discard, nil)),
	}
	request := httptest.NewRequest(http.MethodGet, "/api/v1/playback/sessions/invalid%20session/diagnostics", nil)
	response := httptest.NewRecorder()

	s.Handler().ServeHTTP(response, request)

	if response.Code != http.StatusBadRequest {
		t.Fatalf("unexpected status: %d", response.Code)
	}
}
