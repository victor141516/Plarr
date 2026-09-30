package server

import (
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"log/slog"
	"mime"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/victor141516/Plarr/internal/cache"
	"github.com/victor141516/Plarr/internal/config"
	"github.com/victor141516/Plarr/internal/media"
	"github.com/victor141516/Plarr/internal/playbackgrant"
	"github.com/victor141516/Plarr/internal/probe"
	"github.com/victor141516/Plarr/internal/transcode"
	"github.com/victor141516/Plarr/internal/watchparty"
)

type Server struct {
	Config    config.Config
	Media     media.Resolver
	Probe     probe.Client
	Transcode *transcode.Manager
	Cache     *cache.Manager
	Log       *slog.Logger
	Grants    *playbackgrant.Manager
	Parties   *watchparty.Manager

	playbackGenerationMu      sync.Mutex
	playbackGenerations       map[string]uint64
	playbackSourceGenerations map[string]uint64
}

func (s *Server) Handler() http.Handler {
	if s.Parties == nil {
		s.Parties = watchparty.New()
	}
	if s.Config.APIKey != "" && s.Grants == nil {
		s.Grants = playbackgrant.New(playbackgrant.Options{})
	}
	r := chi.NewRouter()
	r.Use(middleware.RequestID, middleware.Recoverer, s.log, s.headers)
	r.Get("/healthz", s.health)
	r.Get("/api/v1/config", s.clientConfig)
	r.Get("/api/v1/capabilities", s.capabilities)
	r.Post("/api/v1/auth/playback-grants", s.createPlaybackGrant)
	r.Post("/api/v1/watch-parties", s.createWatchParty)
	r.Get("/api/v1/watch-parties/{room}/connect", s.connectWatchParty)
	r.Group(func(r chi.Router) {
		r.Use(s.requirePlaybackGrantForSession)
		r.Post("/api/v1/playback/sessions/{session}/heartbeat", s.playbackHeartbeat)
		r.Post("/api/v1/playback/sessions/{session}/close", s.playbackClose)
		r.Get("/api/v1/playback/sessions/{session}/diagnostics", s.playbackDiagnostics)
	})
	r.Route("/api/v1/media/{id}", func(r chi.Router) {
		r.Use(s.requirePlaybackGrantForMedia)
		r.Get("/bandwidth-probe", s.bandwidthProbe)
		r.Get("/probe", s.probe)
		r.Get("/preview.jpg", s.preview)
		r.Post("/previews/start", s.startPreviews)
		r.Post("/previews/stop", s.stopPreviews)
		r.Get("/original", s.original)
		r.Get("/remux.mp4", s.remux)
		r.Get("/download/original", s.originalDownload)
		r.Get("/download/{quality}", s.transcodedDownload)
		r.Get("/hls/master.m3u8", s.master)
		r.Get("/hls/original/master.m3u8", s.originalMaster)
		r.Get("/hls/original/video/index.m3u8", s.originalVideoVariant)
		r.Get("/hls/original/video/{segment}", s.originalVideoSegment)
		r.Get("/hls/audio/{stream}/index.m3u8", s.audioPlaylist)
		r.Get("/hls/audio/{stream}/{segment}", s.audioSegment)
		r.Get("/hls/{quality}/index.m3u8", s.variant)
		r.Get("/hls/{quality}/{segment}", s.segment)
		r.Get("/subtitles/{stream}.vtt", s.subtitle)
	})
	r.Handle("/*", s.frontend())
	return r
}

type resolvedMediaKey struct{}

type resolvedMedia struct {
	path string
	rel  string
}

type playbackGrantRequest struct {
	APIKey  string `json:"apiKey"`
	MediaID string `json:"mediaId"`
}

func (s *Server) createPlaybackGrant(w http.ResponseWriter, r *http.Request) {
	if s.Config.APIKey == "" || s.Grants == nil {
		problem(w, http.StatusNotFound, "playback_grants_disabled", "Playback grants are not enabled.")
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	var request playbackGrantRequest
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&request); err != nil || request.APIKey == "" || request.MediaID == "" {
		problem(w, http.StatusBadRequest, "invalid_playback_grant_request", "The playback grant request is invalid.")
		return
	}
	expected := sha256.Sum256([]byte(s.Config.APIKey))
	provided := sha256.Sum256([]byte(request.APIKey))
	if subtle.ConstantTimeCompare(expected[:], provided[:]) != 1 {
		problem(w, http.StatusUnauthorized, "invalid_api_key", "The API key is invalid.")
		return
	}
	_, rel, err := s.Media.ResolveID(request.MediaID)
	if err != nil {
		problem(w, http.StatusBadRequest, "invalid_media", "The requested media path is invalid or unsupported.")
		return
	}
	token, err := s.Grants.Issue(rel)
	if err != nil {
		if s.Log != nil {
			s.Log.Error("playback grant issuance failed", "operation", "playback_grant.issue", "error", err)
		}
		problem(w, http.StatusServiceUnavailable, "playback_grant_unavailable", "A playback grant could not be created.")
		return
	}
	jsonResponse(w, http.StatusCreated, map[string]any{
		"playbackToken":              token,
		"activationExpiresInSeconds": 60,
	})
}

func (s *Server) requirePlaybackGrantForMedia(next http.Handler) http.Handler {
	if s.Config.APIKey == "" {
		return next
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		path, rel, err := s.Media.ResolveID(chi.URLParam(r, "id"))
		if err != nil {
			if errors.Is(err, os.ErrNotExist) {
				problem(w, http.StatusNotFound, "media_not_found", "The requested media does not exist.")
			} else {
				problem(w, http.StatusBadRequest, "invalid_media", "The requested media path is invalid or unsupported.")
			}
			return
		}
		release, err := s.Grants.Acquire(r.URL.Query().Get("playback_token"), rel)
		if err != nil {
			playbackGrantProblem(w, err)
			return
		}
		defer release()
		w.Header().Set("Cache-Control", "private, no-store")
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), resolvedMediaKey{}, resolvedMedia{path: path, rel: rel})))
	})
}

