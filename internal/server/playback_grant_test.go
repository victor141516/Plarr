package server

import (
	"bytes"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/victor141516/Plarr/internal/config"
	"github.com/victor141516/Plarr/internal/media"
)

func TestPlaybackGrantProtectsAndScopesMediaRoutes(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "one.mp4"), []byte("one"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "two.mp4"), []byte("two"), 0o600); err != nil {
		t.Fatal(err)
	}
	s := &Server{
		Config: config.Config{APIKey: "secret", FrontendDir: t.TempDir()},
		Media:  media.Resolver{Root: root},
		Log:    slog.New(slog.NewTextHandler(io.Discard, nil)),
	}
	handler := s.Handler()
	oneID := media.Encode("one.mp4")
	twoID := media.Encode("two.mp4")

	request := httptest.NewRequest(http.MethodGet, "/api/v1/media/"+oneID+"/bandwidth-probe", nil)
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusUnauthorized {
		t.Fatalf("ungranted media status = %d", response.Code)
	}
	if !strings.Contains(response.Body.String(), "playback_grant_missing") {
		t.Fatalf("ungranted media body = %s", response.Body.String())
	}

	body, _ := json.Marshal(map[string]string{"apiKey": "secret", "mediaId": oneID})
	request = httptest.NewRequest(http.MethodPost, "/api/v1/auth/playback-grants", bytes.NewReader(body))
	response = httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusCreated {
		t.Fatalf("grant status = %d, body = %s", response.Code, response.Body.String())
	}
	var grant struct {
		PlaybackToken string `json:"playbackToken"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &grant); err != nil || grant.PlaybackToken == "" {
		t.Fatalf("grant response = %q, %v", response.Body.String(), err)
	}

	request = httptest.NewRequest(http.MethodGet, "/api/v1/media/"+oneID+"/bandwidth-probe?playback_token="+grant.PlaybackToken, nil)
	response = httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusOK || response.Header().Get("Cache-Control") != "private, no-store" {
		t.Fatalf("granted media = %d, cache = %q", response.Code, response.Header().Get("Cache-Control"))
	}

	request = httptest.NewRequest(http.MethodGet, "/api/v1/media/"+twoID+"/bandwidth-probe?playback_token="+grant.PlaybackToken, nil)
	response = httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusForbidden || !strings.Contains(response.Body.String(), "playback_grant_wrong_media") {
		t.Fatalf("wrong media = %d, body = %s", response.Code, response.Body.String())
	}
}

func TestPlaybackGrantIsOptional(t *testing.T) {
	s := &Server{Config: config.Config{FrontendDir: t.TempDir()}, Media: media.Resolver{Root: t.TempDir()}, Log: slog.New(slog.NewTextHandler(io.Discard, nil))}
	response := httptest.NewRecorder()
	s.Handler().ServeHTTP(response, httptest.NewRequest(http.MethodPost, "/api/v1/auth/playback-grants", bytes.NewBufferString(`{}`)))
	if response.Code != http.StatusNotFound {
		t.Fatalf("disabled grant status = %d", response.Code)
	}
}
