package server

import (
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/json"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/coder/websocket"
	"github.com/coder/websocket/wsjson"
	"github.com/go-chi/chi/v5"
	"github.com/victor141516/Plarr/internal/watchparty"
)

func (s *Server) createWatchParty(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	var in playbackGrantRequest
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096))
	decoder.DisallowUnknownFields()
	if decoder.Decode(&in) != nil || in.MediaID == "" {
		problem(w, 400, "invalid_watch_party_request", "A media ID is required.")
		return
	}
	if s.Config.APIKey != "" {
		expected := sha256.Sum256([]byte(s.Config.APIKey))
		provided := sha256.Sum256([]byte(in.APIKey))
		if subtle.ConstantTimeCompare(expected[:], provided[:]) != 1 {
			problem(w, 401, "invalid_api_key", "The API key is invalid.")
			return
		}
	}
	_, rel, err := s.Media.ResolveID(in.MediaID)
	if err != nil {
		problem(w, 400, "invalid_media", "The requested media is unavailable.")
		return
	}
	token := ""
	if s.Config.APIKey != "" {
		token, err = s.Grants.Issue(rel)
		if err != nil {
			problem(w, 503, "playback_grant_unavailable", "A playback grant could not be created.")
			return
		}
		// Activate now: a guest can open the share link later than the normal one-minute grant window.
		release, acquireErr := s.Grants.Acquire(token, rel)
		if acquireErr != nil {
			problem(w, 503, "playback_grant_unavailable", "A playback grant could not be activated.")
			return
		}
		release()
	}
	room, err := s.Parties.Create(rel)
	if err != nil {
		problem(w, 503, "watch_party_unavailable", "A watch party could not be created.")
		return
	}
	params := url.Values{}
	params.Set("room", room)
	if token != "" {
		params.Set("playbackToken", token)
	}
	playerURL := strings.TrimRight(s.Config.PublicOrigin, "/") + "/#/play/" + url.PathEscape(in.MediaID) + "?" + params.Encode()
	jsonResponse(w, 201, map[string]any{"roomId": room, "playerUrl": playerURL})
}

func (s *Server) connectWatchParty(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "room")
	media, err := s.Parties.Media(id)
	if err != nil {
		problem(w, 404, "watch_party_not_found", "The watch party is unavailable.")
		return
	}
	release := func() {}
	if s.Config.APIKey != "" {
		release, err = s.Grants.Acquire(r.URL.Query().Get("playback_token"), media)
		if err != nil {
			playbackGrantProblem(w, err)
			return
		}
	}
	defer release()
	conn, err := websocket.Accept(w, r, nil)
	if err != nil {
		return
	}
	defer conn.Close(websocket.StatusNormalClosure, "")
	_, updates, leave, action, err := s.Parties.Join(id)
	if err != nil {
		return
	}
	defer leave()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go func() {
		ticker := time.NewTicker(2 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case state, ok := <-updates:
				if !ok {
					cancel()
					return
				}
				if wsjson.Write(ctx, conn, state) != nil {
					cancel()
					return
				}
			case <-ticker.C:
				state, e := s.Parties.Snapshot(id)
				if e == nil && wsjson.Write(ctx, conn, state) != nil {
					cancel()
					return
				}
			case <-ctx.Done():
				return
			}
		}
	}()
	for {
		var event watchparty.Event
		if wsjson.Read(ctx, conn, &event) != nil {
			return
		}
		action(event)
	}
}