func (s *Server) requirePlaybackGrantForSession(next http.Handler) http.Handler {
	if s.Config.APIKey == "" {
		return next
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		release, err := s.Grants.AcquireAny(r.URL.Query().Get("playback_token"))
		if err != nil {
			playbackGrantProblem(w, err)
			return
		}
		defer release()
		w.Header().Set("Cache-Control", "private, no-store")
		next.ServeHTTP(w, r)
	})
}

func playbackGrantProblem(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, playbackgrant.ErrMissing):
		problem(w, http.StatusUnauthorized, "playback_grant_missing", "A playback grant is required.")
	case errors.Is(err, playbackgrant.ErrExpired):
		problem(w, http.StatusUnauthorized, "playback_grant_expired", "The playback grant has expired.")
	case errors.Is(err, playbackgrant.ErrMismatch):
		problem(w, http.StatusForbidden, "playback_grant_wrong_media", "The playback grant belongs to another media file.")
	default:
		problem(w, http.StatusUnauthorized, "playback_grant_invalid", "A valid playback grant is required.")
	}
}

const bandwidthProbeSize = 256 * 1024

var bandwidthProbePayload = func() []byte {
	payload := make([]byte, bandwidthProbeSize)
	var value uint32 = 0x9e3779b9
	for i := range payload {
		value ^= value << 13
		value ^= value >> 17
		value ^= value << 5
		payload[i] = byte(value)
	}
	return payload
}()

func (s *Server) bandwidthProbe(w http.ResponseWriter, _ *http.Request) {
	if s.Config.APIKey != "" {
		w.Header().Set("Cache-Control", "private, no-store")
	} else {
		w.Header().Set("Cache-Control", "no-store")
	}
	w.Header().Set("Content-Type", "application/octet-stream")
	w.Header().Set("Content-Length", strconv.Itoa(len(bandwidthProbePayload)))
	_, _ = w.Write(bandwidthProbePayload)
}
func (s *Server) log(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		ww := middleware.NewWrapResponseWriter(w, r.ProtoMajor)
		next.ServeHTTP(ww, r)
		s.Log.Info("http request", "method", r.Method, "path", r.URL.Path, "status", ww.Status(), "durationMs", time.Since(start).Milliseconds(), "requestId", middleware.GetReqID(r.Context()))
	})
}
func (s *Server) headers(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, HEAD, POST, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Range, Accept-Encoding")
		w.Header().Set("Access-Control-Expose-Headers", "Content-Length, Content-Range, Accept-Ranges")
		w.Header().Set("Timing-Allow-Origin", "*")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Referrer-Policy", "no-referrer")
		w.Header().Set("Content-Security-Policy", "default-src 'self'; media-src 'self' blob:; connect-src 'self' blob:; style-src 'self' 'unsafe-inline'; script-src 'self' https://www.gstatic.com; img-src 'self' data: blob:; frame-ancestors *")
		if r.Method == http.MethodOptions {
			w.WriteHeader(204)
			return
		}
		next.ServeHTTP(w, r)
	})
}
func (s *Server) health(w http.ResponseWriter, r *http.Request) {
	jsonResponse(w, 200, map[string]any{"status": "ok", "service": "plarr"})
}
func (s *Server) clientConfig(w http.ResponseWriter, r *http.Request) {
	origins := make([]string, 0, len(s.Config.AllowedParentOrigins))
	for o := range s.Config.AllowedParentOrigins {
		origins = append(origins, o)
	}
	sort.Strings(origins)
	jsonResponse(w, 200, map[string]any{"version": 1, "publicOrigin": s.Config.PublicOrigin, "allowedParentOrigins": origins, "renditions": s.Config.Renditions})
}
func (s *Server) capabilities(w http.ResponseWriter, r *http.Request) {
	jsonResponse(w, 200, s.Transcode.Capabilities())
}

func (s *Server) playbackHeartbeat(w http.ResponseWriter, r *http.Request) {
	session := validPlaybackSession(chi.URLParam(r, "session"))
	if session == "" {
		problem(w, 400, "invalid_session", "The playback session is invalid.")
		return
	}
	s.Transcode.TouchSession(session)
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) playbackClose(w http.ResponseWriter, r *http.Request) {
	session := validPlaybackSession(chi.URLParam(r, "session"))
	if session == "" {
		problem(w, 400, "invalid_session", "The playback session is invalid.")
		return
	}
	s.Transcode.CancelSession(session)
	s.playbackGenerationMu.Lock()
	delete(s.playbackGenerations, session)
	delete(s.playbackSourceGenerations, session)
	s.playbackGenerationMu.Unlock()
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) playbackDiagnostics(w http.ResponseWriter, r *http.Request) {
	session := validPlaybackSession(chi.URLParam(r, "session"))
	if session == "" {
		problem(w, 400, "invalid_session", "The playback session is invalid.")
		return
	}
	jsonResponse(w, http.StatusOK, s.Transcode.StrategyDiagnostics(session))
}
func (s *Server) resolved(w http.ResponseWriter, r *http.Request) (string, string, bool) {
	if resolved, ok := r.Context().Value(resolvedMediaKey{}).(resolvedMedia); ok {
		return resolved.path, resolved.rel, true
	}
	path, rel, err := s.Media.ResolveID(chi.URLParam(r, "id"))
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			problem(w, 404, "media_not_found", "The requested media does not exist.")
		} else {
			problem(w, 400, "invalid_media", "The requested media path is invalid or unsupported.")
		}
		return "", "", false
	}
	return path, rel, true
}
func (s *Server) probe(w http.ResponseWriter, r *http.Request) {
	path, rel, ok := s.resolved(w, r)
	if !ok {
		return
	}
	p, err := s.Probe.Probe(r.Context(), path)
	if err != nil {
		s.Log.Error("media probe failed", "operation", "probe", "mediaPath", rel, "error", err)
		problem(w, 422, "probe_failed", "The media file could not be inspected.")
		return
	}
	jsonResponse(w, 200, p)
}

func previewBucket(raw string) (float64, error) {
	seconds, err := strconv.ParseFloat(raw, 64)
	if err != nil || seconds != seconds || seconds < 0 || seconds > 7*24*60*60 {
		return 0, errors.New("invalid preview time")
	}
	return float64(int64(seconds*1000+0.5)) / 1000, nil
}

