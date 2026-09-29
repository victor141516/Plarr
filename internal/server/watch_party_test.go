package server

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/coder/websocket/wsjson"
	"github.com/victor141516/Plarr/internal/config"
	"github.com/victor141516/Plarr/internal/media"
	"github.com/victor141516/Plarr/internal/watchparty"
)

func TestWatchPartyShareLinkAndSocketSynchronizeGuests(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "movie.mp4"), []byte("video"), 0o600); err != nil {
		t.Fatal(err)
	}
	server := &Server{Config: config.Config{APIKey: "secret", PublicOrigin: "https://plarr.example", FrontendDir: t.TempDir()}, Media: media.Resolver{Root: root}, Log: slog.New(slog.NewTextHandler(io.Discard, nil))}
	testServer := httptest.NewServer(server.Handler())
	defer testServer.Close()
	mediaID := media.Encode("movie.mp4")
	body, _ := json.Marshal(map[string]string{"apiKey": "secret", "mediaId": mediaID})
	response, err := http.Post(testServer.URL+"/api/v1/watch-parties", "application/json", bytes.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	var created struct {
		RoomID    string `json:"roomId"`
		PlayerURL string `json:"playerUrl"`
	}
	if err = json.NewDecoder(response.Body).Decode(&created); err != nil || response.StatusCode != 201 || created.RoomID == "" {
		t.Fatalf("create: %v %v %+v", response.StatusCode, err, created)
	}
	if !strings.Contains(created.PlayerURL, "room="+created.RoomID) || !strings.Contains(created.PlayerURL, "playbackToken=") {
		t.Fatalf("share URL: %s", created.PlayerURL)
	}
	token := strings.Split(strings.Split(created.PlayerURL, "playbackToken=")[1], "&")[0]
	endpoint := testServer.URL + "/api/v1/watch-parties/" + created.RoomID + "/connect"
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if _, res, err := websocket.Dial(ctx, endpoint, nil); err == nil || res == nil || res.StatusCode != http.StatusUnauthorized {
		t.Fatalf("missing token: %v %v", res, err)
	}
	first, _, err := websocket.Dial(ctx, endpoint+"?playback_token="+token, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer first.Close(websocket.StatusNormalClosure, "")
	second, _, err := websocket.Dial(ctx, endpoint+"?playback_token="+token, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer second.Close(websocket.StatusNormalClosure, "")
	if err = wsjson.Write(ctx, first, watchparty.Event{Type: "ping", ClientTime: 42}); err != nil {
		t.Fatal(err)
	}
	for {
		var packet struct {
			Type       string  `json:"type"`
			ClientTime float64 `json:"clientTime"`
			ServerTime int64   `json:"serverTime"`
		}
		if err = wsjson.Read(ctx, first, &packet); err != nil {
			t.Fatal(err)
		}
		if packet.Type == "pong" {
			if packet.ClientTime != 42 || packet.ServerTime == 0 {
				t.Fatalf("invalid clock response: %+v", packet)
			}
			break
		}
	}
	if err = wsjson.Write(ctx, first, watchparty.Event{Type: "ready"}); err != nil {
		t.Fatal(err)
	}
	if err = wsjson.Write(ctx, second, watchparty.Event{Type: "ready"}); err != nil {
		t.Fatal(err)
	}
	for {
		var state watchparty.State
		if err = wsjson.Read(ctx, second, &state); err != nil {
			t.Fatal(err)
		}
		if state.Participants == 2 && state.Playing && state.Buffering == 0 {
			break
		}
	}
	if err = wsjson.Write(ctx, first, watchparty.Event{Type: "pause"}); err != nil {
		t.Fatal(err)
	}
	for {
		var state watchparty.State
		if err = wsjson.Read(ctx, second, &state); err != nil {
			t.Fatal(err)
		}
		if state.Participants == 2 && !state.Intent && !state.Playing {
			break
		}
	}
}