func (s *Server) preview(w http.ResponseWriter, r *http.Request) {
	path, rel, ok := s.resolved(w, r)
	if !ok {
		return
	}
	second, err := previewBucket(r.URL.Query().Get("time"))
	if err != nil {
		problem(w, 400, "invalid_preview_time", "Invalid preview time.")
		return
	}
	target, err := s.Transcode.PreviewFrame(r.Context(), path, second)
	if err != nil {
		if errors.Is(err, context.Canceled) {
			return
		}
		s.Log.Warn("timeline preview failed", "operation", "preview.frame", "mediaPath", rel, "second", second, "error", err)
		problem(w, 422, "preview_failed", "The preview could not be generated.")
		return
	}
	w.Header().Set("Content-Type", "image/jpeg")
	if s.Config.APIKey != "" {
		w.Header().Set("Cache-Control", "private, no-store")
	} else {
		w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
	}
	http.ServeFile(w, r, target)
}

type previewBatchRequest struct {
	DurationSeconds float64 `json:"durationSeconds"`
	RefinementDepth int     `json:"refinementDepth"`
	Session         string  `json:"session"`
}

func (s *Server) startPreviews(w http.ResponseWriter, r *http.Request) {
	path, rel, ok := s.resolved(w, r)
	if !ok {
		return
	}
	var request previewBatchRequest
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(&request); err != nil {
		problem(w, 400, "invalid_preview_batch", "Invalid preview request.")
		return
	}
	request.Session = validPlaybackSession(request.Session)
	if request.Session == "" || request.DurationSeconds <= 0 || request.DurationSeconds > 7*24*60*60 || request.RefinementDepth < 0 || request.RefinementDepth > 6 {
		problem(w, 400, "invalid_preview_batch", "Invalid preview request.")
		return
	}
	s.Transcode.StartTimelinePreviewBatch(path, request.DurationSeconds, request.RefinementDepth, request.Session)
	s.Log.Info("timeline preview batch requested", "operation", "preview.batch", "mediaPath", rel, "durationSeconds", request.DurationSeconds, "depth", request.RefinementDepth, "session", request.Session)
	w.WriteHeader(http.StatusAccepted)
}

func (s *Server) stopPreviews(w http.ResponseWriter, r *http.Request) {
	var request struct {
		Session string `json:"session"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1024)).Decode(&request); err != nil {
		problem(w, 400, "invalid_session", "The playback session is invalid.")
		return
	}
	request.Session = validPlaybackSession(request.Session)
	if request.Session == "" {
		problem(w, 400, "invalid_session", "The playback session is invalid.")
		return
	}
	s.Transcode.CancelTimelinePreviewBatch(request.Session)
	w.WriteHeader(http.StatusNoContent)
}
func (s *Server) original(w http.ResponseWriter, r *http.Request) {
	path, _, ok := s.resolved(w, r)
	if !ok {
		return
	}
	_, session, _ := playbackParams(r, 0)
	s.Transcode.CancelSession(session)
	f, err := os.Open(path)
	if err != nil {
		problem(w, 404, "media_not_found", "The requested media does not exist.")
		return
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil {
		problem(w, 500, "media_stat_failed", "The media file could not be read.")
		return
	}
	if ct := mime.TypeByExtension(filepath.Ext(path)); ct != "" {
		w.Header().Set("Content-Type", ct)
	}
	w.Header().Set("Accept-Ranges", "bytes")
	http.ServeContent(w, r, filepath.Base(path), info.ModTime(), f)
}
func (s *Server) originalDownload(w http.ResponseWriter, r *http.Request) {
	path, _, ok := s.resolved(w, r)
	if !ok {
		return
	}
	w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=%q", filepath.Base(path)))
	if s.Config.APIKey != "" {
		w.Header().Set("Cache-Control", "private, no-store, no-transform")
	} else {
		w.Header().Set("Cache-Control", "private, no-transform")
	}
	s.original(w, r)
}

func (s *Server) remux(w http.ResponseWriter, r *http.Request) {
	path, rel, ok := s.resolved(w, r)
	if !ok {
		return
	}
	p, err := s.Probe.Probe(r.Context(), path)
	if err != nil {
		problem(w, 422, "probe_failed", "The media file could not be inspected.")
		return
	}
	start, session, _ := playbackParams(r, p.DurationSeconds)
	s.Transcode.CancelSession(session)
	audioIndex := -1
	if raw := r.URL.Query().Get("audio"); raw != "" {
		if parsed, parseErr := strconv.Atoi(raw); parseErr == nil {
			for _, track := range p.Audio {
				if track.Index == parsed {
					audioIndex = parsed
					break
				}
			}
		}
	}
	w.Header().Set("Content-Type", "video/mp4")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Accel-Buffering", "no")
	committed, err := s.Transcode.StreamRemux(r.Context(), path, p, start, audioIndex, w, r.URL.Query().Get("audioMode") == "copy")
	if err == nil || errors.Is(err, context.Canceled) {
		return
	}
	s.Log.Error("remux failed", "operation", "remux.stream", "mediaPath", rel, "committed", committed, "error", err)
	if !committed {
		problem(w, 500, "remux_failed", "The original video could not be repackaged for this browser.")
	}
}
func (s *Server) rendition(label string) (config.Rendition, bool) {
	for _, v := range s.Config.Renditions {
		if v.Label == label {
			return v, true
		}
	}
	return config.Rendition{}, false
}

const maxRenditionOvershoot = 0.30

// playableRenditions keeps every downscaled level and also the immediately
// higher rung when the source fills at least 70% of it. Measuring the missing
// portion against the target makes an 808px source eligible for 1080p
// (272/1080 = 25.2%) without also exposing 2160p.
func playableRenditions(all []config.Rendition, sourceHeight int) []config.Rendition {
	items := append([]config.Rendition(nil), all...)
	sort.SliceStable(items, func(i, j int) bool { return items[i].Height < items[j].Height })
	result := make([]config.Rendition, 0, len(items))
	for _, item := range items {
		if item.Height <= sourceHeight {
			result = append(result, item)
			continue
		}
		if sourceHeight > 0 && float64(item.Height-sourceHeight)/float64(item.Height) < maxRenditionOvershoot {
			result = append(result, item)
		}
		break
	}
	return result
}

func playbackParams(r *http.Request, duration float64) (float64, string, string) {
	start, _ := strconv.ParseFloat(r.URL.Query().Get("start"), 64)
	if start < 0 || start != start {
		start = 0
	}
	if duration > 0 && start >= duration {
		start = max(0, duration-.1)
	}
	session := validPlaybackSession(r.URL.Query().Get("session"))
	q := url.Values{}
	if start > 0 {
		q.Set("start", strconv.FormatFloat(start, 'f', 3, 64))
	}
	if session != "" {
		q.Set("session", session)
	}
	if generation, ok := validPlaybackGeneration(r.URL.Query().Get("generation")); ok && generation > 0 {
		q.Set("generation", strconv.FormatUint(generation, 10))
	}
	if token := r.URL.Query().Get("playback_token"); token != "" {
		q.Set("playback_token", token)
	}
	encoded := q.Encode()
	if encoded != "" {
		encoded = "?" + encoded
	}
	return start, session, encoded
}

func validPlaybackGeneration(raw string) (uint64, bool) {
	if raw == "" {
		return 0, true
	}
	generation, err := strconv.ParseUint(raw, 10, 64)
	return generation, err == nil && generation > 0
}

func (s *Server) acceptPlaybackGeneration(w http.ResponseWriter, r *http.Request, activate bool) bool {
	raw := r.URL.Query().Get("generation")
	generation, valid := validPlaybackGeneration(raw)
	if !valid {
		problem(w, http.StatusBadRequest, "invalid_playback_generation", "Invalid playback generation.")
		return false
	}
	if generation == 0 {
		return true
	}
	session := validPlaybackSession(r.URL.Query().Get("session"))
	if session == "" {
		problem(w, http.StatusBadRequest, "invalid_playback_session", "A playback generation requires a valid session.")
		return false
	}

	s.playbackGenerationMu.Lock()
	defer s.playbackGenerationMu.Unlock()
	if s.playbackGenerations == nil {
		s.playbackGenerations = map[string]uint64{}
	}
	current := s.playbackGenerations[session]
	if activate {
		if generation < current {
			problem(w, http.StatusConflict, "stale_playback_generation", "This playback generation has been replaced.")
			return false
		}
		s.playbackGenerations[session] = generation
		return true
	}
	if generation != current {
		problem(w, http.StatusConflict, "stale_playback_generation", "This playback generation has been replaced.")
		return false
	}
	return true
}

func sourceSwitchNeeded(generation, lastCancelledGeneration uint64) bool {
	return generation != lastCancelledGeneration
}

// cancelPlaybackSource linearizes the destructive source-family switch with
// generation activation. A master playlist may be fetched again by hls.js
// within the same generation; that refresh must not kill the encoders serving
// its existing video and audio playlists.
func (s *Server) cancelPlaybackSource(w http.ResponseWriter, r *http.Request, session string) bool {
	generation, valid := validPlaybackGeneration(r.URL.Query().Get("generation"))
	if !valid {
		problem(w, http.StatusBadRequest, "invalid_playback_generation", "Invalid playback generation.")
		return false
	}
	if generation == 0 {
		s.Transcode.CancelSession(session)
		return true
	}

	s.playbackGenerationMu.Lock()
	defer s.playbackGenerationMu.Unlock()
	if s.playbackGenerations[session] != generation {
		problem(w, http.StatusConflict, "stale_playback_generation", "This playback generation has been replaced.")
		return false
	}
	if s.playbackSourceGenerations == nil {
		s.playbackSourceGenerations = map[string]uint64{}
	}
	if sourceSwitchNeeded(generation, s.playbackSourceGenerations[session]) {
		s.Transcode.CancelSession(session)
		s.playbackSourceGenerations[session] = generation
	}
	return true
}

var playbackSessionName = regexp.MustCompile(`^[A-Za-z0-9_-]{1,80}$`)

func validPlaybackSession(session string) string {
	if !playbackSessionName.MatchString(session) {
		return ""
	}
	return session
}

func requestedColorMode(r *http.Request, video *probe.Stream) transcode.ColorMode {
	if r.URL.Query().Get("color") == string(transcode.ColorHDR) && probe.IsHDR(video) {
		return transcode.ColorHDR
	}
	return transcode.ColorSDR
}

func (s *Server) master(w http.ResponseWriter, r *http.Request) {
	if !s.acceptPlaybackGeneration(w, r, true) {
		return
	}
	path, _, ok := s.resolved(w, r)
	if !ok {
		return
	}
	p, err := s.Probe.Probe(r.Context(), path)
	if err != nil {
		problem(w, 422, "probe_failed", "The media file could not be inspected.")
		return
	}
	_, session, query := playbackParams(r, p.DurationSeconds)
	// Loading a new master is a source-family switch. Cancel every previous
	// video and audio lane owned by this player before the child playlists
	// establish the new session lease.
	if !s.cancelPlaybackSource(w, r, session) {
		return
	}
	color := requestedColorMode(r, p.Video)
	if query == "" {
		query = "?color=" + string(color)
	} else {
		query += "&color=" + string(color)
	}
	if probe.IsHDR(p.Video) {
		query += "&sourceHDR=1"
	}
	requestedQuality := strings.TrimSpace(r.URL.Query().Get("quality"))
	w.Header().Set("Content-Type", "application/vnd.apple.mpegurl")
	fmt.Fprintln(w, "#EXTM3U")
	version := 6
	if color == transcode.ColorHDR {
		version = 7
	}
	fmt.Fprintf(w, "#EXT-X-VERSION:%d\n", version)
	selectedAudio := selectedAudioIndex(p, r.URL.Query().Get("audio"))
	requestedMP3Copy := r.URL.Query().Get("audioMode") == "copy"
	audioCodecs := map[string]bool{}
	maxAudioBitrate := 0
	for _, a := range p.Audio {
		copyAudio := originalHLSAudioCanCopy(a.CodecName, requestedMP3Copy)
		outputCodec := "aac"
		if copyAudio && strings.EqualFold(a.CodecName, "mp3") {
			outputCodec = "mp3"
		}
		audioCodecs[outputCodec] = true
		bitrate := transcode.CompatibilityAudioBitrate(a.Channels)
		if copyAudio {
			if sourceBitrate, err := strconv.Atoi(a.BitRate); err == nil && sourceBitrate > 0 {
				bitrate = sourceBitrate
			}
		}
		maxAudioBitrate = max(maxAudioBitrate, bitrate)
		mode := "encode"
		if copyAudio {
			mode = "copy"
		}
		audioQuery := appendPlaybackAudioParams(query, mode, outputCodec, a.Channels)
		language := a.Tags["language"]
		if language == "" {
			language = "und"
		}
		name := a.Tags["title"]
		if name == "" {
			name = strings.ToUpper(language)
		}
		def := "NO"
		if a.Index == selectedAudio {
			def = "YES"
		}
		fmt.Fprintf(w, "#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID=\"audio\",NAME=\"%s\",LANGUAGE=\"%s\",DEFAULT=%s,AUTOSELECT=YES,URI=\"audio/%d/index.m3u8%s\"\n", manifestValue(name), manifestValue(language), def, a.Index, audioQuery)
	}
	renditions := s.Config.Renditions
	if p.Video != nil {
		renditions = playableRenditions(renditions, p.Video.Height)
	}
	renditions = append([]config.Rendition(nil), renditions...)
	sort.SliceStable(renditions, func(i, j int) bool { return renditions[i].VideoBitrate < renditions[j].VideoBitrate })
	renditions = requestedRenditions(renditions, requestedQuality)
	for _, v := range renditions {
		width := int(float64(v.Height) * 16 / 9)
		if p.Video != nil && p.Video.Height > 0 {
			width = int(float64(v.Height) * float64(p.Video.Width) / float64(p.Video.Height))
			width -= width % 2
		}
		audioAttr, codecs := "", "avc1.640029"
		videoRange := ""
		if color == transcode.ColorHDR {
			codecs = "hvc1.2.4.L153.B0"
			videoRange = ",VIDEO-RANGE=PQ"
		}
		if len(p.Audio) > 0 {
			audioAttr = ",AUDIO=\"audio\""
			if audioCodecs["aac"] {
				codecs += ",mp4a.40.2"
			}
			if audioCodecs["mp3"] {
				codecs += ",mp4a.40.34"
			}
		}
		fmt.Fprintf(w, "#EXT-X-STREAM-INF:BANDWIDTH=%d,AVERAGE-BANDWIDTH=%d,RESOLUTION=%dx%d,CODECS=\"%s\",NAME=\"%s\"%s%s\n", int(float64(v.VideoBitrate)*1.15)+maxAudioBitrate, v.VideoBitrate+maxAudioBitrate, width, v.Height, codecs, v.Label, audioAttr, videoRange)
		fmt.Fprintf(w, "%s/index.m3u8%s\n", v.Label, query)
	}
}

func appendPlaybackAudioParams(query, mode, codec string, channels int) string {
	if query == "" {
		query = "?"
	} else {
		query += "&"
	}
	return query + "audioMode=" + url.QueryEscape(mode) + "&audioCodec=" + url.QueryEscape(codec) + "&audioChannels=" + strconv.Itoa(channels)
}

func requestedAudioChannels(raw string) int {
	channels, err := strconv.Atoi(raw)
	if err != nil || channels < 1 || channels > 8 {
		return 2
	}
	return channels
}

func selectedAudioChannels(p probe.Result, index int) int {
	for _, track := range p.Audio {
		if track.Index == index {
			return requestedAudioChannels(strconv.Itoa(track.Channels))
		}
	}
	return 2
}

func appendPlaybackChannelCount(query string, channels int) string {
	if query == "" {
		return "?audioChannels=" + strconv.Itoa(channels)
	}
	return query + "&audioChannels=" + strconv.Itoa(channels)
}

func requestedRenditions(all []config.Rendition, requested string) []config.Rendition {
	if requested == "" {
		return all
	}
	for _, rendition := range all {
		if strings.EqualFold(rendition.Label, requested) {
			return []config.Rendition{rendition}
		}
	}
	return all
}

func manifestValue(v string) string {
	return strings.ReplaceAll(strings.ReplaceAll(v, "\\", ""), "\"", "'")
}
func (s *Server) audioPlaylist(w http.ResponseWriter, r *http.Request) {
	if !s.acceptPlaybackGeneration(w, r, false) {
		return
	}
	path, _, ok := s.resolved(w, r)
	if !ok {
		return
	}
	index, err := strconv.Atoi(chi.URLParam(r, "stream"))
	if err != nil || index < 0 {
		problem(w, 400, "invalid_stream", "Invalid audio stream.")
		return
	}
	start, session, _ := playbackParams(r, 0)
	audioMode := r.URL.Query().Get("audioMode")
	copySource := audioMode == "copy"
	codec := r.URL.Query().Get("audioCodec")
	if codec != "mp3" {
		codec = "aac"
	}
	channels := requestedAudioChannels(r.URL.Query().Get("audioChannels"))
	query := appendPlaybackAudioParams(playbackQueryWithAudio(start, session, r.URL.Query().Get("generation"), -1, "", r.URL.Query().Get("playback_token")), audioMode, codec, channels)
	target, err := s.Transcode.AudioHLS(r.Context(), path, index, start, session, copySource, codec, channels)
	if err != nil {
		if errors.Is(err, context.Canceled) {
			return
		}
		if errors.Is(err, transcode.ErrHLSWindowExpired) {
			problem(w, http.StatusConflict, "hls_window_expired", "Playback must resume in a new generation window.")
			return
		}
		problem(w, 422, "audio_failed", "The audio track could not be prepared.")
		return
	}
	w.Header().Set("Content-Type", "application/vnd.apple.mpegurl")
	servePlaylist(w, target, query)
}

var audioSegmentName = regexp.MustCompile(`^audio-\d{5}\.(?:aac|ts)$`)

func (s *Server) audioSegment(w http.ResponseWriter, r *http.Request) {
	if !s.acceptPlaybackGeneration(w, r, false) {
		return
	}
	path, _, ok := s.resolved(w, r)
	if !ok {
		return
	}
	index, err := strconv.Atoi(chi.URLParam(r, "stream"))
	if err != nil || index < 0 {
		problem(w, 400, "invalid_stream", "Invalid audio stream.")
		return
	}
	name := chi.URLParam(r, "segment")
	if !audioSegmentName.MatchString(name) {
		problem(w, 400, "invalid_segment", "Invalid audio segment.")
		return
	}
	start, session, _ := playbackParams(r, 0)
	audioMode := r.URL.Query().Get("audioMode")
	copySource := audioMode == "copy"
	codec := r.URL.Query().Get("audioCodec")
	if codec != "mp3" {
		codec = "aac"
	}
	if !strings.HasSuffix(name, transcode.AudioHLSSuffix(copySource, codec)) {
		problem(w, 400, "invalid_segment", "Audio segment format does not match its codec.")
		return
	}
	channels := requestedAudioChannels(r.URL.Query().Get("audioChannels"))
	target, err := s.Transcode.EnsureAudioHLSSegment(r.Context(), path, index, start, session, copySource, codec, channels, name)
	if err != nil {
		if errors.Is(err, context.Canceled) {
			return
		}
		if errors.Is(err, transcode.ErrHLSWindowExpired) {
			problem(w, http.StatusConflict, "hls_window_expired", "Playback must resume in a new generation window.")
			return
		}
		if errors.Is(err, os.ErrNotExist) {
			problem(w, 404, "segment_not_found", "The audio segment does not exist.")
			return
		}
		problem(w, 422, "audio_failed", "The audio track could not be prepared.")
		return
	}
	if codec == "mp3" && copySource {
		w.Header().Set("Content-Type", "video/mp2t")
	} else {
		w.Header().Set("Content-Type", "audio/aac")
	}
	http.ServeFile(w, r, target)
}
func (s *Server) variant(w http.ResponseWriter, r *http.Request) {
	if !s.acceptPlaybackGeneration(w, r, false) {
		return
	}
	path, rel, ok := s.resolved(w, r)
	if !ok {
		return
	}
	rendition, ok := s.rendition(chi.URLParam(r, "quality"))
	if !ok {
		problem(w, 404, "rendition_not_found", "Unknown rendition.")
		return
	}
	start, session, query := playbackParams(r, 0)
	p, err := s.Probe.Probe(r.Context(), path)
	if err != nil {
		problem(w, 422, "probe_failed", "The media file could not be inspected.")
		return
	}
	color := requestedColorMode(r, p.Video)
	if query == "" {
		query = "?color=" + string(color)
	} else {
		query += "&color=" + string(color)
	}
	if probe.IsHDR(p.Video) {
		query += "&sourceHDR=1"
	}
	target, err := s.Transcode.HLS(r.Context(), path, rendition, start, session, color, probe.IsHDR(p.Video))
	if err != nil {
		if errors.Is(err, context.Canceled) {
			return
		}
		if errors.Is(err, transcode.ErrHLSWindowExpired) {
			problem(w, http.StatusConflict, "hls_window_expired", "Playback must resume in a new generation window.")
			return
		}
		s.Log.Error("HLS generation failed", "operation", "hls.generate", "mediaPath", rel, "rendition", rendition.Label, "error", err)
		problem(w, 500, "transcode_failed", "This rendition could not be generated.")
		return
	}
	w.Header().Set("Content-Type", "application/vnd.apple.mpegurl")
	servePlaylist(w, target, query)
}

func selectedAudioIndex(p probe.Result, raw string) int {
	if parsed, err := strconv.Atoi(raw); err == nil {
		for _, track := range p.Audio {
			if track.Index == parsed {
				return parsed
			}
		}
	}
	if len(p.Audio) > 0 {
		return p.Audio[0].Index
	}
	return -1
}

func playbackQueryWithAudio(start float64, session, generation string, audioIndex int, options ...string) string {
	q := url.Values{}
	if start > 0 {
		q.Set("start", strconv.FormatFloat(start, 'f', 3, 64))
	}
	if session != "" {
		q.Set("session", session)
	}
	if parsed, ok := validPlaybackGeneration(generation); ok && parsed > 0 {
		q.Set("generation", strconv.FormatUint(parsed, 10))
	}
	if audioIndex >= 0 {
		q.Set("audio", strconv.Itoa(audioIndex))
	}
	if len(options) > 0 && options[0] != "" {
		q.Set("audioMode", options[0])
	}
	if len(options) > 1 && options[1] != "" {
		q.Set("playback_token", options[1])
	}
	if encoded := q.Encode(); encoded != "" {
		return "?" + encoded
	}
	return ""
}

func (s *Server) originalMaster(w http.ResponseWriter, r *http.Request) {
	if !s.acceptPlaybackGeneration(w, r, true) {
		return
	}
	path, _, ok := s.resolved(w, r)
	if !ok {
		return
	}
	p, err := s.Probe.Probe(r.Context(), path)
	if err != nil {
		problem(w, 422, "probe_failed", "The media file could not be inspected.")
		return
	}
	start, session, _ := playbackParams(r, p.DurationSeconds)
	// Original HLS uses different cache lanes from adaptive playback. Cancel
	// both the previous video and audio work before starting the new family.
	if !s.cancelPlaybackSource(w, r, session) {
		return
	}
	audioIndex, audioCodec, copyAudio := originalAudioConfig(p, r.URL.Query().Get("audio"), r.URL.Query().Get("audioMode") == "copy")
	audioMode := ""
	if audioIndex >= 0 {
		if copyAudio {
			audioMode = "copy"
		} else {
			audioMode = "original"
		}
	}
	query := playbackQueryWithAudio(start, session, r.URL.Query().Get("generation"), audioIndex, audioMode, r.URL.Query().Get("playback_token"))
	query = appendPlaybackChannelCount(query, selectedAudioChannels(p, audioIndex))
	w.Header().Set("Content-Type", "application/vnd.apple.mpegurl")
	_, _ = w.Write([]byte(originalMasterManifest(p, audioIndex, audioCodec, copyAudio, query)))
}

func originalMasterManifest(p probe.Result, audioIndex int, audioCodec string, copyAudio bool, query string) string {
	var manifest strings.Builder
	fmt.Fprintln(&manifest, "#EXTM3U")
	fmt.Fprintln(&manifest, "#EXT-X-VERSION:7")
	codecs := hlsVideoCodec(p.Video)
	if audioIndex >= 0 {
		if copyAudio && audioCodec == "mp3" {
			codecs += ",mp4a.40.34"
		} else {
			codecs += ",mp4a.40.2"
		}
	}
	bandwidth := 1
	if parsed, parseErr := strconv.Atoi(p.Format.BitRate); parseErr == nil && parsed > 0 {
		bandwidth = parsed
	}
	if audioIndex >= 0 && !copyAudio {
		for _, track := range p.Audio {
			if track.Index != audioIndex {
				continue
			}
			encodedBitrate := transcode.CompatibilityAudioBitrate(track.Channels)
			if originalBitrate, err := strconv.Atoi(track.BitRate); err == nil && originalBitrate > 0 {
				bandwidth += max(0, encodedBitrate-originalBitrate)
			} else {
				bandwidth += encodedBitrate
			}
			break
		}
	}
	resolution := ""
	if p.Video != nil {
		resolution = fmt.Sprintf(",RESOLUTION=%dx%d", p.Video.Width, p.Video.Height)
	}
	videoRange := ""
	if probe.IsHDR(p.Video) {
		videoRange = ",VIDEO-RANGE=PQ"
	}
	fmt.Fprintf(&manifest, "#EXT-X-STREAM-INF:BANDWIDTH=%d,AVERAGE-BANDWIDTH=%d%s,CODECS=\"%s\"%s\n", bandwidth, bandwidth, resolution, codecs, videoRange)
	fmt.Fprintf(&manifest, "video/index.m3u8%s\n", query)
	return manifest.String()
}

func originalAudioConfig(p probe.Result, raw string, requestedMP3Copy ...bool) (int, string, bool) {
	index := selectedAudioIndex(p, raw)
	for _, track := range p.Audio {
		if track.Index == index {
			codec := strings.ToLower(track.CodecName)
			return index, codec, originalHLSAudioCanCopy(codec, len(requestedMP3Copy) > 0 && requestedMP3Copy[0])
		}
	}
	return -1, "", false
}

func hlsVideoCodec(video *probe.Stream) string {
	if video == nil {
		return "avc1.4d4028"
	}
	switch strings.ToLower(video.CodecName) {
	case "hevc":
		if strings.Contains(strings.ToLower(video.Profile), "10") || strings.Contains(strings.ToLower(video.PixFmt), "10") {
			return "hvc1.2.4.L153.B0"
		}
		return "hvc1.1.6.L120.B0"
	case "h264":
		return "avc1.640029"
	default:
		return "avc1.4d4028"
	}
}

func originalHLSAudioCanCopy(codec string, requestedMP3Copy ...bool) bool {
	switch strings.ToLower(codec) {
	case "aac":
		return true
	case "mp3":
		return len(requestedMP3Copy) > 0 && requestedMP3Copy[0]
	default:
		return false
	}
}

func (s *Server) originalVideoVariant(w http.ResponseWriter, r *http.Request) {
	if !s.acceptPlaybackGeneration(w, r, false) {
		return
	}
	path, rel, ok := s.resolved(w, r)
	if !ok {
		return
	}
	start, session, _ := playbackParams(r, 0)
	p, err := s.Probe.Probe(r.Context(), path)
	if err != nil {
		problem(w, 422, "probe_failed", "The media file could not be inspected.")
		return
	}
	videoCodec := ""
	if p.Video != nil {
		videoCodec = p.Video.CodecName
	}
	audioIndex, _, copyAudio := originalAudioConfig(p, r.URL.Query().Get("audio"), r.URL.Query().Get("audioMode") == "copy")
	audioMode := ""
	if audioIndex >= 0 {
		if copyAudio {
			audioMode = "copy"
		} else {
			audioMode = "original"
		}
	}
	query := playbackQueryWithAudio(start, session, r.URL.Query().Get("generation"), audioIndex, audioMode, r.URL.Query().Get("playback_token"))
	channels := selectedAudioChannels(p, audioIndex)
	query = appendPlaybackChannelCount(query, channels)
	target, err := s.Transcode.OriginalHLS(r.Context(), path, start, session, videoCodec, audioIndex, copyAudio, channels)
	if err != nil {
		if errors.Is(err, context.Canceled) {
			return
		}
		if errors.Is(err, transcode.ErrHLSWindowExpired) {
			problem(w, http.StatusConflict, "hls_window_expired", "Playback must resume in a new generation window.")
			return
		}
		s.Log.Error("original HLS generation failed", "operation", "hls.original", "mediaPath", rel, "error", err)
		problem(w, 500, "original_hls_failed", "The original stream could not be packaged for buffered playback.")
		return
	}
	w.Header().Set("Content-Type", "application/vnd.apple.mpegurl")
	if query == "" {
		query = "?videoCodec=" + url.QueryEscape(videoCodec)
	} else {
		query += "&videoCodec=" + url.QueryEscape(videoCodec)
	}
	servePlaylist(w, target, query)
}

var segmentName = regexp.MustCompile(`^(?:segment-\d{5}\.(?:ts|m4s)|init\.mp4)$`)
var originalSegmentName = regexp.MustCompile(`^(?:segment-\d{5}\.m4s|init\.mp4)$`)

func (s *Server) segment(w http.ResponseWriter, r *http.Request) {
	if !s.acceptPlaybackGeneration(w, r, false) {
		return
	}
	path, _, ok := s.resolved(w, r)
	if !ok {
		return
	}
	rendition, ok := s.rendition(chi.URLParam(r, "quality"))
	if !ok {
		problem(w, 404, "rendition_not_found", "Unknown rendition.")
		return
	}
	name := chi.URLParam(r, "segment")
	if !segmentName.MatchString(name) {
		problem(w, 400, "invalid_segment", "Invalid segment name.")
		return
	}
	start, session, _ := playbackParams(r, 0)
	color := transcode.ColorSDR
	if r.URL.Query().Get("color") == string(transcode.ColorHDR) {
		color = transcode.ColorHDR
	}
	sourceHDR := r.URL.Query().Get("sourceHDR") == "1"
	target, err := s.Transcode.EnsureHLSSegment(r.Context(), path, rendition, start, session, color, sourceHDR, name)
	if err != nil {
		if errors.Is(err, context.Canceled) {
			return
		}
		if errors.Is(err, transcode.ErrHLSWindowExpired) {
			problem(w, http.StatusConflict, "hls_window_expired", "Playback must resume in a new generation window.")
			return
		}
		if errors.Is(err, os.ErrNotExist) {
			problem(w, 404, "segment_not_found", "The video segment does not exist.")
			return
		}
		problem(w, 500, "transcode_failed", "This rendition could not be generated.")
		return
	}
	release := s.Cache.Acquire(filepath.Base(filepath.Dir(target)))
	defer release()
	if name == "init.mp4" {
		w.Header().Set("Content-Type", "video/mp4")
	} else if strings.HasSuffix(name, ".m4s") {
		w.Header().Set("Content-Type", "video/iso.segment")
	} else {
		w.Header().Set("Content-Type", "video/mp2t")
	}
	http.ServeFile(w, r, target)
}

func (s *Server) originalVideoSegment(w http.ResponseWriter, r *http.Request) {
	if !s.acceptPlaybackGeneration(w, r, false) {
		return
	}
	path, _, ok := s.resolved(w, r)
	if !ok {
		return
	}
	name := chi.URLParam(r, "segment")
	if !originalSegmentName.MatchString(name) {
		problem(w, 400, "invalid_segment", "Invalid segment name.")
		return
	}
	start, session, _ := playbackParams(r, 0)
	videoCodec := strings.ToLower(r.URL.Query().Get("videoCodec"))
	if videoCodec != "hevc" && videoCodec != "h264" {
		videoCodec = ""
	}
	audioIndex := -1
	if rawAudio := r.URL.Query().Get("audio"); rawAudio != "" {
		if parsed, err := strconv.Atoi(rawAudio); err == nil && parsed >= 0 {
			audioIndex = parsed
		}
	}
	copyAudio := r.URL.Query().Get("audioMode") == "copy"
	target, err := s.Transcode.EnsureOriginalHLSSegment(r.Context(), path, start, session, videoCodec, audioIndex, copyAudio, name, requestedAudioChannels(r.URL.Query().Get("audioChannels")))
	if err != nil {
		if errors.Is(err, context.Canceled) {
			return
		}
		if errors.Is(err, transcode.ErrHLSWindowExpired) {
			problem(w, http.StatusConflict, "hls_window_expired", "Playback must resume in a new generation window.")
			return
		}
		if errors.Is(err, os.ErrNotExist) {
			problem(w, 404, "segment_not_found", "The original video segment does not exist.")
			return
		}
		problem(w, 500, "original_hls_failed", "The original stream could not be packaged for buffered playback.")
		return
	}
	release := s.Cache.Acquire(filepath.Base(filepath.Dir(target)))
	defer release()
	if name == "init.mp4" {
		w.Header().Set("Content-Type", "video/mp4")
	} else {
		w.Header().Set("Content-Type", "video/iso.segment")
	}
	http.ServeFile(w, r, target)
}

func servePlaylist(w http.ResponseWriter, target, query string) {
	b, err := os.ReadFile(target)
	if err != nil {
		problem(w, 404, "playlist_not_ready", "The playlist is not ready yet.")
		return
	}
	if query != "" {
		lines := strings.Split(string(b), "\n")
		for i, line := range lines {
			trimmed := strings.TrimSpace(line)
			if trimmed != "" && !strings.HasPrefix(trimmed, "#") {
				lines[i] = line + query
			} else if strings.HasPrefix(trimmed, "#EXT-X-MAP:") {
				lines[i] = appendManifestURIQuery(line, query)
			}
		}
		b = []byte(strings.Join(lines, "\n"))
	}
	w.Header().Set("Cache-Control", "no-store")
	_, _ = w.Write(b)
}

var manifestURI = regexp.MustCompile(`URI="([^"]+)"`)

func appendManifestURIQuery(line, query string) string {
	return manifestURI.ReplaceAllString(line, `URI="$1`+query+`"`)
}
func (s *Server) subtitle(w http.ResponseWriter, r *http.Request) {
	path, _, ok := s.resolved(w, r)
	if !ok {
		return
	}
	index, err := strconv.Atoi(chi.URLParam(r, "stream"))
	if err != nil || index < 0 {
		problem(w, 400, "invalid_stream", "Invalid subtitle stream.")
		return
	}
	target, err := s.Transcode.Subtitle(r.Context(), path, index)
	if err != nil {
		problem(w, 422, "subtitle_failed", "The subtitle track could not be converted.")
		return
	}
	w.Header().Set("Content-Type", "text/vtt; charset=utf-8")
	http.ServeFile(w, r, target)
}
func (s *Server) transcodedDownload(w http.ResponseWriter, r *http.Request) {
	path, _, ok := s.resolved(w, r)
	if !ok {
		return
	}
	rendition, ok := s.rendition(chi.URLParam(r, "quality"))
	if !ok {
		problem(w, 404, "rendition_not_found", "Unknown rendition.")
		return
	}
	p, err := s.Probe.Probe(r.Context(), path)
	if err != nil {
		problem(w, 422, "probe_failed", "The media file could not be inspected.")
		return
	}
	base := strings.TrimSuffix(filepath.Base(path), filepath.Ext(path))
	w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=%q", base+"-"+rendition.Label+".mp4"))
	w.Header().Set("Content-Type", "video/mp4")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Accel-Buffering", "no")
	committed, err := s.Transcode.StreamDownload(r.Context(), path, p, rendition, w)
	if err == nil || errors.Is(err, context.Canceled) {
		return
	}
	s.Log.Error("streaming download failed", "operation", "download.stream", "rendition", rendition.Label, "committed", committed, "error", err)
	if !committed {
		problem(w, 500, "transcode_failed", "The download could not be generated.")
	}
}
func (s *Server) frontend() http.Handler {
	root := os.DirFS(s.Config.FrontendDir)
	files := http.FileServer(http.FS(root))
	index, indexErr := fs.ReadFile(root, "index.html")
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		path := strings.TrimPrefix(filepath.ToSlash(filepath.Clean(r.URL.Path)), "/")
		if path != "." {
			if f, err := fs.Stat(root, path); err == nil && !f.IsDir() {
				files.ServeHTTP(w, r)
				return
			}
		}
		if indexErr != nil {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Header().Set("Cache-Control", "no-cache")
		_, _ = w.Write(index)
	})
}
func jsonResponse(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
func problem(w http.ResponseWriter, status int, code, message string) {
	jsonResponse(w, status, map[string]any{"error": map[string]string{"code": code, "message": message}})
}
